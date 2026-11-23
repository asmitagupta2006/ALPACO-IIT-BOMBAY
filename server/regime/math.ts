import type { CandleResolution, DeltaCandle } from '../../src/contracts/delta.ts';
import type { TimestampGapInfo } from '../../src/contracts/regime.ts';
import {
  BASELINE_VOL_WINDOW,
  CUSUM_DRIFT_K,
  CUSUM_THRESHOLD_H,
  EMA_SLOPE_LOOKBACK,
  EMA_WINDOW,
  GAP_TOLERANCE_MULTIPLIER,
  SHORT_VOL_WINDOW,
  VOL_Z_ZERO_BASELINE_SPIKE_CAP,
  ZERO_STD_EPSILON,
} from './config.ts';

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
  }
}

export function sampleMean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Sample standard deviation (Bessel-corrected, divisor n - 1).
 * Returns 0 for fewer than 2 observations.
 */
export function sampleStdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = sampleMean(values);
  let sumSq = 0;
  for (const v of values) {
    const diff = v - mean;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / (values.length - 1));
}

/**
 * Audits an ascending candle array for timestamp gaps larger than
 * expectedSeconds * toleranceMultiplier without synthesizing fake bars.
 */
export function detectTimestampGaps(
  candles: readonly DeltaCandle[],
  expectedSeconds: number,
  toleranceMultiplier = GAP_TOLERANCE_MULTIPLIER,
): TimestampGapInfo[] {
  if (candles.length < 2 || expectedSeconds <= 0) return [];
  const threshold = expectedSeconds * toleranceMultiplier;
  const gaps: TimestampGapInfo[] = [];

  for (let i = 1; i < candles.length; i++) {
    const delta = candles[i].time - candles[i - 1].time;
    if (delta > threshold) {
      gaps.push({
        fromTime: candles[i - 1].time,
        toTime: candles[i].time,
        deltaSeconds: delta,
        expectedSeconds,
      });
    }
  }
  return gaps;
}

/**
 * 1. Log returns: ln(close[t] / close[t-1]).
 * Strictly causal; index 0 is null. Returns null if either close <= 0 or non-finite.
 */
export function computeLogReturns(candles: readonly DeltaCandle[]): Array<number | null> {
  const result: Array<number | null> = new Array(candles.length).fill(null);
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const curr = candles[i].close;
    if (Number.isFinite(prev) && Number.isFinite(curr) && prev > 0 && curr > 0) {
      result[i] = Math.log(curr / prev);
    }
  }
  return result;
}

/**
 * 2a. Rolling realized volatility over a short window of valid log returns.
 * At index i, inspects logReturns[i - window + 1 .. i]. Requires all `window`
 * entries to be non-null finite numbers.
 */
export function computeRollingShortVol(
  logReturns: readonly (number | null)[],
  window = SHORT_VOL_WINDOW,
): Array<number | null> {
  const result: Array<number | null> = new Array(logReturns.length).fill(null);
  if (window < 2) return result;

  for (let i = window; i < logReturns.length; i++) {
    const slice: number[] = [];
    let valid = true;
    for (let j = i - window + 1; j <= i; j++) {
      const r = logReturns[j];
      if (r === null || !Number.isFinite(r)) {
        valid = false;
        break;
      }
      slice.push(r);
    }
    if (valid && slice.length === window) {
      result[i] = sampleStdDev(slice);
    }
  }
  return result;
}

export interface CausalVolZScorePoint {
  mean: number | null;
  std: number | null;
  zScore: number | null;
}

/**
 * 2b. Strictly causal volatility z-score:
 * Compares shortVol[t] against mean & sample std of prior shortVol[t - baselineWindow .. t - 1].
 * Current bar t is NEVER included in its own baseline.
 */
export function computeCausalVolZScores(
  shortVols: readonly (number | null)[],
  baselineWindow = BASELINE_VOL_WINDOW,
): CausalVolZScorePoint[] {
  const result: CausalVolZScorePoint[] = shortVols.map(() => ({
    mean: null,
    std: null,
    zScore: null,
  }));

  if (baselineWindow < 2) return result;

  for (let i = baselineWindow; i < shortVols.length; i++) {
    const current = shortVols[i];
    if (current === null || !Number.isFinite(current)) continue;

    const prior: number[] = [];
    let valid = true;
    for (let j = i - baselineWindow; j < i; j++) {
      const v = shortVols[j];
      if (v === null || !Number.isFinite(v)) {
        valid = false;
        break;
      }
      prior.push(v);
    }

    if (!valid || prior.length !== baselineWindow) continue;

    const mean = sampleMean(prior);
    const std = sampleStdDev(prior);

    let zScore: number;
    if (std <= ZERO_STD_EPSILON) {
      zScore = current > mean + ZERO_STD_EPSILON ? VOL_Z_ZERO_BASELINE_SPIKE_CAP : 0;
    } else {
      zScore = (current - mean) / std;
    }

    result[i] = { mean, std, zScore };
  }

  return result;
}

