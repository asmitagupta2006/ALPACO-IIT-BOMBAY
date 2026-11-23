import type {
  EngineeredFeatureRow,
  MarketRegime,
  RegimeQuantileThresholds,
} from '../contracts/sentinel';

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * q)));
  return sorted[idx];
}

/**
 * Computes volatility quantile thresholds strictly from the training window
 * to prevent future distribution leakage into validation/test evaluation.
 */
export function computeRegimeQuantiles(
  trainRows: EngineeredFeatureRow[],
): RegimeQuantileThresholds {
  const vols = trainRows.map((r) => r.realizedVol20).filter(Number.isFinite).sort((a, b) => a - b);
  const atrs = trainRows.map((r) => r.atrPct).filter(Number.isFinite).sort((a, b) => a - b);

  return {
    volLowQ25: quantile(vols, 0.28) || 0.0022,
    volHighQ75: quantile(vols, 0.78) || 0.0068,
    atrLowQ25: quantile(atrs, 0.28) || 0.0032,
    atrHighQ75: quantile(atrs, 0.78) || 0.0092,
  };
}

/**
 * Transparent, measurable rule-based regime ground-truth labeling.
 * Evaluated strictly on bar t's observed state (and used as next-bar target y = label(t+1)
 * during supervised training so the ML model learns genuine predictive transition dynamics).
 */
export function labelBarRegime(
  row: EngineeredFeatureRow,
  thresholds: RegimeQuantileThresholds,
  prevRow?: EngineeredFeatureRow,
): MarketRegime {
  const volRatioToHigh = row.realizedVol20 / Math.max(thresholds.volHighQ75, 1e-6);
  const directionFlip =
    prevRow !== undefined &&
    Math.sign(row.ret4) !== 0 &&
    Math.sign(prevRow.ret4) !== 0 &&
    Math.sign(row.ret4) !== Math.sign(prevRow.ret4);

  // 1. Transition / Unstable: volatility shock clustering + range expansion or directional flip
  if (
    (row.volClustering >= 1.38 && (row.rangeExpansion >= 1.45 || directionFlip)) ||
    (row.rangeExpansion >= 2.05 && Math.abs(row.volumeChange) >= 0.65)
  ) {
    return 'Transition / Unstable';
  }

  // 2. High Volatility: elevated realized vol and ATR above training upper quartile
  if (
    row.realizedVol20 >= thresholds.volHighQ75 ||
    (row.atrPct >= thresholds.atrHighQ75 && volRatioToHigh >= 0.9)
  ) {
    return 'High Volatility';
  }

  // 3. Low Volatility: compressed realized vol and ATR below training lower quartile
  if (
    row.realizedVol20 <= thresholds.volLowQ25 &&
    row.atrPct <= thresholds.atrLowQ25 * 1.15 &&
    row.rangeExpansion < 1.25
  ) {
    return 'Low Volatility';
  }

  // 4. Trending: strong directional efficiency & clear EMA20/EMA50 alignment
  if (
    row.trendStrength >= 0.44 ||
    (row.efficiencyRatio >= 0.36 && Math.abs(row.ret16) >= row.atrPct * 2.1)
  ) {
    return 'Trending';
  }

  // 5. Ranging: bounded oscillation without breakout volatility
  return 'Ranging';
}

export function ruleFallbackProbabilities(
  regime: MarketRegime,
): Record<MarketRegime, number> {
  const base: Record<MarketRegime, number> = {
    Trending: 0.07,
    Ranging: 0.07,
    'High Volatility': 0.07,
    'Low Volatility': 0.07,
    'Transition / Unstable': 0.07,
  };
  base[regime] = 0.72;
  return base;
}
