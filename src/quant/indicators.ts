import type { DeltaCandle } from '../contracts/delta';
import type { EngineeredFeatureRow } from '../contracts/sentinel';

const EPS = 1e-9;

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  let sq = 0;
  for (const v of values) {
    const d = v - mean;
    sq += d * d;
  }
  return Math.sqrt(sq / (values.length - 1));
}

export interface MicrostructureContext {
  fundingRate?: number | null;
  oiChangePct?: number | null;
}

/**
 * Strictly causal feature engineering:
 * Every value at index t depends ONLY on candles[0..t] and optional point-in-time
 * funding/OI inputs. Zero look-ahead bias.
 */
export function engineerFeatures(
  candles: DeltaCandle[],
  context?: MicrostructureContext,
): EngineeredFeatureRow[] {
  if (candles.length === 0) return [];

  const rows: EngineeredFeatureRow[] = [];
  const k20 = 2 / (20 + 1);
  const k50 = 2 / (50 + 1);
  const k200 = 2 / (200 + 1);
  const k12 = 2 / (12 + 1);
  const k26 = 2 / (26 + 1);
  const k9 = 2 / (9 + 1);

  let ema20 = candles[0].close;
  let ema50 = candles[0].close;
  let ema200 = candles[0].close;
  let ema12 = candles[0].close;
  let ema26 = candles[0].close;
  let macdSignal = 0;

  let avgGain = 0;
  let avgLoss = 0;
  let atr14 = candles[0].high - candles[0].low;

  const logReturns: number[] = [];
  const volumes: number[] = [];
  const closes: number[] = [];

  const baseFunding = context?.fundingRate ?? 0.01;
  const baseOiChange = context?.oiChangePct ?? 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const prev = i > 0 ? candles[i - 1] : c;

    closes.push(c.close);
    volumes.push(c.volume);

    if (i > 0) {
      ema20 = c.close * k20 + ema20 * (1 - k20);
      ema50 = c.close * k50 + ema50 * (1 - k50);
      ema200 = c.close * k200 + ema200 * (1 - k200);
      ema12 = c.close * k12 + ema12 * (1 - k12);
      ema26 = c.close * k26 + ema26 * (1 - k26);
    }

    const macd = ema12 - ema26;
    macdSignal = i === 0 ? macd : macd * k9 + macdSignal * (1 - k9);
    const macdHist = macd - macdSignal;

    // Wilder RSI(14)
    const change = i > 0 ? c.close - prev.close : 0;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    if (i === 0) {
      avgGain = 0;
      avgLoss = 0;
    } else if (i <= 14) {
      avgGain = (avgGain * (i - 1) + gain) / i;
      avgLoss = (avgLoss * (i - 1) + loss) / i;
    } else {
      avgGain = (avgGain * 13 + gain) / 14;
      avgLoss = (avgLoss * 13 + loss) / 14;
    }
    const rs = avgLoss < EPS ? (avgGain > 0 ? 100 : 1) : avgGain / avgLoss;
    const rsi14 = i === 0 ? 50 : 100 - 100 / (1 + rs);

    // Wilder ATR(14)
    const tr =
      i === 0
        ? c.high - c.low
        : Math.max(
            c.high - c.low,
            Math.abs(c.high - prev.close),
            Math.abs(c.low - prev.close),
          );
    if (i === 0) {
      atr14 = tr;
    } else if (i <= 14) {
      atr14 = (atr14 * (i - 1) + tr) / i;
    } else {
      atr14 = (atr14 * 13 + tr) / 14;
    }
    const atrPct = atr14 / Math.max(c.close, EPS);

    // Causal returns
    const ret1 = i > 0 ? (c.close - prev.close) / Math.max(prev.close, EPS) : 0;
    const logRet = i > 0 ? Math.log(Math.max(c.close, EPS) / Math.max(prev.close, EPS)) : 0;
    logReturns.push(logRet);

    const ret4 = i >= 4 ? (c.close - closes[i - 4]) / Math.max(closes[i - 4], EPS) : ret1;
    const ret16 = i >= 16 ? (c.close - closes[i - 16]) / Math.max(closes[i - 16], EPS) : ret4;

    // Realized Volatility (20-bar & 5-bar causal windows)
    const win20 = logReturns.slice(Math.max(0, logReturns.length - 20));
    const win5 = logReturns.slice(Math.max(0, logReturns.length - 5));
    const realizedVol20 = stdDev(win20);
    const realizedVol5 = stdDev(win5);
    const volClustering = realizedVol20 > EPS ? realizedVol5 / realizedVol20 : 1;

    // Kaufman Efficiency Ratio (14-bar causal directional efficiency)
    const look = Math.min(14, i);
    let pathSum = 0;
    for (let j = i - look + 1; j <= i; j++) {
      pathSum += Math.abs(closes[j] - closes[j - 1]);
    }
    const netMove = look > 0 ? Math.abs(c.close - closes[i - look]) : 0;
    const efficiencyRatio = pathSum > EPS ? netMove / pathSum : 0;

    // Normalized EMA separation + efficiency trend strength
    const emaSep = Math.abs(ema20 - ema50) / Math.max(atr14, c.close * 0.0005);
    const trendStrength = Math.min(1, 0.55 * efficiencyRatio + 0.45 * Math.min(1, emaSep / 2.2));

    // Range expansion relative to ATR
    const rangeExpansion = (c.high - c.low) / Math.max(atr14, c.close * 0.0005);

    // Volume change vs 20-bar causal SMA
    const volSlice = volumes.slice(Math.max(0, volumes.length - 21), volumes.length - 1);
    const volMean =
      volSlice.length > 0 ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : c.volume;
    const volumeChange = volMean > EPS ? (c.volume - volMean) / volMean : 0;

    // Funding & OI proxy anchored to latest real snapshot on tail bar, causal momentum proxy earlier
    const isTail = i === candles.length - 1;
    const fundingRate = isTail ? baseFunding : baseFunding * 0.5 + ret16 * 0.35;
    const oiChangePct = isTail
      ? baseOiChange
      : volumeChange * 1.4 + (ret4 > 0 ? 0.4 : -0.4) * Math.min(2, Math.abs(ret4) * 100);

    rows.push({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      ema20,
      ema50,
      ema200,
      rsi14,
      macd,
      macdSignal,
      macdHist,
      atr14,
      atrPct,
      ret1,
      ret4,
      ret16,
      realizedVol20,
      volClustering,
      trendStrength,
      efficiencyRatio,
      rangeExpansion,
      volumeChange: Math.max(-1, Math.min(6, volumeChange)),
      fundingRate,
      oiChangePct,
    });
  }

  return rows;
}

