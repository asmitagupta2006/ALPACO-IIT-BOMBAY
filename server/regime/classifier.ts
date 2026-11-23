import type {
  CandlePriceBasis,
  CandleResolution,
  DeltaCandle,
  DeltaTickerSnapshot,
} from '../../src/contracts/delta.ts';
import type {
  Phase2RegimeLabel,
  Phase2RegimeResponse,
  RegimeInputItem,
  RegimeSeriesPoint,
  RegimeTransitionMarker,
} from '../../src/contracts/regime.ts';
import {
  BASELINE_VOL_WINDOW,
  CORE_SCORE_WEIGHTS,
  CUSUM_DRIFT_K,
  CUSUM_THRESHOLD_H,
  EMA_SLOPE_LOOKBACK,
  EMA_WINDOW,
  GAP_TOLERANCE_MULTIPLIER,
  getRegimeParameters,
  MIN_CANDLES_REQUIRED,
  OPTIONAL_TICKER_WEIGHTS,
  SCORE_NORMALIZATION,
  SHORT_VOL_WINDOW,
  TREND_STRENGTH_THRESHOLD,
  VOL_Z_HIGH_THRESHOLD,
} from './config.ts';
import {
  computeCausalVolZScores,
  computeCusumReturns,
  computeEmaSeries,
  computeLogReturns,
  computeNormalizedEmaSlope,
  computeRollingShortVol,
  detectTimestampGaps,
  resolutionToSeconds,
} from './math.ts';

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export interface ClassifierThresholds {
  volZHighThreshold?: number;
  trendStrengthThreshold?: number;
}

/**
 * Pure bar-level regime classifier using strictly causal inputs up to bar t.
 */
export function classifyBarRegime(
  inputs: {
    volZScore: number | null;
    trendStrength: number | null;
    changePointTriggered: boolean;
  },
  thresholds?: ClassifierThresholds,
): Phase2RegimeLabel | null {
  if (
    inputs.volZScore === null ||
    inputs.trendStrength === null ||
    !Number.isFinite(inputs.volZScore) ||
    !Number.isFinite(inputs.trendStrength)
  ) {
    return null;
  }

  const volZHigh = thresholds?.volZHighThreshold ?? VOL_Z_HIGH_THRESHOLD;
  const trendMin = thresholds?.trendStrengthThreshold ?? TREND_STRENGTH_THRESHOLD;

  if (inputs.volZScore >= volZHigh || inputs.changePointTriggered) {
    return 'High-Volatility/Shock';
  }
  if (Math.abs(inputs.trendStrength) >= trendMin) {
    return 'Trending';
  }
  return 'Calm/Range';
}

export interface OptionalTickerInput {
  id: keyof typeof OPTIONAL_TICKER_WEIGHTS;
  label: string;
  available: boolean;
  value: number | null;
  formattedValue: string;
  unit: string;
  normalizedRisk01: number;
  reasonIfExcluded: string | null;
  formulaNote: string;
}

/**
 * Extracts ONLY real fields that actually exist on DeltaTickerSnapshot.
 * Never substitutes guesses or fallback numbers when a field is absent.
 */
