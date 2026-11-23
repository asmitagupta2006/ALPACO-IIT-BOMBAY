import { Type, type Schema } from '@google/genai';
import { ALLOWED_RESOLUTIONS } from '../../src/contracts/delta.ts';
import type {
  ExplainRequestPayload,
  ExplainUnavailableInputItem,
  ExplanationVerificationResult,
  StructuredExplanationOutput,
} from '../../src/contracts/explain.ts';
import type { GuardrailInputSnapshot } from '../../src/contracts/guardrails.ts';
import type { Phase2RegimeLabel } from '../../src/contracts/regime.ts';

export const EXPLAIN_DISCLAIMER =
  'AI-generated explanation. Decisions come from the rules, not the model.';

export const EXPLAIN_SYSTEM_INSTRUCTION = [
  'You are a technical market-risk telemetry explainer for Regime Sentinel.',
  'STRICT GROUNDING RULES:',
  '1. Use ONLY the numbers, labels, thresholds, and facts explicitly provided in the input JSON.',
  '2. Do NOT invent any numbers, percentages, prices, statistics, news, catalysts, or external market events.',
  '3. Do NOT predict future prices, volatility, or market direction.',
  '4. Do NOT give trading or investment advice. Never use advice or directional positioning words such as buy, sell, long, short, entry, exit, leverage, stop-loss, or take-profit. Use "recent window" and "baseline window" instead of "short-term" or "long-term".',
  '5. If any optional input (funding rate, open interest, mark-vs-spot basis, or implied volatility) is marked unavailable or excluded in the input JSON, explicitly state "not available" for it in limitations.',
  '6. Explain in plain, clear language why the guardrail rules fired (or why the regime shifted) and what the computed numbers mean.',
  '7. Output JSON matching the schema and nothing else:',
  '   - summary: 1 to 2 concise plain-language sentences.',
  '   - whyItFired: 1 to 4 concise bullet points grounded strictly in the input.',
  '   - keyNumbers: 2 to 6 objects with exact name and value strings copied directly from the input JSON (including units, or "not available" if missing).',
  '   - limitations: 1 to 4 concise bullet points noting any inputs that are "not available" and stating that rule evaluation is deterministic.',
].join('\n');

export const EXPLANATION_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.STRING,
      description:
        '1 to 2 plain-language sentences explaining what happened using ONLY numbers present in the input JSON.',
    },
    whyItFired: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        'Plain-language bullet points explaining why the rules fired or why the regime shifted.',
    },
    keyNumbers: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: {
            type: Type.STRING,
            description: 'Metric name copied from the input JSON.',
          },
          value: {
            type: Type.STRING,
            description: 'Exact metric value with unit copied from the input JSON, or "not available".',
          },
        },
        required: ['name', 'value'],
      },
      description: 'Name/value pairs copied verbatim from the input JSON.',
    },
    limitations: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        'Missing optional inputs ("not available") and analytical boundaries using only the input JSON.',
    },
  },
  required: ['summary', 'whyItFired', 'keyNumbers', 'limitations'],
  propertyOrdering: ['summary', 'whyItFired', 'keyNumbers', 'limitations'],
};

export interface ModelInputMetricEntry {
  id: string;
  name: string;
  unit: string;
  available: boolean;
  value: number | null;
  formattedValue: string;
}

export interface ExplanationModelInput {
  eventType: 'guardrail_alert' | 'regime_change';
  targetId: string;
  symbol: string;
  timeframe: string;
  previousRegime: Phase2RegimeLabel | null;
  currentRegime: Phase2RegimeLabel;
  riskScore: {
    name: string;
    value: number;
    unit: string;
    scale: string;
  };
  candleTimestamp: string;
  action: string;
  rulesFired: string[];
  thresholds: string[];
  inputs: ModelInputMetricEntry[];
  unavailableOptionalInputs: Array<{
    id: string;
    name: string;
    status: 'not available';
    reason: string;
  }>;
}

export class ExplanationRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ExplanationRequestError';
    this.status = status;
    this.code = code;
  }
}

