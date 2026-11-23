import type { CandleResolution, DeltaCandle } from './delta';

export const MARKET_REGIMES = [
  'Trending',
  'Ranging',
  'High Volatility',
  'Low Volatility',
  'Transition / Unstable',
] as const;

export type MarketRegime = (typeof MARKET_REGIMES)[number];

export type RiskAction =
  | 'CONTINUE'
  | 'MONITOR'
  | 'REDUCE EXPOSURE'
  | 'CONSIDER PAUSING'
  | 'CRITICAL RISK WARNING';

export type AlertSeverity = 'Information' | 'Warning' | 'Critical';

export type DataSourceMode = 'live' | 'historical_cache' | 'demo_fallback';

export type StrategyArchetype =
  | 'trend_following'
  | 'mean_reversion'
  | 'volatility_breakout'
  | 'funding_arbitrage';

export interface DatasetQualityReport {
  symbol: string;
  resolution: CandleResolution;
  totalRawBars: number;
  validBars: number;
  duplicatesRemoved: number;
  missingBarsDetected: number;
  missingBarsFilled: number;
  anomaliesRepaired: number;
  nonMonotonicFixed: number;
  qualityScore: number; // 0..100
  firstBarTime: number | null;
  lastBarTime: number | null;
  freshnessSeconds: number | null;
  isStale: boolean;
  sourceMode: DataSourceMode;
  notes: string[];
}

export interface EngineeredFeatureRow {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi14: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  atr14: number;
  atrPct: number;
  ret1: number;
  ret4: number;
  ret16: number;
  realizedVol20: number;
  volClustering: number;
  trendStrength: number;
  efficiencyRatio: number;
  rangeExpansion: number;
  volumeChange: number;
  fundingRate: number;
  oiChangePct: number;
}

export interface RegimeQuantileThresholds {
  volLowQ25: number;
  volHighQ75: number;
  atrLowQ25: number;
  atrHighQ75: number;
}

export interface RegimeInference {
  symbol: string;
  resolution: CandleResolution;
  timestamp: number;
  regime: MarketRegime;
  probabilities: Record<MarketRegime, number>;
  confidence: number;
  modelVersion: string;
  modelAlgorithm: string;
  isFallbackRule: boolean;
  features: EngineeredFeatureRow;
  topDrivers: FeatureContribution[];
}

export interface RegimeTimelinePoint {
  time: number;
  close: number;
  regime: MarketRegime;
  confidence: number;
  realizedVol20: number;
  trendStrength: number;
  atrPct: number;
}

export interface FeatureContribution {
  feature: string;
  label: string;
  value: number;
  contribution: number;
  direction: 'increases_risk' | 'reduces_risk' | 'supports_regime' | 'opposes_regime';
}

export interface StrategyProfile {
  id: string;
  name: string;
  archetype: StrategyArchetype;
  symbol: string;
  timeframe: CandleResolution;
  preferredRegimes: MarketRegime[];
  hostileRegimes: MarketRegime[];
  tradingMode: 'paper' | 'live_gated';
  status: 'active' | 'reduced' | 'paused' | 'killed';
  leverage: number;
  exposureUsd: number;
  equityUsd: number;
  recentDrawdownPct: number;
  maxDrawdownPct: number;
  dailyLossPct: number;
  winRatePct: number;
  profitFactor: number;
  consecutiveLosses: number;
  avgSlippageBps: number;
  recentReturnsPct: number[];
  isSimulatedMetrics: boolean;
}

export interface StrategyHealthBreakdown {
  strategyId: string;
  totalScore: number; // 0..100
  statusLabel: 'Healthy' | 'Watch' | 'Degraded' | 'Critical';
  components: {
    baseScore: number;
    drawdownPenalty: number;
    streakPenalty: number;
    slippagePenalty: number;
    volExposurePenalty: number;
    regimeMismatchPenalty: number;
    profitFactorAdjustment: number;
  };
  formulaSummary: string;
  measuredVsSimulated: string;
}

export interface RiskPredictionOutput {
  strategyId: string;
  symbol: string;
  horizonMinutes: 30 | 60;
  probability30m: number;
  probability60m: number;
  riskTier: 'Low' | 'Moderate' | 'Elevated' | 'High' | 'Critical';
  confidence: number;
  calibrationNote: string;
  modelVersion: string;
  isFallbackRule: boolean;
  topFeatures: FeatureContribution[];
}

export interface GuardrailConfig {
  strategyId: string;
  strategyName: string;
  symbol: string;
  maxDailyLossPct: number;
  maxDrawdownPct: number;
  maxExposureUsd: number;
  maxLeverage: number;
  maxSlippageBps: number;
  maxConsecutiveLosses: number;
  maxRiskProbPct: number;
  tradingMode: 'paper' | 'live_gated';
  status: 'active' | 'reduced' | 'paused' | 'killed';
  updatedAt: string;
}

export interface GuardrailBreach {
  rule: string;
  currentValue: string;
  thresholdValue: string;
  severity: AlertSeverity;
  explanation: string;
}

export interface DecisionRecommendation {
  strategyId: string;
  action: RiskAction;
  humanApprovalRequired: boolean;
  usedRuleFallback: boolean;
  fallbackReason: string | null;
  rationale: string[];
  breaches: GuardrailBreach[];
}

export interface StrategyMonitorSnapshot {
  strategy: StrategyProfile;
  health: StrategyHealthBreakdown;
  regime: RegimeInference;
  riskPrediction: RiskPredictionOutput;
  decision: DecisionRecommendation;
  guardrail: GuardrailConfig;
}

