import { GoogleGenAI, ThinkingLevel, type GenerateContentParameters } from '@google/genai';
import type {
  ExplainRequestPayload,
  ExplainStatusResponse,
  GeminiExplanationRecord,
} from '../../src/contracts/explain.ts';
import { TtlCache } from '../cache.ts';
import {
  EXPLANATION_RESPONSE_SCHEMA,
  EXPLAIN_DISCLAIMER,
  EXPLAIN_SYSTEM_INSTRUCTION,
  ExplanationOutputValidationError,
  buildExplanationInputJson,
  validateAndVerifyExplanationOutput,
} from './promptAndValidation.ts';

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RETRY_ATTEMPTS = 2; // 3 total attempts for 429 / 5xx
const BASE_BACKOFF_MS = 750;
const EXPLANATION_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour per alert/transition

export class ExplanationServiceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly timestamp: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ExplanationServiceError';
    this.status = status;
    this.code = code;
    this.timestamp = new Date().toISOString();
  }
}

export interface GeminiClientAdapter {
  generateContent(
    params: GenerateContentParameters,
  ): Promise<{ text: string | undefined }>;
}

export interface ExplainServiceDeps {
  getEnv?: () => { apiKey: string | undefined; model: string | undefined };
  createClient?: (apiKey: string) => GeminiClientAdapter;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  cache?: TtlCache<GeminiExplanationRecord>;
}

const defaultCache = new TtlCache<GeminiExplanationRecord>(EXPLANATION_CACHE_TTL_MS, 250);
const inFlightRequests = new Map<
  string,
  Promise<{ record: GeminiExplanationRecord; cached: boolean }>
>();

function defaultGetEnv() {
  return {
    apiKey: process.env.GEMINI_API_KEY?.trim() || undefined,
    model: process.env.GEMINI_MODEL?.trim() || undefined,
  };
}

