import type { CandleResolution } from './delta.ts';
import type { GuardrailAction, GuardrailInputSnapshot } from './guardrails.ts';
import type { Phase2RegimeLabel } from './regime.ts';

export type ExplainEventKind = 'guardrail_alert' | 'regime_change';

export interface ExplainKeyNumber {
  name: string;
  value: string;
}

export interface StructuredExplanationOutput {
  summary: string;
  whyItFired: string[];
  keyNumbers: ExplainKeyNumber[];
  limitations: string[];
}

export interface ExplanationVerificationResult {
  status: 'verified' | 'unverified';
  warnings: string[];
  extraNumbers: string[];
  adviceWordsFound: string[];
  mismatchedKeyNumbers: string[];
}

export interface GeminiExplanationRecord {
  kind: ExplainEventKind;
  targetId: string;
  modelName: string;
  generatedAt: string;
  structured: StructuredExplanationOutput;
  text: string;
  verification: ExplanationVerificationResult;
  disclaimer: string;
}

export interface ExplainStatusResponse {
  configured: boolean;
  apiKeyConfigured: boolean;
  modelConfigured: boolean;
  reason: string | null;
  checkedAt: string;
}

export interface ExplainUnavailableInputItem {
  id: string;
  label: string;
  reason: string;
}

export interface ExplainRequestPayload {
  kind: ExplainEventKind;
  targetId: string;
  symbol: string;
  timeframe: CandleResolution;
  previousRegime: Phase2RegimeLabel | null;
  currentRegime: Phase2RegimeLabel;
  riskScore: number;
  action: GuardrailAction | 'REGIME_CHANGE';
  candleTimestamp: string;
  rulesFired: string[];
  thresholds: string[];
  inputs: GuardrailInputSnapshot;
  unavailableOptionalInputs?: ExplainUnavailableInputItem[];
  forceRefresh?: boolean;
}

export interface ExplainApiResponse {
  data: GeminiExplanationRecord;
  source: string;
  cached: boolean;
}