export interface RegimeTransitionAlert {
  id: string;
  timestamp: string;
  symbol: string;
  fromRegime: MarketRegime;
  toRegime: MarketRegime;
  severity: AlertSeverity;
  affectedStrategies: Array<{
    strategyId: string;
    strategyName: string;
    healthScore: number;
    riskProb30m: number;
    recommendedAction: RiskAction;
  }>;
  reason: string;
  recommendedAction: RiskAction;
  acknowledged: boolean;
}

export interface ExplainablePrediction {
  strategyId: string;
  strategyName: string;
  symbol: string;
  generatedAt: string;
  whatHappened: string;
  indicatorsChanged: Array<{
    name: string;
    value: string;
    baselineDelta: string;
  }>;
  detectedRegime: MarketRegime;
  regimeConfidencePct: number;
  whyStrategyAffected: string;
  increasedRiskFactors: FeatureContribution[];
  recommendedAction: RiskAction;
  actionJustification: string;
  calibratedConfidence: {
    regimeConfidencePct: number;
    riskCalibrationBrier: number | null;
    dataQualityScore: number;
  };
  limitations: string[];
  geminiNarrative: string | null;
  geminiAvailable: boolean;
}

export interface ConfusionMatrixData {
  labels: string[];
  matrix: number[][];
}

export interface ClassMetrics {
  label: string;
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export interface WalkForwardFoldResult {
  fold: number;
  trainCount: number;
  testCount: number;
  trainStartIso: string;
  testEndIso: string;
  accuracy: number;
  macroF1: number;
  brierScore: number;
}

export interface ModelEvaluationMetrics {
  splitSummary: {
    totalRows: number;
    trainRows: number;
    valRows: number;
    testRows: number;
    purgeGapBars: number;
  };
  trainAccuracy: number;
  valAccuracy: number;
  testAccuracy: number;
  macroPrecision: number;
  macroRecall: number;
  macroF1: number;
  brierScore: number;
  positivePrecision?: number;
  positiveRecall?: number;
  confusionMatrix: ConfusionMatrixData;
  perClass: ClassMetrics[];
  walkForwardFolds: WalkForwardFoldResult[];
  featureImportance: Array<{ feature: string; label: string; importance: number }>;
  hyperparameters: Record<string, string | number>;
  driftPsi: number;
  driftStatus: 'Nominal' | 'Moderate Shift' | 'Drift Alert';
}

export interface ModelVersionRecord {
  id: string;
  modelKind: 'regime' | 'risk';
  version: string;
  algorithm: string;
  symbolScope: string;
  resolution: CandleResolution;
  createdAt: string;
  deployed: boolean;
  status: 'deployed' | 'candidate' | 'archived';
  metrics: ModelEvaluationMetrics;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  eventType:
    | 'regime_transition'
    | 'guardrail_breach'
    | 'kill_switch'
    | 'strategy_resume'
    | 'guardrail_update'
    | 'model_train'
    | 'model_deploy'
    | 'human_approval'
    | 'paper_simulation';
  actor: string;
  strategyId: string | null;
  symbol: string | null;
  action: string;
  details: Record<string, unknown>;
  humanApproved: boolean;
}

export interface PaperSimulationRequest {
  strategyId: string;
  symbol: 'BTCUSD' | 'ETHUSD';
  targetRegime: MarketRegime;
  simulateTransition: boolean;
  transitionToRegime: MarketRegime;
  leverage: number;
  capitalUsd: number;
  barsCount: number;
  takerFeeBps: number;
  baseSlippageBps: number;
}

export interface PaperSimulationStep {
  step: number;
  time: number;
  close: number;
  regime: MarketRegime;
  unguardedEquity: number;
  protectedEquity: number;
  healthScore: number;
  riskProb30m: number;
  action: RiskAction;
  guardrailTriggered: string | null;
  executionCostUsd: number;
}

export interface PaperSimulationResult {
  id: string;
  isSimulated: true;
  disclaimer: string;
  request: PaperSimulationRequest;
  summary: {
    unguardedFinalEquity: number;
    unguardedPnlUsd: number;
    unguardedMaxDrawdownPct: number;
    protectedFinalEquity: number;
    protectedPnlUsd: number;
    protectedMaxDrawdownPct: number;
    minHealthScore: number;
    riskEventsCount: number;
    guardrailBreachesCount: number;
    totalExecutionCostsUsd: number;
    exposureReductions: number;
  };
  steps: PaperSimulationStep[];
  events: Array<{
    step: number;
    time: number;
    severity: AlertSeverity;
    title: string;
    detail: string;
    action: RiskAction;
  }>;
}

export interface MultiAssetRegimeCell {
  symbol: string;
  resolution: CandleResolution;
  regime: MarketRegime;
  confidence: number;
  atrPct: number;
  rsi14: number;
  trendStrength: number;
  lastClose: number;
  dataMode: DataSourceMode;
}

export interface SentinelOverviewResponse {
  selectedSymbol: string;
  resolution: CandleResolution;
  dataMode: DataSourceMode;
  dataQuality: DatasetQualityReport;
  regime: RegimeInference;
  timeline: RegimeTimelinePoint[];
  heatmap: MultiAssetRegimeCell[];
  strategies: StrategyMonitorSnapshot[];
  recentAlerts: RegimeTransitionAlert[];
  activeModels: {
    regime: ModelVersionRecord | null;
    risk: ModelVersionRecord | null;
  };
  recentCandles: DeltaCandle[];
  generatedAt: string;
}
