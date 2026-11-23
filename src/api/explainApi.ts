import type { ApiErrorResponse } from '../contracts/delta';
import type {
  ExplainApiResponse,
  ExplainRequestPayload,
  ExplainStatusResponse,
} from '../contracts/explain';
import type { AlertExplanationSummary } from '../contracts/guardrails';
import { ProxyRequestError } from './deltaApi';

export async function fetchExplainStatus(signal?: AbortSignal): Promise<ExplainStatusResponse> {
  const res = await fetch('/api/explain/status', {
    headers: { Accept: 'application/json' },
    signal,
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Explain status returned invalid JSON (HTTP ${res.status})`);
  }
  if (!res.ok) {
    throw new Error(`Failed to check explanation status (HTTP ${res.status})`);
  }
  return parsed as ExplainStatusResponse;
}

export async function requestGeminiExplanation(
  payload: ExplainRequestPayload,
  signal?: AbortSignal,
): Promise<ExplainApiResponse> {
  const res = await fetch('/api/explain', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
    signal,
  });

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProxyRequestError({
      error: `Invalid JSON from /api/explain (HTTP ${res.status})`,
      code: 'INVALID_JSON',
      status: res.status,
      source: 'Gemini Explanation Service',
      timestamp: new Date().toISOString(),
    });
  }

  if (!res.ok) {
    const errObj = parsed as Partial<ApiErrorResponse>;
    throw new ProxyRequestError({
      error: errObj.error || `Explanation request failed with HTTP ${res.status}`,
      code: errObj.code || 'EXPLAIN_ERROR',
      status: res.status,
      source: errObj.source || 'Gemini Explanation Service',
      timestamp: errObj.timestamp || new Date().toISOString(),
    });
  }

  return parsed as ExplainApiResponse;
}

export function toAlertExplanationSummary(
  apiRes: ExplainApiResponse,
): AlertExplanationSummary {
  const r = apiRes.data;
  return {
    modelName: r.modelName,
    generatedAt: r.generatedAt,
    status: r.verification.status,
    warnings: r.verification.warnings,
    summary: r.structured.summary,
    whyItFired: r.structured.whyItFired,
    keyNumbers: r.structured.keyNumbers,
    limitations: r.structured.limitations,
    text: r.text,
    disclaimer: r.disclaimer,
  };
}
