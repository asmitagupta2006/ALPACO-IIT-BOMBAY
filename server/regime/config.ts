import type { RegimeParameters } from '../../src/contracts/regime.ts';

/**
 * PHASE 2 REGIME DETECTION ENGINE — CENTRAL PARAMETER CONFIG
 *
 * Every window length, statistical threshold, scaling bound, and score weight
 * is defined here as a named constant with an explicit rationale.
 * None of these values are curve-fitted to a single chart or dataset.
 */

/**
 * Rolling window (in candles) for sample standard deviation of 1-bar log returns.
 * 14 bars is a standard short-horizon realized volatility window (matches Wilder ATR/RSI scale).
 */
export const SHORT_VOL_WINDOW = 14;

/**
 * Longer-term causal baseline window (in candles) over prior realized-volatility observations
 * [t - BASELINE_VOL_WINDOW .. t - 1] used to compute the rolling volatility z-score.
 * Strictly excludes the current bar t to prevent lookahead leakage.
 */
export const BASELINE_VOL_WINDOW = 50;

/**
 * Minimum number of ordered candles required to produce at least 1 fully warmed-up classification:
 * - index 0 has no prior close
 * - indices 1..14 form the first 14-bar shortVol at index 14
 * - indices 14..63 provide 50 prior shortVol values as causal baseline for index 64
 * Total minimum candles = 14 + 50 + 1 = 65.
 */
export const MIN_CANDLES_REQUIRED = SHORT_VOL_WINDOW + BASELINE_VOL_WINDOW + 1;

/**
 * Exponential Moving Average span (in candles) used to smooth closing prices
 * before measuring directional slope.
 */
export const EMA_WINDOW = 20;

/**
 * Lookback interval (in candles) over which EMA slope is measured:
 * slopePct = ((EMA[t] - EMA[t - lookback]) / lookback) / EMA[t - lookback].
 */
export const EMA_SLOPE_LOOKBACK = 5;

/**
 * Two-sided tabular CUSUM slack / drift allowance (k) in standardized return units (sigma).
 * k = 0.5 filters routine Gaussian noise while accumulating persistent shifts >= 1 sigma.
 */
export const CUSUM_DRIFT_K = 0.5;

/**
 * Two-sided tabular CUSUM decision threshold (H) in standardized return units.
 * Standard quality-control threshold H = 4.0 triggers a change-point signal when cumulative
 * standardized return excess reaches 4.0 sigma.
 */
export const CUSUM_THRESHOLD_H = 4.0;

/**
 * Volatility z-score threshold above which the market is classified as High-Volatility/Shock.
 * A z-score >= 1.5 corresponds to realized volatility at least 1.5 standard deviations above
 * its own 50-bar causal baseline.
 */
export const VOL_Z_HIGH_THRESHOLD = 1.5;

/**
 * Volatility-normalized EMA slope threshold for Trending classification.
 * |slopePct / shortVol| >= 0.25 indicates sustained directional drift relative to per-bar volatility.
 */
export const TREND_STRENGTH_THRESHOLD = 0.25;

/**
 * Numerical stability floor preventing division by zero when variance or price is flat.
 */
export const ZERO_STD_EPSILON = 1e-12;

/**
 * Cap applied to volatility z-score if and only if a zero-variance baseline (sd = 0)
 * is followed by strictly higher realized volatility (shortVol > mu).
 */
export const VOL_Z_ZERO_BASELINE_SPIKE_CAP = 4.0;

/**
 * Multiplier applied to expected candle step duration (e.g. 1.5 * 900s for 15m)
 * when auditing for missing timestamps in the raw candle series.
 */
export const GAP_TOLERANCE_MULTIPLIER = 1.5;

/**
 * Transparent weighted combination for the 0–100 regime-risk score.
 * Core candle features always supply 85% base weight; up to 15% is dynamically
 * allocated across whichever real ticker microstructure fields actually exist
 * for the active instrument. If optional fields are absent, active weights are
 * normalized cleanly so total weight always equals 1.00.
 */
export const CORE_SCORE_WEIGHTS = {
  volZ: 0.4,
  cusum: 0.3,
  trend: 0.15,
} as const;

export const OPTIONAL_TICKER_WEIGHTS = {
  fundingRate: 0.05,
  markIndexBasis: 0.04,
  oiChange6h: 0.03,
  impliedVolatility: 0.03,
} as const;

/**
 * Normalization bounds mapping raw indicator values to [0, 1] risk sub-scores.
 */
export const SCORE_NORMALIZATION = {
  volZMin: -1.0,
  volZMax: 3.0,
  cusumRatioMax: 1.5, // cusumMax / CUSUM_THRESHOLD_H
  trendStrengthMax: 2.0,
  fundingRateRefPct: 0.05, // 0.05% per 8h interval
  markIndexBasisRefPct: 0.5, // 0.50% mark-spot divergence
  oiChange6hRefPct: 10.0, // 10% 6-hour open interest swing
  impliedVolRefPct: 120.0, // 120% annualized option IV
} as const;

export function getRegimeParameters(): RegimeParameters {
  return {
    shortVolWindow: SHORT_VOL_WINDOW,
    baselineVolWindow: BASELINE_VOL_WINDOW,
    minCandlesRequired: MIN_CANDLES_REQUIRED,
    emaWindow: EMA_WINDOW,
    emaSlopeLookback: EMA_SLOPE_LOOKBACK,
    cusumDriftK: CUSUM_DRIFT_K,
    cusumThresholdH: CUSUM_THRESHOLD_H,
    volZHighThreshold: VOL_Z_HIGH_THRESHOLD,
    trendStrengthThreshold: TREND_STRENGTH_THRESHOLD,
    gapToleranceMultiplier: GAP_TOLERANCE_MULTIPLIER,
    weights: {
      volZ: CORE_SCORE_WEIGHTS.volZ,
      cusum: CORE_SCORE_WEIGHTS.cusum,
      trend: CORE_SCORE_WEIGHTS.trend,
      optionalPoolMax:
        OPTIONAL_TICKER_WEIGHTS.fundingRate +
        OPTIONAL_TICKER_WEIGHTS.markIndexBasis +
        OPTIONAL_TICKER_WEIGHTS.oiChange6h +
        OPTIONAL_TICKER_WEIGHTS.impliedVolatility,
    },
  };
}