function defaultCreateClient(apiKey: string): GeminiClientAdapter {
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  return {
    generateContent: (params) => ai.models.generateContent(params),
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeModelName(rawModel: string): string {
  return rawModel.replace(/^models\//i, '').trim();
}

function sanitizeErrorMessage(raw: string, apiKey?: string): string {
  let msg = raw;
  if (apiKey && apiKey.length >= 6) {
    msg = msg.split(apiKey).join('[REDACTED]');
  }
  msg = msg.replace(/AIza[0-9A-Za-z\-_]{20,}/g, '[REDACTED]');
  return msg.slice(0, 320);
}

function extractHttpStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as Record<string, unknown>;
  if (typeof e.status === 'number') return e.status;
  if (typeof e.statusCode === 'number') return e.statusCode;
  if (typeof e.code === 'number') return e.code;
  const msg = typeof e.message === 'string' ? e.message : '';
  const statusMatch = msg.match(/\b(400|401|403|404|408|429|500|502|503|504)\b/);
  if (statusMatch) return Number(statusMatch[1]);
  if (/RESOURCE_EXHAUSTED/i.test(msg)) return 429;
  if (/PERMISSION_DENIED|API_KEY_INVALID/i.test(msg)) return 403;
  if (/NOT_FOUND/i.test(msg)) return 404;
  if (/UNAVAILABLE|INTERNAL/i.test(msg)) return 503;
  return null;
}

function isRetryableError(err: unknown, timedOut: boolean): boolean {
  if (timedOut) return true;
  const status = extractHttpStatus(err);
  if (status === 429 || (status !== null && status >= 500 && status < 600)) {
    return true;
  }
  const msg = err instanceof Error ? err.message : '';
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|network/i.test(msg);
}

export function getExplanationConfigStatus(
  deps: Pick<ExplainServiceDeps, 'getEnv' | 'now'> = {},
): ExplainStatusResponse {
  const env = (deps.getEnv ?? defaultGetEnv)();
  const apiKeyConfigured = Boolean(env.apiKey);
  const modelConfigured = Boolean(env.model);
  const configured = apiKeyConfigured && modelConfigured;

  let reason: string | null = null;
  if (!apiKeyConfigured && !modelConfigured) {
    reason = 'Explanations not configured (GEMINI_API_KEY and GEMINI_MODEL are missing on the server).';
  } else if (!apiKeyConfigured) {
    reason = 'Explanations not configured (GEMINI_API_KEY is missing on the server).';
  } else if (!modelConfigured) {
    reason = 'Explanations not configured (GEMINI_MODEL is missing on the server).';
  }

  return {
    configured,
    apiKeyConfigured,
    modelConfigured,
    reason,
    checkedAt: (deps.now ? deps.now() : new Date()).toISOString(),
  };
}

export async function generateStructuredExplanation(
  req: ExplainRequestPayload,
  deps: ExplainServiceDeps = {},
): Promise<{ record: GeminiExplanationRecord; cached: boolean }> {
  const env = (deps.getEnv ?? defaultGetEnv)();
  if (!env.apiKey || !env.model) {
    throw new ExplanationServiceError(
      503,
      'EXPLANATIONS_NOT_CONFIGURED',
      'Explanations not configured',
    );
  }

  const modelName = normalizeModelName(env.model);
  if (!modelName) {
    throw new ExplanationServiceError(
      503,
      'EXPLANATIONS_NOT_CONFIGURED',
      'Explanations not configured',
    );
  }

  const cache = deps.cache ?? defaultCache;
  const cacheKey = `${req.targetId}::${modelName}`;

  if (!req.forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) {
      return { record: cached.value, cached: true };
    }
  }

  const pending = inFlightRequests.get(cacheKey);
  if (pending && !req.forceRefresh) {
    return pending;
  }

  const work = (async (): Promise<{ record: GeminiExplanationRecord; cached: boolean }> => {
    const inputJson = buildExplanationInputJson(req);
    const client = (deps.createClient ?? defaultCreateClient)(env.apiKey!);
    const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const sleep = deps.sleep ?? defaultSleep;

    const isGemini4 = /^gemini-4-/.test(modelName);
    const isGemini3Or4 = /^gemini-[34]/.test(modelName);

    const baseConfig: NonNullable<GenerateContentParameters['config']> = {
      systemInstruction: EXPLAIN_SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: EXPLANATION_RESPONSE_SCHEMA,
      maxOutputTokens: 2048,
      ...(isGemini4 ? {} : { temperature: 0.1 }),
      ...(isGemini3Or4
        ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
        : {}),
    };

    let lastErr: unknown = null;
    let lastTimedOut = false;

    for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      try {
        const response = await client.generateContent({
          model: modelName,
          contents: JSON.stringify(inputJson, null, 2),
          config: {
            ...baseConfig,
            abortSignal: controller.signal,
          },
        });
        clearTimeout(timer);

        const rawText = response.text;
        if (typeof rawText !== 'string' || rawText.trim().length === 0) {
          throw new ExplanationOutputValidationError(
            'EMPTY_MODEL_RESPONSE',
            'Gemini returned an empty response.',
          );
        }

        const { structured, verification, formattedText } =
          validateAndVerifyExplanationOutput(rawText, inputJson);

        const record: GeminiExplanationRecord = {
          kind: req.kind,
          targetId: req.targetId,
          modelName,
          generatedAt: (deps.now ? deps.now() : new Date()).toISOString(),
          structured,
          text: formattedText,
          verification,
          disclaimer: EXPLAIN_DISCLAIMER,
        };

        cache.set(cacheKey, record);
        return { record, cached: false };
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        lastTimedOut = timedOut;

        if (err instanceof ExplanationOutputValidationError) {
          throw new ExplanationServiceError(502, err.code, err.message);
        }

        if (attempt < MAX_RETRY_ATTEMPTS && isRetryableError(err, timedOut)) {
          await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt));
          continue;
        }
        break;
      }
    }

    if (lastTimedOut) {
      throw new ExplanationServiceError(
        504,
        'GEMINI_TIMEOUT',
        `Gemini explanation request timed out after ${Math.round(timeoutMs / 1000)}s.`,
      );
    }

    const status = extractHttpStatus(lastErr);
    const rawMsg =
      lastErr instanceof Error ? lastErr.message : 'Unknown Gemini API error';
    const safeMsg = sanitizeErrorMessage(rawMsg, env.apiKey);

    if (status === 429) {
      throw new ExplanationServiceError(
        429,
        'GEMINI_RATE_LIMITED',
        `Gemini API rate-limited (429): ${safeMsg}`,
      );
    }
    if (status === 400 || status === 401 || status === 403) {
      throw new ExplanationServiceError(
        status,
        'GEMINI_AUTH_ERROR',
        `Gemini API rejected credentials or request (${status}). Check server GEMINI_API_KEY in Settings > Secrets.`,
      );
    }
    if (status === 404) {
      throw new ExplanationServiceError(
        404,
        'GEMINI_MODEL_NOT_FOUND',
        `Configured GEMINI_MODEL "${modelName}" was not found or is unsupported (404).`,
      );
    }

    throw new ExplanationServiceError(
      status && status >= 400 && status < 600 ? status : 502,
      'GEMINI_UPSTREAM_ERROR',
      `Gemini explanation request failed: ${safeMsg}`,
    );
  })();

  if (!req.forceRefresh) {
    inFlightRequests.set(cacheKey, work);
  }

  try {
    return await work;
  } finally {
    if (!req.forceRefresh && inFlightRequests.get(cacheKey) === work) {
      inFlightRequests.delete(cacheKey);
    }
  }
}