export class ExplanationOutputValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ExplanationOutputValidationError';
    this.code = code;
  }
}

const VALID_REGIMES: readonly Phase2RegimeLabel[] = [
  'Calm/Range',
  'Trending',
  'High-Volatility/Shock',
];
const VALID_ACTIONS = new Set(['CONTINUE', 'REDUCE SIZE', 'PAUSE', 'REGIME_CHANGE']);
const SYMBOL_REGEX = /^[A-Za-z0-9_.\-/]{1,40}$/;
const TARGET_ID_REGEX = /^[A-Za-z0-9_.\-/:]{1,140}$/;
const FORBIDDEN_PROMPT_KEYS = new Set([
  'prompt',
  'prompts',
  'contents',
  'messages',
  'systemInstruction',
  'freeText',
  'query',
  'instruction',
]);

function isOptionalFiniteNumber(val: unknown): val is number | null {
  return val === null || (typeof val === 'number' && Number.isFinite(val));
}

function isValidInputSnapshot(raw: unknown): raw is GuardrailInputSnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const s = raw as Record<string, unknown>;
  return (
    typeof s.regime === 'string' &&
    (VALID_REGIMES as readonly string[]).includes(s.regime) &&
    typeof s.riskScore === 'number' &&
    Number.isFinite(s.riskScore) &&
    s.riskScore >= 0 &&
    s.riskScore <= 100 &&
    isOptionalFiniteNumber(s.volZScore) &&
    isOptionalFiniteNumber(s.trendStrength) &&
    isOptionalFiniteNumber(s.cusumMax) &&
    isOptionalFiniteNumber(s.fundingRate) &&
    isOptionalFiniteNumber(s.markIndexBasis) &&
    isOptionalFiniteNumber(s.oiChange6h) &&
    isOptionalFiniteNumber(s.impliedVolatility)
  );
}

/**
 * Validates POST /api/explain payloads. Rejects any free-text prompt fields from the browser.
 */