export function extractOptionalTickerInputs(
  ticker: DeltaTickerSnapshot | null,
): OptionalTickerInput[] {
  const isOption =
    ticker?.contractType === 'call_options' || ticker?.contractType === 'put_options';

  // 1. Funding Rate (perpetuals only)
  const fundingAvailable =
    ticker !== null &&
    !isOption &&
    ticker.fundingRate !== null &&
    Number.isFinite(ticker.fundingRate);
  const fundingVal = fundingAvailable ? ticker!.fundingRate! : null;

  // 2. Mark-vs-Index Basis (perpetuals/futures only; for options mark_price is option premium vs spot index)
  let basisPct: number | null = null;
  let basisReason: string | null = null;
  if (!ticker) {
    basisReason = 'Ticker unavailable';
  } else if (isOption) {
    basisReason = 'Absent/not applicable on options (mark is premium vs underlying spot)';
  } else if (ticker.markBasis !== null && Number.isFinite(ticker.markBasis)) {
    basisPct = ticker.markBasis * 100;
  } else if (
    ticker.markPrice !== null &&
    ticker.spotPrice !== null &&
    Number.isFinite(ticker.markPrice) &&
    Number.isFinite(ticker.spotPrice) &&
    ticker.spotPrice > 0
  ) {
    basisPct = ((ticker.markPrice - ticker.spotPrice) / ticker.spotPrice) * 100;
  } else {
    basisReason = 'Mark price or spot index absent from API ticker';
  }

  // 3. Open Interest 6h Change (USD & %)
  const oiPctAvailable =
    ticker !== null &&
    ticker.oiValueUsd !== null &&
    Number.isFinite(ticker.oiValueUsd) &&
    ticker.oiValueUsd > 0 &&
    ticker.oiChangeUsd6h !== null &&
    Number.isFinite(ticker.oiChangeUsd6h);
  const oiChange6hPct = oiPctAvailable
    ? (ticker!.oiChangeUsd6h! / ticker!.oiValueUsd!) * 100
    : null;

  // 4. Implied Volatility (options only, positive values returned by Delta API)
  const rawIv =
    ticker && isOption ? (ticker.markVol ?? ticker.markIv) : null;
  const ivAvailable = rawIv !== null && Number.isFinite(rawIv) && rawIv > 0;
  const ivPct = ivAvailable ? rawIv! * 100 : null;

  return [
    {
      id: 'fundingRate',
      label: 'Funding Rate (8h)',
      available: fundingAvailable,
      value: fundingVal,
      formattedValue: fundingVal !== null ? `${fundingVal >= 0 ? '+' : ''}${fundingVal.toFixed(4)}%` : 'Excluded',
      unit: '%',
      normalizedRisk01:
        fundingVal !== null
          ? clamp01(Math.abs(fundingVal) / SCORE_NORMALIZATION.fundingRateRefPct)
          : 0,
      reasonIfExcluded: fundingAvailable
        ? null
        : ticker
          ? isOption
            ? 'Absent on option contracts'
            : 'funding_rate absent from API ticker'
          : 'Ticker unavailable',
      formulaNote: `|funding_rate| / ${SCORE_NORMALIZATION.fundingRateRefPct}%`,
    },
    {
      id: 'markIndexBasis',
      label: 'Mark vs Spot Basis',
      available: basisPct !== null,
      value: basisPct,
      formattedValue: basisPct !== null ? `${basisPct >= 0 ? '+' : ''}${basisPct.toFixed(4)}%` : 'Excluded',
      unit: '%',
      normalizedRisk01:
        basisPct !== null
          ? clamp01(Math.abs(basisPct) / SCORE_NORMALIZATION.markIndexBasisRefPct)
          : 0,
      reasonIfExcluded: basisPct !== null ? null : basisReason,
      formulaNote: `|mark_basis| / ${SCORE_NORMALIZATION.markIndexBasisRefPct}%`,
    },
    {
      id: 'oiChange6h',
      label: '6h Open Interest Change',
      available: oiChange6hPct !== null,
      value: oiChange6hPct,
      formattedValue:
        oiChange6hPct !== null
          ? `${oiChange6hPct >= 0 ? '+' : ''}${oiChange6hPct.toFixed(2)}%`
          : 'Excluded',
      unit: '%',
      normalizedRisk01:
        oiChange6hPct !== null
          ? clamp01(Math.abs(oiChange6hPct) / SCORE_NORMALIZATION.oiChange6hRefPct)
          : 0,
      reasonIfExcluded: oiPctAvailable
        ? null
        : ticker
          ? 'oi_value_usd or oi_change_usd_6h absent from ticker'
          : 'Ticker unavailable',
      formulaNote:
        ticker?.oiValueUsd !== null && ticker?.oiValueUsd !== undefined
          ? `OI $${Math.round(ticker.oiValueUsd).toLocaleString('en-US')} · |6h Δ| / ${SCORE_NORMALIZATION.oiChange6hRefPct}%`
          : `|6h OI Δ| / ${SCORE_NORMALIZATION.oiChange6hRefPct}%`,
    },
    {
      id: 'impliedVolatility',
      label: 'Implied Volatility (Mark IV)',
      available: ivAvailable,
      value: ivPct,
      formattedValue: ivPct !== null ? `${ivPct.toFixed(2)}%` : 'Excluded',
      unit: '%',
      normalizedRisk01:
        ivPct !== null ? clamp01(ivPct / SCORE_NORMALIZATION.impliedVolRefPct) : 0,
      reasonIfExcluded: ivAvailable
        ? null
        : ticker
          ? isOption
            ? 'mark_vol / mark_iv absent on option ticker'
            : 'Options only (absent on perpetual/futures contracts)'
          : 'Ticker unavailable',
      formulaNote: `mark_vol / ${SCORE_NORMALIZATION.impliedVolRefPct}%`,
    },
  ];
}

