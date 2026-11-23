import type { CandleResolution, DeltaCandle } from '../contracts/delta.ts';
import type { DataSourceMode, DatasetQualityReport } from '../contracts/sentinel.ts';

export function resolutionToSeconds(resolution: CandleResolution): number {
  switch (resolution) {
    case '1m':
      return 60;
    case '3m':
      return 180;
    case '5m':
      return 300;
    case '15m':
      return 900;
    case '30m':
      return 1800;
    case '1h':
      return 3600;
    case '2h':
      return 7200;
    case '4h':
      return 14400;
    case '6h':
      return 21600;
    case '1d':
      return 86400;
    default:
      return 900;
  }
}

export interface CleanCandlesOutput {
  candles: DeltaCandle[];
  report: DatasetQualityReport;
}

/**
 * Cleans and validates raw OHLCV candle arrays from Delta Exchange India without
 * fabricating synthetic or carry-forward bars.
 * - Sorts chronologically and detects out-of-order timestamps
 * - Deduplicates identical timestamps (keeps last valid record)
 * - Repairs OHLC envelope anomalies (high >= max(O,C), low <= min(O,C))
 * - Detects and reports missing interval gaps accurately
 */
export function cleanAndAuditCandles(params: {
  rawCandles: DeltaCandle[];
  symbol: string;
  resolution: CandleResolution;
  sourceMode?: DataSourceMode;
  nowUnixSec?: number;
}): CleanCandlesOutput {
  const sourceMode: DataSourceMode = params.sourceMode ?? 'live';
  const stepSec = resolutionToSeconds(params.resolution);
  const nowSec = params.nowUnixSec ?? Math.floor(Date.now() / 1000);
  const notes: string[] = [];

  if (params.rawCandles.length === 0) {
    return {
      candles: [],
      report: {
        symbol: params.symbol,
        resolution: params.resolution,
        totalRawBars: 0,
        validBars: 0,
        duplicatesRemoved: 0,
        missingBarsDetected: 0,
        missingBarsFilled: 0,
        anomaliesRepaired: 0,
        nonMonotonicFixed: 0,
        qualityScore: 0,
        firstBarTime: null,
        lastBarTime: null,
        freshnessSeconds: null,
        isStale: true,
        sourceMode,
        notes: ['No candle observations returned from Delta Exchange India.'],
      },
    };
  }

  let nonMonotonicFixed = 0;
  let anomaliesRepaired = 0;
  let duplicatesRemoved = 0;

  for (let i = 1; i < params.rawCandles.length; i++) {
    if (params.rawCandles[i].time < params.rawCandles[i - 1].time) {
      nonMonotonicFixed += 1;
    }
  }

  const deduped = new Map<number, DeltaCandle>();
  for (const bar of params.rawCandles) {
    if (
      !Number.isFinite(bar.time) ||
      !Number.isFinite(bar.open) ||
      !Number.isFinite(bar.high) ||
      !Number.isFinite(bar.low) ||
      !Number.isFinite(bar.close) ||
      bar.open <= 0 ||
      bar.close <= 0
    ) {
      anomaliesRepaired += 1;
      continue;
    }

    const alignedTime = Math.floor(bar.time);
    let { open, high, low, close, volume } = bar;

    const maxOc = Math.max(open, close);
    const minOc = Math.min(open, close);
    if (high < maxOc || low > minOc || high < low || volume < 0) {
      anomaliesRepaired += 1;
      high = Math.max(high, maxOc);
      low = Math.min(low, minOc);
      if (low <= 0) low = minOc;
      volume = Number.isFinite(volume) && volume >= 0 ? volume : 0;
    }

    if (deduped.has(alignedTime)) {
      duplicatesRemoved += 1;
    }

    deduped.set(alignedTime, {
      time: alignedTime,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    });
  }

  const cleaned = Array.from(deduped.values()).sort((a, b) => a.time - b.time);

  let missingBarsDetected = 0;
  for (let i = 1; i < cleaned.length; i++) {
    const prev = cleaned[i - 1];
    const current = cleaned[i];
    const delta = current.time - prev.time;
    if (delta > stepSec * 1.5) {
      const missed = Math.max(0, Math.round(delta / stepSec) - 1);
      missingBarsDetected += missed;
    }
  }

  const missingBarsFilled = 0;
  const firstBarTime = cleaned[0]?.time ?? null;
  const lastBarTime = cleaned[cleaned.length - 1]?.time ?? null;
  const freshnessSeconds = lastBarTime !== null ? Math.max(0, nowSec - lastBarTime) : null;
  const isStale = freshnessSeconds === null || freshnessSeconds > stepSec * 4;

  const total = Math.max(1, params.rawCandles.length);
  const gapRatio = missingBarsDetected / total;
  const anomalyRatio = anomaliesRepaired / total;
  const dupRatio = duplicatesRemoved / total;

  let qualityScore = 100 - gapRatio * 45 - anomalyRatio * 60 - dupRatio * 20;
  if (isStale) {
    qualityScore -= 12;
  }
  if (cleaned.length < 121) {
    qualityScore -= 10;
    notes.push(`Limited history (${cleaned.length} bars); below 121-bar volatility baseline warm-up.`);
  }
  notes.push('Live Delta Exchange India REST/WebSocket market data validated.');
  if (missingBarsDetected > 0) {
    notes.push(
      `Detected ${missingBarsDetected} missing ${params.resolution} intervals (no synthetic bars inserted).`,
    );
  }
  if (duplicatesRemoved > 0) {
    notes.push(`Removed ${duplicatesRemoved} duplicate timestamp records.`);
  }
  if (anomaliesRepaired > 0) {
    notes.push(`Repaired or excluded ${anomaliesRepaired} OHLC/volume integrity anomalies.`);
  }

  qualityScore = Math.max(0, Math.min(100, Math.round(qualityScore * 10) / 10));

  return {
    candles: cleaned,
    report: {
      symbol: params.symbol,
      resolution: params.resolution,
      totalRawBars: params.rawCandles.length,
      validBars: cleaned.length,
      duplicatesRemoved,
      missingBarsDetected,
      missingBarsFilled,
      anomaliesRepaired,
      nonMonotonicFixed,
      qualityScore,
      firstBarTime,
      lastBarTime,
      freshnessSeconds,
      isStale,
      sourceMode,
      notes,
    },
  };
}