export function validateExplainRequest(body: unknown): ExplainRequestPayload {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ExplanationRequestError(
      400,
      'INVALID_EXPLAIN_REQUEST',
      'Request body must be a JSON object of real computed alert or regime metrics.',
    );
  }

  const obj = body as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (FORBIDDEN_PROMPT_KEYS.has(key)) {
      throw new ExplanationRequestError(
        400,
        'FREE_TEXT_NOT_ALLOWED',
        `Free-text prompt field "${key}" is not accepted. Only structured alert/regime metrics are permitted.`,
      );
    }
  }

  const kind = obj.kind;
  if (kind !== 'guardrail_alert' && kind !== 'regime_change') {
    throw new ExplanationRequestError(
      400,
      'INVALID_EVENT_KIND',
      'kind must be "guardrail_alert" or "regime_change".',
    );
  }

  const targetId = typeof obj.targetId === 'string' ? obj.targetId.trim() : '';
  if (!TARGET_ID_REGEX.test(targetId)) {
    throw new ExplanationRequestError(400, 'INVALID_TARGET_ID', 'Invalid or missing targetId.');
  }

  const symbol = typeof obj.symbol === 'string' ? obj.symbol.trim() : '';
  if (!SYMBOL_REGEX.test(symbol)) {
    throw new ExplanationRequestError(400, 'INVALID_SYMBOL', 'Invalid or missing symbol.');
  }

  const timeframe = typeof obj.timeframe === 'string' ? obj.timeframe.trim() : '';
  if (!(ALLOWED_RESOLUTIONS as readonly string[]).includes(timeframe)) {
    throw new ExplanationRequestError(400, 'INVALID_TIMEFRAME', 'Unsupported timeframe.');
  }

  const previousRegimeRaw = obj.previousRegime ?? null;
  if (
    previousRegimeRaw !== null &&
    (typeof previousRegimeRaw !== 'string' ||
      !(VALID_REGIMES as readonly string[]).includes(previousRegimeRaw))
  ) {
    throw new ExplanationRequestError(400, 'INVALID_PREVIOUS_REGIME', 'Invalid previousRegime.');
  }

  const currentRegime = obj.currentRegime;
  if (
    typeof currentRegime !== 'string' ||
    !(VALID_REGIMES as readonly string[]).includes(currentRegime)
  ) {
    throw new ExplanationRequestError(400, 'INVALID_CURRENT_REGIME', 'Invalid currentRegime.');
  }

  const riskScore = obj.riskScore;
  if (typeof riskScore !== 'number' || !Number.isFinite(riskScore) || riskScore < 0 || riskScore > 100) {
    throw new ExplanationRequestError(400, 'INVALID_RISK_SCORE', 'riskScore must be 0–100.');
  }

  const action = obj.action;
  if (typeof action !== 'string' || !VALID_ACTIONS.has(action)) {
    throw new ExplanationRequestError(400, 'INVALID_ACTION', 'Invalid action.');
  }

  const candleTimestamp =
    typeof obj.candleTimestamp === 'string' ? obj.candleTimestamp.trim() : '';
  if (candleTimestamp.length < 4 || candleTimestamp.length > 40) {
    throw new ExplanationRequestError(
      400,
      'INVALID_CANDLE_TIMESTAMP',
      'Invalid or missing candleTimestamp.',
    );
  }

  const rulesFired = Array.isArray(obj.rulesFired)
    ? obj.rulesFired
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20)
    : [];

  const thresholds = Array.isArray(obj.thresholds)
    ? obj.thresholds
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20)
    : [];

  if (kind === 'guardrail_alert' && (rulesFired.length === 0 || thresholds.length === 0)) {
    throw new ExplanationRequestError(
      400,
      'MISSING_FIRED_RULES',
      'Guardrail alert explanation requires real fired rules and thresholds.',
    );
  }

  if (!isValidInputSnapshot(obj.inputs)) {
    throw new ExplanationRequestError(
      400,
      'INVALID_INPUT_SNAPSHOT',
      'inputs must contain real computed regime metrics.',
    );
  }

  const unavailableOptionalInputs: ExplainUnavailableInputItem[] = Array.isArray(
    obj.unavailableOptionalInputs,
  )
    ? obj.unavailableOptionalInputs
        .filter(
          (item): item is ExplainUnavailableInputItem =>
            Boolean(item) &&
            typeof item === 'object' &&
            typeof (item as ExplainUnavailableInputItem).id === 'string' &&
            typeof (item as ExplainUnavailableInputItem).label === 'string' &&
            typeof (item as ExplainUnavailableInputItem).reason === 'string',
        )
        .slice(0, 12)
    : [];

  return {
    kind,
    targetId,
    symbol,
    timeframe: timeframe as ExplainRequestPayload['timeframe'],
    previousRegime: previousRegimeRaw as Phase2RegimeLabel | null,
    currentRegime: currentRegime as Phase2RegimeLabel,
    riskScore,
    action: action as ExplainRequestPayload['action'],
    candleTimestamp,
    rulesFired,
    thresholds,
    inputs: obj.inputs,
    unavailableOptionalInputs,
    forceRefresh: obj.forceRefresh === true,
  };
}

function formatMetric(value: number | null, unit: string, decimals: number): string {
  if (value === null || !Number.isFinite(value)) return 'not available';
  return `${value.toFixed(decimals)} ${unit}`.trim();
}

/**
 * Builds the strictly structured JSON object sent to Gemini from real computed telemetry.
 */
