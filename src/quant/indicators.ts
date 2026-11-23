import type { DeltaCandle } from '../contracts/delta.ts';

const EPS = 1e-9;

export interface OhlcvIndicatorRow {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema20: number;
  ema50: number;
}

/**
 * Strictly causal OHLCV indicator computation (EMA 20 & EMA 50 for chart overlays).
 * Depends solely on real OHLCV bars up to index t.
 */
export function engineerFeatures(candles: DeltaCandle[]): OhlcvIndicatorRow[] {
  if (candles.length === 0) return [];

  const rows: OhlcvIndicatorRow[] = [];
  const k20 = 2 / (20 + 1);
  const k50 = 2 / (50 + 1);

  let ema20 = candles[0].close;
  let ema50 = candles[0].close;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i > 0) {
      ema20 = c.close * k20 + ema20 * (1 - k20);
      ema50 = c.close * k50 + ema50 * (1 - k50);
    }

    rows.push({
      time: c.time,
      open: Number.isFinite(c.open) ? c.open : EPS,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      ema20,
      ema50,
    });
  }

  return rows;
}
