import type { CandlePriceBasis, CandleResolution } from './delta';

export type Phase2RegimeLabel = 'Calm/Range' | 'Trending' | 'High-Volatility/Shock';

export interface RegimeParameters {
  shortVolWindow: number;
  baselineVolWindow: number;
  minCandlesRequired: number;
  emaWindow: number;
  emaSlopeLookback: number;
  cusumDriftK: number;
  cusumThresholdH: number;
  volZHighThreshold: number;
  trendStrengthThreshold: number;
  gapToleranceMultiplier: number;
  weights: {
    volZ: number;
    cusum: number;
    trend: number;
    optionalPoolMax: number;
  };
}

export interface RegimeInputItem {
  id: string;
  label: string;
  category: 'candle' | 'ticker_optional';
  available: boolean;
  value: number | null;
  formattedValue: string;
  unit: string;
  weight: number;
  reasonIfExcluded: string | null;
  formulaNote: string;
}

export interface RegimeSeriesPoint {
  time: number;
  close: number;
  logReturn: number | null;
  shortVol: number | null;
  baselineVolMean: number | null;
  baselineVolStd: number | null;
  volZScore: number | null;
  ema: number | null;
  trendStrength: number | null;
  cusumPos: number | null;
  cusumNeg: number | null;
  cusumMax: number | null;
  changePointTriggered: boolean;
  regime: Phase2RegimeLabel | null;
  riskScore: number | null;
}

export interface RegimeTransitionMarker {
  time: number;
  fromRegime: Phase2RegimeLabel;
  toRegime: Phase2RegimeLabel;
  riskScore: number;
  logReturn: number | null;
  shortVol: number | null;
  volZScore: number | null;
  trendStrength: number | null;
  cusumMax: number | null;
  changePointTriggered: boolean;
}

export interface TimestampGapInfo {
  fromTime: number;
  toTime: number;
  deltaSeconds: number;
  expectedSeconds: number;
}

export interface Phase2RegimeResponse {
  symbol: string;
  resolution: CandleResolution;
  basis: CandlePriceBasis;
  sufficientData: boolean;
  insufficientReason: string | null;
  candlesRequired: number;
  candleCountUsed: number;
  classifiedBarCount: number;
  lastCandleTimestamp: number | null;
  lastCandleIso: string | null;
  currentRegime: Phase2RegimeLabel | null;
  score: number | null;
  inputs: RegimeInputItem[];
  parameters: RegimeParameters;
  series: RegimeSeriesPoint[];
  transitions: RegimeTransitionMarker[];
  timestampGaps: TimestampGapInfo[];
  tickerAvailable: boolean;
  tickerError: string | null;
  source: string;
  computedAt: string;
}