export function buildExplanationInputJson(
  req: ExplainRequestPayload,
): ExplanationModelInput {
  const unavailableLookup = new Map<string, string>();
  for (const item of req.unavailableOptionalInputs ?? []) {
    unavailableLookup.set(item.id, item.reason);
  }

  const metricSpecs: Array<{
    id: keyof GuardrailInputSnapshot;
    name: string;
    unit: string;
    decimals: number;
    optional: boolean;
  }> = [
    { id: 'volZScore', name: 'Volatility Z-Score', unit: 'σ', decimals: 2, optional: false },
    { id: 'trendStrength', name: 'Trend Strength', unit: 'σ', decimals: 2, optional: false },
    { id: 'cusumMax', name: 'CUSUM Change-Point', unit: 'σ', decimals: 2, optional: false },
    { id: 'fundingRate', name: 'Funding Rate (8h)', unit: '%', decimals: 4, optional: true },
    { id: 'markIndexBasis', name: 'Mark vs Spot Basis', unit: '%', decimals: 4, optional: true },
    { id: 'oiChange6h', name: '6h Open Interest Change', unit: '%', decimals: 2, optional: true },
    {
      id: 'impliedVolatility',
      name: 'Implied Volatility (Mark IV)',
      unit: '%',
      decimals: 2,
      optional: true,
    },
  ];

  const inputs: ModelInputMetricEntry[] = [
    {
      id: 'riskScore',
      name: 'Regime Risk Score',
      unit: 'pts',
      available: true,
      value: req.riskScore,
      formattedValue: `${req.riskScore.toFixed(1)} pts`,
    },
  ];

  const unavailableOptionalInputs: ExplanationModelInput['unavailableOptionalInputs'] = [];

  for (const spec of metricSpecs) {
    const rawVal = req.inputs[spec.id];
    const numVal = typeof rawVal === 'number' && Number.isFinite(rawVal) ? rawVal : null;
    const available = numVal !== null;

    inputs.push({
      id: spec.id,
      name: spec.name,
      unit: spec.unit,
      available,
      value: numVal,
      formattedValue: formatMetric(numVal, spec.unit, spec.decimals),
    });

    if (!available && spec.optional) {
      unavailableOptionalInputs.push({
        id: spec.id,
        name: spec.name,
        status: 'not available',
        reason:
          unavailableLookup.get(spec.id) ??
          'Excluded / not returned by Delta Exchange API for this contract',
      });
    }
  }

  return {
    eventType: req.kind,
    targetId: req.targetId,
    symbol: req.symbol,
    timeframe: req.timeframe,
    previousRegime: req.previousRegime,
    currentRegime: req.currentRegime,
    riskScore: {
      name: 'Regime Risk Score',
      value: req.riskScore,
      unit: 'pts',
      scale: '0 to 100',
    },
    candleTimestamp: req.candleTimestamp,
    action:
      req.action === 'REGIME_CHANGE'
        ? 'REGIME SHIFT OBSERVED (no rule action override)'
        : req.action,
    rulesFired: req.rulesFired,
    thresholds: req.thresholds,
    inputs,
    unavailableOptionalInputs,
  };
}

/**
 * Extracts numeric values from free text while safely separating ISO date/time parts
 * and range hyphens (e.g. "0-100") so minus signs only attach to signed numbers.
 */
