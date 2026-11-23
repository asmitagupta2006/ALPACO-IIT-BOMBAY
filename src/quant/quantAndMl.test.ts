import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeltaCandle } from '../contracts/delta.ts';
import { cleanAndAuditCandles, resolutionToSeconds } from './dataCleaner.ts';
import { engineerFeatures } from './indicators.ts';

function makeDeterministicTestCandles(count = 160, startTime = 1790000000): DeltaCandle[] {
  const out: DeltaCandle[] = [];
  let price = 84000;

  for (let i = 0; i < count; i++) {
    const ret = 0.0012 * Math.sin(i * 0.25) + 0.0004 * Math.cos(i * 0.11);
    const open = price;
    const close = Math.max(100, open * (1 + ret));
    const spread = Math.max(open * 0.001, Math.abs(close - open) * 0.6);
    out.push({
      time: startTime + i * 900,
      open,
      high: Math.max(open, close) + spread,
      low: Math.min(open, close) - spread,
      close,
      volume: 100 + (i % 17) * 15,
    });
    price = close;
  }
  return out;
}

test('cleanAndAuditCandles removes duplicates, fixes OHLC bounds, and never fabricates carry-forward bars', () => {
  const raw: DeltaCandle[] = [
    { time: 1800, open: 100, high: 95, low: 102, close: 101, volume: 10 }, // inverted high/low
    { time: 900, open: 99, high: 101, low: 98, close: 100, volume: 20 }, // out of order
    { time: 900, open: 99, high: 101, low: 98, close: 100, volume: 25 }, // duplicate
    { time: 3600, open: 101, high: 104, low: 100, close: 103, volume: 30 }, // 1 missing bar at 2700
  ];
  const { candles, report } = cleanAndAuditCandles({
    rawCandles: raw,
    symbol: 'BTCUSD',
    resolution: '15m',
    sourceMode: 'live',
    nowUnixSec: 4000,
  });

  assert.equal(report.duplicatesRemoved, 1);
  assert.equal(report.nonMonotonicFixed, 1);
  assert.equal(report.anomaliesRepaired, 1);
  assert.equal(report.missingBarsDetected, 1);
  assert.equal(report.missingBarsFilled, 0);
  assert.equal(candles.length, 3);
  assert.equal(candles[1].high >= Math.max(candles[1].open, candles[1].close), true);
  assert.equal(candles[2].time, 3600);
});

test('engineerFeatures computes causal EMA20/EMA50 strictly from OHLCV with zero look-ahead or synthetic funding/OI', () => {
  const candles = makeDeterministicTestCandles(160);
  const fullFeatures = engineerFeatures(candles);
  const prefixFeatures = engineerFeatures(candles.slice(0, 120));

  assert.equal(fullFeatures[100].ema20, prefixFeatures[100].ema20);
  assert.equal(fullFeatures[100].ema50, prefixFeatures[100].ema50);
  assert.equal('fundingRate' in fullFeatures[100], false);
  assert.equal('oiChangePct' in fullFeatures[100], false);
  assert.equal(resolutionToSeconds('15m'), 900);
});