export function computeRegimeRiskScore(params: {
  volZScore: number;
  cusumMax: number;
  trendStrength: number;
  optionalInputs?: OptionalTickerInput[];
}): {
  score: number;
  activeWeights: {
    volZ: number;
    cusum: number;
    trend: number;
    optional: Record<string, number>;
  };
} {
  const volZRisk = clamp01(
    (params.volZScore - SCORE_NORMALIZATION.volZMin) /
      (SCORE_NORMALIZATION.volZMax - SCORE_NORMALIZATION.volZMin),
  );
  const cusumRisk = clamp01(
    params.cusumMax / CUSUM_THRESHOLD_H / SCORE_NORMALIZATION.cusumRatioMax,
  );
  const trendRisk = clamp01(
    Math.abs(params.trendStrength) / SCORE_NORMALIZATION.trendStrengthMax,
  );

  const activeOpt = (params.optionalInputs ?? []).filter((item) => item.available);

  let rawWeightSum =
    CORE_SCORE_WEIGHTS.volZ + CORE_SCORE_WEIGHTS.cusum + CORE_SCORE_WEIGHTS.trend;
  for (const opt of activeOpt) {
    rawWeightSum += OPTIONAL_TICKER_WEIGHTS[opt.id];
  }

  const norm = rawWeightSum > 0 ? 1 / rawWeightSum : 1;
  const wVolZ = CORE_SCORE_WEIGHTS.volZ * norm;
  const wCusum = CORE_SCORE_WEIGHTS.cusum * norm;
  const wTrend = CORE_SCORE_WEIGHTS.trend * norm;

  let weightedSum = wVolZ * volZRisk + wCusum * cusumRisk + wTrend * trendRisk;
  const optWeights: Record<string, number> = {};

  for (const opt of params.optionalInputs ?? []) {
    if (opt.available) {
      const w = OPTIONAL_TICKER_WEIGHTS[opt.id] * norm;
      optWeights[opt.id] = w;
      weightedSum += w * opt.normalizedRisk01;
    } else {
      optWeights[opt.id] = 0;
    }
  }

  return {
    score: Math.round(clamp01(weightedSum) * 1000) / 10,
    activeWeights: {
      volZ: wVolZ,
      cusum: wCusum,
      trend: wTrend,
      optional: optWeights,
    },
  };
}

/**
 * Full Phase 2 market-regime evaluation pipeline on real ordered candles + optional ticker.
 */