export function extractNumericTokens(text: string): number[] {
  // Replace ISO-like timestamps with space-separated date/time digits so '-' in 2026-11-23 isn't parsed as -11
  const normalizedIso = text.replace(
    /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z?/g,
    '$1 $2 $3 $4 $5 $6',
  );
  // Split range hyphens like "0-100" or "1-2" into separate positive tokens
  const normalizedRanges = normalizedIso.replace(/(\d)-(\d)/g, '$1 $2');

  const matches = normalizedRanges.match(/(?:^|[\s(,:=>/<+\[])(-?\d+(?:\.\d+)?)/g);
  if (!matches) return [];

  const nums: number[] = [];
  for (const m of matches) {
    const cleaned = m.replace(/^[^\d-]+/, '');
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) {
      nums.push(parsed);
    }
  }
  return nums;
}

function collectAllowedInputNumbers(input: ExplanationModelInput): number[] {
  const allowed = new Set<number>();

  const addAllFromString = (str: string) => {
    for (const n of extractNumericTokens(str)) {
      allowed.add(n);
      allowed.add(Math.abs(n));
    }
  };

  allowed.add(input.riskScore.value);
  allowed.add(Number(input.riskScore.value.toFixed(1)));
  addAllFromString(input.riskScore.scale);
  addAllFromString(input.symbol);
  addAllFromString(input.timeframe);
  addAllFromString(input.candleTimestamp);

  for (const r of input.rulesFired) addAllFromString(r);
  for (const t of input.thresholds) addAllFromString(t);
  for (const item of input.inputs) {
    addAllFromString(item.name);
    if (item.value !== null) {
      allowed.add(item.value);
      allowed.add(Math.abs(item.value));
      allowed.add(Number(item.value.toFixed(2)));
      allowed.add(Number(Math.abs(item.value).toFixed(2)));
      allowed.add(Number(item.value.toFixed(4)));
      allowed.add(Number(Math.abs(item.value).toFixed(4)));
      addAllFromString(item.formattedValue);
    }
  }
  for (const unavail of input.unavailableOptionalInputs) {
    addAllFromString(unavail.name);
  }

  return Array.from(allowed);
}

function numberMatchesAllowed(candidate: number, allowed: number[]): boolean {
  return allowed.some((a) => Math.abs(candidate - a) <= 1e-4);
}

const ADVICE_WORD_REGEX =
  /\b(buy|buying|bought|sell|selling|sold|long|longing|short|shorting|entry|entries|exit|exits|leverage|stop[- ]?loss|take[- ]?profit)\b/gi;

function stripOptionalJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

/**
 * Parses Gemini's JSON response against the strict schema and verifies groundedness.
 * Never edits or sanitizes the model's text — instead sets verification.status = 'unverified'
 * with explicit warnings if extra numbers, advice words, or keyNumber mismatches are found.
 */
export function validateAndVerifyExplanationOutput(
  rawText: string,
  inputJson: ExplanationModelInput,
): {
  structured: StructuredExplanationOutput;
  verification: ExplanationVerificationResult;
  formattedText: string;
} {
  const cleaned = stripOptionalJsonFence(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new ExplanationOutputValidationError(
      'MALFORMED_MODEL_JSON',
      'Model returned malformed JSON that did not match the explanation schema.',
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ExplanationOutputValidationError(
      'INVALID_MODEL_SCHEMA',
      'Model output must be a JSON object.',
    );
  }

  const obj = parsed as Record<string, unknown>;
  const allowedTopKeys = new Set(['summary', 'whyItFired', 'keyNumbers', 'limitations']);
  for (const key of Object.keys(obj)) {
    if (!allowedTopKeys.has(key)) {
      throw new ExplanationOutputValidationError(
        'UNEXPECTED_MODEL_FIELDS',
        `Model returned unexpected field "${key}".`,
      );
    }
  }

  if (typeof obj.summary !== 'string' || obj.summary.trim().length === 0) {
    throw new ExplanationOutputValidationError(
      'INVALID_MODEL_SCHEMA',
      'Model output is missing a non-empty summary string.',
    );
  }

  if (
    !Array.isArray(obj.whyItFired) ||
    obj.whyItFired.length === 0 ||
    !obj.whyItFired.every((item) => typeof item === 'string' && item.trim().length > 0)
  ) {
    throw new ExplanationOutputValidationError(
      'INVALID_MODEL_SCHEMA',
      'Model output must include a non-empty whyItFired string list.',
    );
  }

  if (
    !Array.isArray(obj.keyNumbers) ||
    !obj.keyNumbers.every(
      (item) =>
        Boolean(item) &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        typeof (item as { name?: unknown }).name === 'string' &&
        (item as { name: string }).name.trim().length > 0 &&
        typeof (item as { value?: unknown }).value === 'string' &&
        (item as { value: string }).value.trim().length > 0,
    )
  ) {
    throw new ExplanationOutputValidationError(
      'INVALID_MODEL_SCHEMA',
      'Model output must include keyNumbers as { name, value } string pairs.',
    );
  }

  if (
    !Array.isArray(obj.limitations) ||
    !obj.limitations.every((item) => typeof item === 'string' && item.trim().length > 0)
  ) {
    throw new ExplanationOutputValidationError(
      'INVALID_MODEL_SCHEMA',
      'Model output must include limitations as a string list.',
    );
  }

  const structured: StructuredExplanationOutput = {
    summary: obj.summary,
    whyItFired: obj.whyItFired,
    keyNumbers: obj.keyNumbers as Array<{ name: string; value: string }>,
    limitations: obj.limitations,
  };

  // Verification checks (without mutating any model text)
  const allowedNumbers = collectAllowedInputNumbers(inputJson);
  const extraNumbersSet = new Set<string>();
  const mismatchedKeyNumbers: string[] = [];

  // 1. Validate keyNumbers against inputJson entries
  for (const kn of structured.keyNumbers) {
    const tokens = extractNumericTokens(kn.value);
    const matchingInput = inputJson.inputs.find((inp) => {
      const nLower = kn.name.toLowerCase();
      return (
        nLower.includes(inp.name.toLowerCase()) ||
        inp.name.toLowerCase().includes(nLower) ||
        nLower.includes(inp.id.toLowerCase())
      );
    });

    if (matchingInput) {
      if (!matchingInput.available) {
        if (!/not available|unavailable|excluded/i.test(kn.value)) {
          mismatchedKeyNumbers.push(
            `${kn.name}: expected "not available", got "${kn.value}"`,
          );
        }
      } else if (matchingInput.value !== null) {
        if (tokens.length === 0) {
          mismatchedKeyNumbers.push(
            `${kn.name}: missing numeric value (input is ${matchingInput.formattedValue})`,
          );
        } else {
          const anyMatches = tokens.some(
            (t) =>
              Math.abs(t - matchingInput.value!) <= 1e-4 ||
              Math.abs(t - Math.abs(matchingInput.value!)) <= 1e-4,
          );
          if (!anyMatches) {
            mismatchedKeyNumbers.push(
              `${kn.name}: "${kn.value}" does not match input ${matchingInput.formattedValue}`,
            );
          }
        }
      }
    }

    for (const num of tokens) {
      if (!numberMatchesAllowed(num, allowedNumbers)) {
        extraNumbersSet.add(String(num));
      }
    }
  }

  // 2. Scan all text fields for ungrounded numbers & advice words
  const allTexts = [
    structured.summary,
    ...structured.whyItFired,
    ...structured.keyNumbers.map((k) => `${k.name}: ${k.value}`),
    ...structured.limitations,
  ];

  const adviceWordsSet = new Set<string>();
  for (const fragment of allTexts) {
    for (const num of extractNumericTokens(fragment)) {
      if (!numberMatchesAllowed(num, allowedNumbers)) {
        extraNumbersSet.add(String(num));
      }
    }

    ADVICE_WORD_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ADVICE_WORD_REGEX.exec(fragment)) !== null) {
      adviceWordsSet.add(match[0].toLowerCase());
    }
  }

  const extraNumbers = Array.from(extraNumbersSet);
  const adviceWordsFound = Array.from(adviceWordsSet);
  const warnings: string[] = [];

  if (mismatchedKeyNumbers.length > 0) {
    warnings.push(`Key numbers mismatch: ${mismatchedKeyNumbers.join('; ')}`);
  }
  if (extraNumbers.length > 0) {
    warnings.push(
      `Text mentions number(s) not present in input metrics: ${extraNumbers.join(', ')}`,
    );
  }
  if (adviceWordsFound.length > 0) {
    warnings.push(
      `Text contains trading/advice wording (${adviceWordsFound.join(', ')})`,
    );
  }

  const verification: ExplanationVerificationResult = {
    status: warnings.length > 0 ? 'unverified' : 'verified',
    warnings,
    extraNumbers,
    adviceWordsFound,
    mismatchedKeyNumbers,
  };

  const formattedText = [
    structured.summary,
    ...structured.whyItFired.map((b) => `- ${b}`),
  ].join('\n');

  return { structured, verification, formattedText };
}
