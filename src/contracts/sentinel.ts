import type { CandleResolution, DeltaCandle } from './delta';
import type { Phase2RegimeLabel, Phase2RegimeResponse } from './regime';

export type DataSourceMode = 'live';

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

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  eventType: 'data_audit' | 'guardrail_decision' | 'system';
  actor: string;
  strategyId: string | null;
  symbol: string | null;
  action: string;
  details: Record<string, unknown>;
  humanApproved: boolean;
}

export interface MultiAssetRegimeCell {
  symbol: string;
  resolution: CandleResolution;
  currentRegime: Phase2RegimeLabel | null;
  sufficientData: boolean;
  riskScore: number | null;
  shortVolPct: number | null;
  volZScore: number | null;
  trendStrength: number | null;
  lastClose: number | null;
  lastCandleIso: string | null;
}

export interface SentinelOverviewResponse {
  selectedSymbol: string;
  resolution: CandleResolution;
  dataMode: DataSourceMode;
  dataQuality: DatasetQualityReport;
  regime: Phase2RegimeResponse;
  heatmap: MultiAssetRegimeCell[];
  recentCandles: DeltaCandle[];
  generatedAt: string;
}