export function detectMarketRegime(params: {
  symbol: string;
  resolution: CandleResolution;
  basis: CandlePriceBasis;
  candles: DeltaCandle[];
  ticker: DeltaTickerSnapshot | null;
  tickerError?: string | null;
}): Phase2RegimeResponse {
  const ordered = [...params.candles]
    .filter(
      (c) =>
        Number.isFinite(c.time) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close),
    )
    .sort((a, b) => a.time - b.time);

  // Deduplicate exact timestamps keeping latest observation
  const dedupMap = new Map<number, DeltaCandle>();
  for (const c of ordered) {
    dedupMap.set(c.time, c);
  }
  const candles = Array.from(dedupMap.values());

  const parameters = getRegimeParameters();
  const expectedStepSec = resolutionToSeconds(params.resolution);
  const timestampGaps = detectTimestampGaps(
    candles,
    expectedStepSec,
    GAP_TOLERANCE_MULTIPLIER,
  );
  const lastCandle = candles.length > 0 ? candles[candles.length - 1] : null;
  const lastCandleTimestamp = lastCandle ? lastCandle.time : null;
  const lastCandleIso =
    lastCandleTimestamp !== null ? new Date(lastCandleTimestamp * 1000).toISOString() : null;

  const optionalInputs = extractOptionalTickerInputs(params.ticker);
  const computedAt = new Date().toISOString();

  // Compute raw causal series even if below minimum length so gaps/counts are exact
  const closes = candles.map((c) => c.close);
  const logReturns = computeLogReturns(candles);
  const shortVols = computeRollingShortVol(logReturns, SHORT_VOL_WINDOW);
  const volZPoints = computeCausalVolZScores(shortVols, BASELINE_VOL_WINDOW);
  const emas = computeEmaSeries(closes, EMA_WINDOW);
  const trendStrengths = computeNormalizedEmaSlope(
    emas,
    shortVols,
    EMA_SLOPE_LOOKBACK,
  );
  const cusumPoints = computeCusumReturns(
    logReturns,
    shortVols,
    CUSUM_DRIFT_K,
    CUSUM_THRESHOLD_H,
    SHORT_VOL_WINDOW,
  );

  // Build series with zero lookahead; historical bars use candle-only weights
  // while tail bar reflects live optional ticker inputs (since historical ticker history isn't provided by /v2/tickers).
  const series: RegimeSeriesPoint[] = [];
  const transitions: RegimeTransitionMarker[] = [];
  let prevRegime: Phase2RegimeLabel | null = null;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const logReturn = logReturns[i];
    const shortVol = shortVols[i];
    const vz = volZPoints[i];
    const ema = emas[i];
    const trendStrength = trendStrengths[i];
    const cusum = cusumPoints[i];

    const regime = classifyBarRegime({
      volZScore: vz.zScore,
      trendStrength,
      changePointTriggered: cusum.changePointTriggered,
    });

    const isTail = i === candles.length - 1;
    let riskScore: number | null = null;
    if (
      regime !== null &&
      vz.zScore !== null &&
      cusum.cusumMax !== null &&
      trendStrength !== null
    ) {
      riskScore = computeRegimeRiskScore({
        volZScore: vz.zScore,
        cusumMax: cusum.cusumMax,
        trendStrength,
        optionalInputs: isTail ? optionalInputs : undefined,
      }).score;
    }

    series.push({
      time: c.time,
      close: c.close,
      logReturn,
      shortVol,
      baselineVolMean: vz.mean,
      baselineVolStd: vz.std,
      volZScore: vz.zScore,
      ema,
      trendStrength,
      cusumPos: cusum.cusumPos,
      cusumNeg: cusum.cusumNeg,
      cusumMax: cusum.cusumMax,
      changePointTriggered: cusum.changePointTriggered,
      regime,
      riskScore,
    });

    if (regime !== null) {
      if (prevRegime !== null && regime !== prevRegime && riskScore !== null) {
        transitions.push({
          time: c.time,
          fromRegime: prevRegime,
          toRegime: regime,
          riskScore,
          logReturn,
          shortVol,
          volZScore: vz.zScore,
          trendStrength,
          cusumMax: cusum.cusumMax,
          changePointTriggered: cusum.changePointTriggered,
        });
      }
      prevRegime = regime;
    }
  }

  const classifiedPoints = series.filter((p) => p.regime !== null);
  const latestPoint = series.length > 0 ? series[series.length - 1] : null;
  const sufficientData =
    candles.length >= MIN_CANDLES_REQUIRED &&
    latestPoint !== null &&
    latestPoint.regime !== null &&
    latestPoint.riskScore !== null;

  if (!sufficientData) {
    const insufficientReason =
      candles.length < MIN_CANDLES_REQUIRED
        ? `Insufficient data: need at least ${MIN_CANDLES_REQUIRED} candles (${SHORT_VOL_WINDOW}-bar short vol + ${BASELINE_VOL_WINDOW}-bar baseline + 1 return lag), received ${candles.length}.`
        : 'Insufficient data: latest candle lacks complete volatility baseline or trend window (invalid or missing closes).';

    return {
      symbol: params.symbol,
      resolution: params.resolution,
      basis: params.basis,
      sufficientData: false,
      insufficientReason,
      candlesRequired: MIN_CANDLES_REQUIRED,
      candleCountUsed: candles.length,
      classifiedBarCount: classifiedPoints.length,
      lastCandleTimestamp,
      lastCandleIso,
      currentRegime: null,
      score: null,
      inputs: [],
      parameters,
      series,
      transitions,
      timestampGaps,
      tickerAvailable: params.ticker !== null,
      tickerError: params.tickerError ?? null,
      source: 'Source: Delta candles',
      computedAt,
    };
  }

  const tailScore = computeRegimeRiskScore({
    volZScore: latestPoint.volZScore!,
    cusumMax: latestPoint.cusumMax!,
    trendStrength: latestPoint.trendStrength!,
    optionalInputs,
  });

  const inputs: RegimeInputItem[] = [
    {
      id: 'logReturn',
      label: 'Log Return (Latest Bar)',
      category: 'candle',
      available: latestPoint.logReturn !== null,
      value: latestPoint.logReturn,
      formattedValue:
        latestPoint.logReturn !== null
          ? `${latestPoint.logReturn >= 0 ? '+' : ''}${(latestPoint.logReturn * 100).toFixed(4)}%`
          : '—',
      unit: '%',
      weight: 0,
      reasonIfExcluded: null,
      formulaNote: 'ln(close[t] / close[t-1]) · feeds rolling vol & CUSUM',
    },
    {
      id: 'shortVol',
      label: `Realized Volatility (${SHORT_VOL_WINDOW}-bar)`,
      category: 'candle',
      available: latestPoint.shortVol !== null,
      value: latestPoint.shortVol,
      formattedValue:
        latestPoint.shortVol !== null ? `${(latestPoint.shortVol * 100).toFixed(4)}%` : '—',
      unit: '% / bar',
      weight: 0,
      reasonIfExcluded: null,
      formulaNote: `Sample std dev of ${SHORT_VOL_WINDOW} log returns · baseline mean ${
        latestPoint.baselineVolMean !== null
          ? `${(latestPoint.baselineVolMean * 100).toFixed(4)}%`
          : '—'
      }`,
    },
    {
      id: 'volZScore',
      label: `Volatility Z-Score (${BASELINE_VOL_WINDOW}-bar baseline)`,
      category: 'candle',
      available: latestPoint.volZScore !== null,
      value: latestPoint.volZScore,
      formattedValue:
        latestPoint.volZScore !== null
          ? `${latestPoint.volZScore >= 0 ? '+' : ''}${latestPoint.volZScore.toFixed(2)}σ`
          : '—',
      unit: 'σ',
      weight: tailScore.activeWeights.volZ,
      reasonIfExcluded: null,
      formulaNote: `(shortVol[t] - μ_${BASELINE_VOL_WINDOW}) / σ_${BASELINE_VOL_WINDOW} (shock ≥ ${VOL_Z_HIGH_THRESHOLD}σ)`,
    },
    {
      id: 'trendStrength',
      label: `Trend Strength (EMA ${EMA_WINDOW} / Vol)`,
      category: 'candle',
      available: latestPoint.trendStrength !== null,
      value: latestPoint.trendStrength,
      formattedValue:
        latestPoint.trendStrength !== null
          ? `${latestPoint.trendStrength >= 0 ? '+' : ''}${latestPoint.trendStrength.toFixed(2)}σ`
          : '—',
      unit: 'σ',
      weight: tailScore.activeWeights.trend,
      reasonIfExcluded: null,
      formulaNote: `${EMA_SLOPE_LOOKBACK}-bar EMA(${EMA_WINDOW}) % slope / shortVol (trend ≥ ${TREND_STRENGTH_THRESHOLD}σ)`,
    },
    {
      id: 'cusumMax',
      label: 'Return CUSUM Change-Point',
      category: 'candle',
      available: latestPoint.cusumMax !== null,
      value: latestPoint.cusumMax,
      formattedValue:
        latestPoint.cusumMax !== null
          ? `${latestPoint.cusumMax.toFixed(2)}σ${
              latestPoint.changePointTriggered ? ' (TRIGGERED)' : ''
            }`
          : '—',
      unit: 'σ',
      weight: tailScore.activeWeights.cusum,
      reasonIfExcluded: null,
      formulaNote: `max(S+, S-) with k=${CUSUM_DRIFT_K}σ, H=${CUSUM_THRESHOLD_H}σ`,
    },
    ...optionalInputs.map((opt) => ({
      id: opt.id,
      label: opt.label,
      category: 'ticker_optional' as const,
      available: opt.available,
      value: opt.value,
      formattedValue: opt.formattedValue,
      unit: opt.unit,
      weight: tailScore.activeWeights.optional[opt.id] ?? 0,
      reasonIfExcluded: opt.reasonIfExcluded,
      formulaNote: opt.formulaNote,
    })),
  ];

  return {
    symbol: params.symbol,
    resolution: params.resolution,
    basis: params.basis,
    sufficientData: true,
    insufficientReason: null,
    candlesRequired: MIN_CANDLES_REQUIRED,
    candleCountUsed: candles.length,
    classifiedBarCount: classifiedPoints.length,
    lastCandleTimestamp,
    lastCandleIso,
    currentRegime: latestPoint.regime,
    score: tailScore.score,
    inputs,
    parameters,
    series,
    transitions,
    timestampGaps,
    tickerAvailable: params.ticker !== null,
    tickerError: params.tickerError ?? null,
    source: 'Source: Delta candles',
    computedAt,
  };
}