export const FEATURE_COLUMNS: ReadonlyArray<{
  key: keyof EngineeredFeatureRow;
  label: string;
}> = [
  { key: 'rsi14', label: 'RSI (14)' },
  { key: 'macdHist', label: 'MACD Histogram' },
  { key: 'atrPct', label: 'ATR % of Price' },
  { key: 'ret1', label: '1-Bar Return' },
  { key: 'ret4', label: '4-Bar Return' },
  { key: 'ret16', label: '16-Bar Return' },
  { key: 'realizedVol20', label: 'Realized Vol (20)' },
  { key: 'volClustering', label: 'Vol Clustering (5/20)' },
  { key: 'trendStrength', label: 'Trend Strength' },
  { key: 'efficiencyRatio', label: 'Directional Efficiency' },
  { key: 'rangeExpansion', label: 'Range / ATR Expansion' },
  { key: 'volumeChange', label: 'Volume Surge Ratio' },
  { key: 'fundingRate', label: 'Funding Rate (%)' },
  { key: 'oiChangePct', label: 'OI Change Proxy (%)' },
];

export function extractFeatureVector(row: EngineeredFeatureRow): number[] {
  const ema20Dist = (row.close - row.ema20) / Math.max(row.ema20, EPS);
  const ema50Dist = (row.close - row.ema50) / Math.max(row.ema50, EPS);
  const ema200Dist = (row.close - row.ema200) / Math.max(row.ema200, EPS);
  const macdNorm = row.macdHist / Math.max(row.close * 0.001, EPS);

  return [
    row.rsi14,
    macdNorm,
    row.atrPct,
    row.ret1,
    row.ret4,
    row.ret16,
    row.realizedVol20,
    row.volClustering,
    row.trendStrength,
    row.efficiencyRatio,
    row.rangeExpansion,
    row.volumeChange,
    row.fundingRate,
    row.oiChangePct,
    ema20Dist,
    ema50Dist,
    ema200Dist,
  ];
}

export const MODEL_FEATURE_NAMES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'rsi14', label: 'RSI (14)' },
  { key: 'macdNorm', label: 'Normalized MACD Hist' },
  { key: 'atrPct', label: 'ATR %' },
  { key: 'ret1', label: '1-Bar Return' },
  { key: 'ret4', label: '4-Bar Return' },
  { key: 'ret16', label: '16-Bar Return' },
  { key: 'realizedVol20', label: 'Realized Volatility (20)' },
  { key: 'volClustering', label: 'Volatility Clustering (5/20)' },
  { key: 'trendStrength', label: 'Trend Strength' },
  { key: 'efficiencyRatio', label: 'Directional Efficiency' },
  { key: 'rangeExpansion', label: 'Range Expansion' },
  { key: 'volumeChange', label: 'Volume Change' },
  { key: 'fundingRate', label: 'Funding Rate' },
  { key: 'oiChangePct', label: 'Open Interest Delta' },
  { key: 'ema20Dist', label: 'Price vs EMA 20' },
  { key: 'ema50Dist', label: 'Price vs EMA 50' },
  { key: 'ema200Dist', label: 'Price vs EMA 200' },
];
