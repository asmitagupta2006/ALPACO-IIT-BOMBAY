import type { CandleResolution } from './delta';
import type { Phase2RegimeLabel } from './regime';

export type GuardrailAction = 'CONTINUE' | 'REDUCE SIZE' | 'PAUSE';

export type GuardrailMetricId =
  | 'risk_score'
  | 'vol_z_score'
  | 'abs_trend_strength'
  | 'cusum_max'
  | 'abs_funding_rate'
  | 'abs_mark_basis'
  | 'abs_oi_change_6h'
  | 'implied_volatility'
  | 'regime';

export type NumericOperator = '>' | '>=' | '<' | '<=';
export type RegimeOperator = '=' | '!=';
export type GuardrailOperator = NumericOperator | RegimeOperator;

export type ConditionLogic = 'OR' | 'AND';

export interface GuardrailCondition {
  id: string;
  metric: GuardrailMetricId;
  operator: GuardrailOperator;
  thresholdNumber?: number;
  thresholdRegime?: Phase2RegimeLabel;
}

export interface GuardrailRule {
  id: string;
  name: string;
  logic: ConditionLogic;
  conditions: GuardrailCondition[];
  action: Exclude<GuardrailAction, 'CONTINUE'>;
  enabled: boolean;
}

export interface EvaluatedConditionDetail {
  conditionId: string;
  metric: GuardrailMetricId;
  metricLabel: string;
  operator: GuardrailOperator;
  thresholdDisplay: string;
  actualValue: number | Phase2RegimeLabel | null;
  actualDisplay: string;
  matched: boolean;
  missingInput: boolean;
  missingReason: string | null;
}

export interface FiredGuardrailRule {
  ruleId: string;
  ruleName: string;
  action: Exclude<GuardrailAction, 'CONTINUE'>;
  logic: ConditionLogic;
  matchedConditions: EvaluatedConditionDetail[];
  allConditions: EvaluatedConditionDetail[];
  summaryText: string;
}

export interface GuardrailInputSnapshot {
  regime: Phase2RegimeLabel;
  riskScore: number;
  volZScore: number | null;
  trendStrength: number | null;
  cusumMax: number | null;
  fundingRate: number | null;
  markIndexBasis: number | null;
  oiChange6h: number | null;
  impliedVolatility: number | null;
}

export interface GuardrailEvaluationResult {
  available: boolean;
  unavailableReason: string | null;
  symbol: string | null;
  timeframe: CandleResolution | null;
  timestamp: string;
  candleTimestamp: string | null;
  action: GuardrailAction | null;
  firedRules: FiredGuardrailRule[];
  evaluatedRuleCount: number;
  enabledRuleCount: number;
  inputs: GuardrailInputSnapshot | null;
  missingInputs: Array<{ metric: GuardrailMetricId; reason: string }>;
  comparisons: string[];
  readOnlyNotice: string;
}

export type AlertDecision = 'approved' | 'dismissed';
export type AlertLifecycleStatus = 'pending' | AlertDecision | 'superseded';

export type AlertExplanationState = 'idle' | 'loading' | 'ready' | 'error';

export interface AlertExplanationSummary {
  modelName: string;
  generatedAt: string;
  status: 'verified' | 'unverified';
  warnings: string[];
  summary: string;
  whyItFired: string[];
  keyNumbers: Array<{ name: string; value: string }>;
  limitations: string[];
  text: string;
  disclaimer: string;
}

export interface FirestoreExplanationData {
  text: string;
  model: string;
  generatedAt: string;
  recordedAt: string | null;
  status: 'verified' | 'unverified';
  summary: string;
  whyItFired: string[];
  limitations: string[];
}

export interface GuardrailAlert {
  id: string;
  signature: string;
  symbol: string;
  timeframe: CandleResolution;
  previousRegime: Phase2RegimeLabel | null;
  regime: Phase2RegimeLabel;
  riskScore: number;
  action: Exclude<GuardrailAction, 'CONTINUE'>;
  firedRules: FiredGuardrailRule[];
  ruleNames: string[];
  thresholds: string[];
  inputValues: GuardrailInputSnapshot;
  comparisons: string[];
  createdAt: string;
  createdAtMs: number;
  candleTimestamp: string;
  status: AlertLifecycleStatus;
  decision: AlertDecision | null;
  decidedAt: string | null;
  firestoreState: 'not_saved' | 'saving' | 'saved' | 'error';
  firestoreError: string | null;
  explanationState: AlertExplanationState;
  explanation: AlertExplanationSummary | null;
  explanationError: { message: string; timestamp: string } | null;
}

export interface FirestoreDecisionRecord {
  id: string;
  uid: string;
  symbol: string;
  timeframe: CandleResolution;
  regime: Phase2RegimeLabel;
  riskScore: number;
  inputValues: GuardrailInputSnapshot;
  rulesFired: string[];
  thresholds: string[];
  action: GuardrailAction;
  decision: AlertDecision | null;
  createdAt: string | null;
  decidedAt: string | null;
  candleTimestamp: string;
  explanation: FirestoreExplanationData | null;
}