/**
 * 3a. Causal Exponential Moving Average on close prices.
 */
export function computeEmaSeries(
  closes: readonly number[],
  span = EMA_WINDOW,
): Array<number | null> {
  const result: Array<number | null> = new Array(closes.length).fill(null);
  if (closes.length === 0 || span < 1) return result;

  const alpha = 2 / (span + 1);
  let prevEma: number | null = null;

  for (let i = 0; i < closes.length; i++) {
    const close = closes[i];
    if (!Number.isFinite(close) || close <= 0) {
      prevEma = null;
      continue;
    }
    if (prevEma === null) {
      prevEma = close;
    } else {
      prevEma = alpha * close + (1 - alpha) * prevEma;
    }
    result[i] = prevEma;
  }

  return result;
}

/**
 * 3b. Trend strength: per-bar relative EMA slope normalized by realized short volatility.
 * trendStrength[t] = ((EMA[t] - EMA[t - k]) / k / EMA[t - k]) / shortVol[t].
 */
export function computeNormalizedEmaSlope(
  emas: readonly (number | null)[],
  shortVols: readonly (number | null)[],
  slopeLookback = EMA_SLOPE_LOOKBACK,
): Array<number | null> {
  const result: Array<number | null> = new Array(emas.length).fill(null);
  if (slopeLookback < 1) return result;

  for (let i = slopeLookback; i < emas.length; i++) {
    const currEma = emas[i];
    const pastEma = emas[i - slopeLookback];
    const vol = shortVols[i];
    if (
      currEma === null ||
      pastEma === null ||
      vol === null ||
      !Number.isFinite(currEma) ||
      !Number.isFinite(pastEma) ||
      !Number.isFinite(vol) ||
      pastEma <= ZERO_STD_EPSILON
    ) {
      continue;
    }

    const slopePerBarPct = ((currEma - pastEma) / slopeLookback) / pastEma;
    if (vol <= ZERO_STD_EPSILON) {
      result[i] =
        Math.abs(slopePerBarPct) <= ZERO_STD_EPSILON
          ? 0
          : Math.sign(slopePerBarPct) * VOL_Z_ZERO_BASELINE_SPIKE_CAP;
    } else {
      result[i] = slopePerBarPct / vol;
    }
  }

  return result;
}

export interface CusumPoint {
  cusumPos: number | null;
  cusumNeg: number | null;
  cusumMax: number | null;
  changePointTriggered: boolean;
}

/**
 * 4. Two-sided tabular CUSUM change-point detector on standardized log returns.
 * At bar t, standardizes logReturn[t] using strictly prior shortVol[t-1] and
 * prior mean return over [t - meanWindow .. t - 1] (zero lookahead).
 * Resets accumulator after emitting a triggered change-point so subsequent shifts
 * remain independently detectable.
 */
export function computeCusumReturns(
  logReturns: readonly (number | null)[],
  shortVols: readonly (number | null)[],
  driftK = CUSUM_DRIFT_K,
  thresholdH = CUSUM_THRESHOLD_H,
  meanWindow = SHORT_VOL_WINDOW,
): CusumPoint[] {
  const result: CusumPoint[] = logReturns.map(() => ({
    cusumPos: null,
    cusumNeg: null,
    cusumMax: null,
    changePointTriggered: false,
  }));

  let sPos = 0;
  let sNeg = 0;

  for (let i = 1; i < logReturns.length; i++) {
    const r = logReturns[i];
    const prevVol = shortVols[i - 1];
    if (
      r === null ||
      prevVol === null ||
      !Number.isFinite(r) ||
      !Number.isFinite(prevVol) ||
      i - meanWindow < 1
    ) {
      continue;
    }

    const priorReturns: number[] = [];
    let valid = true;
    for (let j = i - meanWindow; j < i; j++) {
      const pj = logReturns[j];
      if (pj === null || !Number.isFinite(pj)) {
        valid = false;
        break;
      }
      priorReturns.push(pj);
    }
    if (!valid || priorReturns.length !== meanWindow) continue;

    const prevMean = sampleMean(priorReturns);
    const diff = r - prevMean;

    let zRet: number;
    if (prevVol <= ZERO_STD_EPSILON) {
      zRet = Math.abs(diff) <= ZERO_STD_EPSILON ? 0 : Math.sign(diff) * thresholdH;
    } else {
      zRet = diff / prevVol;
    }

    sPos = Math.max(0, sPos + zRet - driftK);
    sNeg = Math.max(0, sNeg - zRet - driftK);
    const sMax = Math.max(sPos, sNeg);
    const triggered = sMax >= thresholdH;

    result[i] = {
      cusumPos: sPos,
      cusumNeg: sNeg,
      cusumMax: sMax,
      changePointTriggered: triggered,
    };

    if (triggered) {
      sPos = 0;
      sNeg = 0;
    }
  }

  return result;
}
