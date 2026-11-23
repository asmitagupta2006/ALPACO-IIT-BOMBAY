import assert from 'node:assert/strict';
import test from 'node:test';
import type { DeltaCandle, DeltaTickerSnapshot } from '../../src/contracts/delta.ts';
import {
  classifyBarRegime,
  detectMarketRegime,
  extractOptionalTickerInputs,
} from './classifier.ts';
import { MIN_CANDLES_REQUIRED } from './config.ts';
import {
  computeCausalVolZScores,
  computeCusumReturns,
  computeEmaSeries,
  computeLogReturns,
  computeNormalizedEmaSlope,
  computeRollingShortVol,
  detectTimestampGaps,
  sampleMean,
  sampleStdDev,
} from './math.ts';

function makeCandles(closes: number[], startSec = 1_700_000_000, stepSec = 900): DeltaCandle[] {
  return closes.map((close, idx) => ({
    time: startSec + idx * stepSec,
    open: close,
    high: close * 1.001,
    low: close * 0.999,
    close,
    volume: 100,
  }));
}

test('1. Log returns match exact hand-calculated ln(close[t] / close[t-1])', () => {
  const candles = makeCandles([100, 110, 99, 99]);
  const returns = computeLogReturns(candles);

  assert.equal(returns[0], null);

  // Hand check:
  // i=1: ln(110 / 100) = ln(1.1)
  // i=2: ln(99 / 110) = ln(0.9)
  // i=3: ln(99 / 99) = 0
  assert.ok(Math.abs(returns[1]! - Math.log(1.1)) < 1e-12);
  assert.ok(Math.abs(returns[2]! - Math.log(0.9)) < 1e-12);
  assert.equal(returns[3], 0);
});

test('2. Rolling volatility (sample std dev) matches step-by-step arithmetic', () => {
  // Hand-crafted log returns array (index 0 is null as in real candle series):
  // returns[1..4] = [0.01, 0.03, -0.01, 0.05]
  const returns: Array<number | null> = [null, 0.01, 0.03, -0.01, 0.05];
  const vols = computeRollingShortVol(returns, 3);

  assert.equal(vols[0], null);
  assert.equal(vols[1], null);
  assert.equal(vols[2], null);

  // At i=3, window of 3 is [0.01, 0.03, -0.01]:
  // mean = (0.01 + 0.03 - 0.01) / 3 = 0.01
  // squared deviations: (0)^2 + (0.02)^2 + (-0.02)^2 = 0.0008
  // sample variance (n-1 = 2) = 0.0004 => std = sqrt(0.0004) = 0.02
  assert.ok(Math.abs(vols[3]! - 0.02) < 1e-12);

  // At i=4, window of 3 is [0.03, -0.01, 0.05]:
  // mean = (0.03 - 0.01 + 0.05) / 3 = 0.07 / 3
  const m4 = (0.03 - 0.01 + 0.05) / 3;
  const sd4 = Math.sqrt(
    ((0.03 - m4) ** 2 + (-0.01 - m4) ** 2 + (0.05 - m4) ** 2) / 2,
  );
  assert.ok(Math.abs(vols[4]! - sd4) < 1e-12);
});

test('3. Causal volatility z-score uses only strictly prior baseline [t-B .. t-1]', () => {
  // Hand-crafted shortVols: [null, 0.01, 0.02, 0.03, 0.06]
  // With baselineWindow = 3:
  // At i=4: prior window is indices [1, 2, 3] = [0.01, 0.02, 0.03]
  // mean = 0.02, sample std = 0.01
  // current = 0.06 => z = (0.06 - 0.02) / 0.01 = 4.0
  const shortVols: Array<number | null> = [null, 0.01, 0.02, 0.03, 0.06];
  const zScores = computeCausalVolZScores(shortVols, 3);

  assert.equal(zScores[0].zScore, null);
  assert.equal(zScores[3].zScore, null);
  assert.ok(Math.abs(zScores[4].mean! - 0.02) < 1e-12);
  assert.ok(Math.abs(zScores[4].std! - 0.01) < 1e-12);
  assert.ok(Math.abs(zScores[4].zScore! - 4.0) < 1e-12);
});

test('4. EMA and volatility-normalized EMA slope match step-by-step math', () => {
  // span = 3 => alpha = 2 / (3 + 1) = 0.5
  // closes = [100, 104, 110, 120]
  // ema[0] = 100
  // ema[1] = 0.5*104 + 0.5*100 = 102
  // ema[2] = 0.5*110 + 0.5*102 = 106
  // ema[3] = 0.5*120 + 0.5*106 = 113
  const closes = [100, 104, 110, 120];
  const emas = computeEmaSeries(closes, 3);
  assert.deepEqual(emas, [100, 102, 106, 113]);

  // slopeLookback = 2, shortVol[3] = 0.02
  // At i=3: ema[3] = 113, ema[1] = 102
  // slopePerBarPct = ((113 - 102) / 2) / 102 = 5.5 / 102
  // normalized = (5.5 / 102) / 0.02
  const expectedSlope = (5.5 / 102) / 0.02;
  const slopes = computeNormalizedEmaSlope(emas, [null, null, 0.02, 0.02], 2);
  assert.equal(slopes[1], null);
  assert.ok(Math.abs(slopes[3]! - expectedSlope) < 1e-12);
});

test('5. Two-sided CUSUM accumulates directional drift and triggers change-point at H=4.0', () => {
  // Construct returns where meanWindow = 2 prior baseline returns are 0, 0 and prevVol = 0.01.
  //Wait: if returns[1..2] = [0, 0] and we inject shortVol[2] = 0.01 manually:
  // At i=3: r = +0.025 => zRet = (0.025 - 0) / 0.01 = 2.5 => sPos = max(0, 0 + 2.5 - 0.5) = 2.0
  // At i=4: prior [2,3] = [0, 0.025] => mu = 0.0125; let prevVol[3] = 0.01; r = 0.0425 => zRet = 3.0
  //         sPos = max(0, 2.0 + 3.0 - 0.5) = 4.5 >= 4.0 => triggered!
  const returns: Array<number | null> = [null, 0, 0, 0.025, 0.0425, 0.0125];
  const shortVols: Array<number | null> = [null, null, 0.01, 0.01, 0.01, 0.01];
  const cusum = computeCusumReturns(returns, shortVols, 0.5, 4.0, 2);

  assert.ok(Math.abs(cusum[3].cusumPos! - 2.0) < 1e-12);
  assert.equal(cusum[3].changePointTriggered, false);

  assert.ok(Math.abs(cusum[4].cusumPos! - 4.5) < 1e-12);
  assert.equal(cusum[4].changePointTriggered, true);

  // After trigger at i=4, accumulator resets to 0 before evaluating i=5
  // At i=5: prior returns [3,4] = [0.025, 0.0425] => mu = 0.03375, r = 0.0125
  // zRet = (0.0125 - 0.03375) / 0.01 = -2.125
  // sNeg = max(0, 0 - (-2.125) - 0.5) = 1.625
  assert.equal(cusum[5].cusumPos, 0);
  assert.ok(Math.abs(cusum[5].cusumNeg! - 1.625) < 1e-12);
  assert.equal(cusum[5].changePointTriggered, false);
});

test('6. Classifier rules distinguish Calm/Range, Trending, High-Volatility/Shock and exclude missing ticker fields', () => {
  assert.equal(
    classifyBarRegime({ volZScore: 0.2, trendStrength: 0.1, changePointTriggered: false }),
    'Calm/Range',
  );
  assert.equal(
    classifyBarRegime({ volZScore: 0.8, trendStrength: -0.45, changePointTriggered: false }),
    'Trending',
  );
  assert.equal(
    classifyBarRegime({ volZScore: 1.6, trendStrength: 0.05, changePointTriggered: false }),
    'High-Volatility/Shock',
  );
  assert.equal(
    classifyBarRegime({ volZScore: 0.3, trendStrength: 0.1, changePointTriggered: true }),
    'High-Volatility/Shock',
  );

  // Absent optional inputs (option missing funding & basis, perp missing IV)
  const optionTicker: DeltaTickerSnapshot = {
    symbol: 'C-BTC-70000-271126',
    productId: 999,
    contractType: 'call_options',
    description: 'BTC Call',
    underlyingSymbol: 'BTC',
    close: 120,
    open: 100,
    high: 130,
    low: 95,
    volume: 10,
    turnoverUsd: 10000,
    markPrice: 121,
    spotPrice: 62500,
    markBasis: null,
    fundingRate: null,
    oi: 5,
    oiContracts: 5000,
    oiValueUsd: 50000,
    oiChangeUsd6h: null,
    markChange24h: 10,
    ltpChange24h: 10,
    markHigh24h: 130,
    markLow24h: 95,
    bestBid: 118,
    bestAsk: 122,
    bidSize: 5,
    askSize: 5,
    markVol: 0.45,
    bidIv: 0.44,
    askIv: 0.46,
    markIv: 0.45,
    greeks: null,
    strikePrice: 70000,
    leverage: 100,
    tickSize: 0.5,
    productTradingStatus: 'operational',
    exchangeTimeIso: null,
    exchangeTimestampUs: null,
    fetchedAtIso: new Date().toISOString(),
  };

  const optInputs = extractOptionalTickerInputs(optionTicker);
  const funding = optInputs.find((i) => i.id === 'fundingRate')!;
  const basis = optInputs.find((i) => i.id === 'markIndexBasis')!;
  const oi = optInputs.find((i) => i.id === 'oiChange6h')!;
  const iv = optInputs.find((i) => i.id === 'impliedVolatility')!;

  assert.equal(funding.available, false);
  assert.equal(basis.available, false);
  assert.equal(oi.available, false);
  assert.equal(iv.available, true);
  assert.ok(Math.abs(iv.value! - 45) < 1e-9);
});

test('7. Edge case: Too few candles returns Insufficient data without inventing a regime or score', () => {
  const shortCandles = makeCandles(Array.from({ length: MIN_CANDLES_REQUIRED - 5 }, () => 50000));
  const res = detectMarketRegime({
    symbol: 'BTCUSD',
    resolution: '15m',
    basis: 'trade',
    candles: shortCandles,
    ticker: null,
  });

  assert.equal(res.sufficientData, false);
  assert.equal(res.currentRegime, null);
  assert.equal(res.score, null);
  assert.equal(res.candleCountUsed, MIN_CANDLES_REQUIRED - 5);
  assert.equal(res.candlesRequired, MIN_CANDLES_REQUIRED);
  assert.match(res.insufficientReason ?? '', /Insufficient data/);
});

test('8. Edge case: Zero variance series produces finite Calm/Range without NaN/Infinity', () => {
  const flatCandles = makeCandles(Array.from({ length: 80 }, () => 60000));
  const res = detectMarketRegime({
    symbol: 'BTCUSD',
    resolution: '15m',
    basis: 'trade',
    candles: flatCandles,
    ticker: null,
  });

  assert.equal(res.sufficientData, true);
  assert.equal(res.currentRegime, 'Calm/Range');
  assert.ok(res.score !== null && Number.isFinite(res.score));
  const tail = res.series[res.series.length - 1];
  assert.equal(tail.shortVol, 0);
  assert.equal(tail.volZScore, 0);
  assert.equal(tail.trendStrength, 0);
  assert.equal(tail.cusumMax, 0);
});

test('9. Edge case: Gap in candle timestamps is detected and reported without fabricating bars', () => {
  const closes = Array.from({ length: 75 }, (_, i) => 100 * Math.exp(0.001 * i));
  const gappedCandles = makeCandles(closes, 1_700_000_000, 900);
  // Remove two consecutive bars near index 40 (creates a 3 * 900 = 2700s delta)
  const spliced = [...gappedCandles.slice(0, 40), ...gappedCandles.slice(42)];

  const gaps = detectTimestampGaps(spliced, 900, 1.5);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].deltaSeconds, 2700);
  assert.equal(gaps[0].expectedSeconds, 900);

  const res = detectMarketRegime({
    symbol: 'BTCUSD',
    resolution: '15m',
    basis: 'trade',
    candles: spliced,
    ticker: null,
  });
  assert.equal(res.candleCountUsed, spliced.length);
  assert.equal(res.timestampGaps.length, 1);
  assert.equal(res.sufficientData, true);
});

test('10. Zero-lookahead guarantee: modifying future candles does not alter earlier bar classifications', () => {
  const closes = Array.from({ length: 85 }, (_, i) => 100 + Math.sin(i * 0.4) * 1.5);
  const fullCandles = makeCandles(closes);
  const prefixCandles = fullCandles.slice(0, 75);

  const fullRes = detectMarketRegime({
    symbol: 'BTCUSD',
    resolution: '15m',
    basis: 'trade',
    candles: fullCandles,
    ticker: null,
  });
  const prefixRes = detectMarketRegime({
    symbol: 'BTCUSD',
    resolution: '15m',
    basis: 'trade',
    candles: prefixCandles,
    ticker: null,
  });

  // Check historical bars [64..73] match identically (bar 74 is tail where optional ticker weights would apply if ticker != null)
  for (let i = MIN_CANDLES_REQUIRED - 1; i < 74; i++) {
    assert.equal(fullRes.series[i].regime, prefixRes.series[i].regime);
    assert.equal(fullRes.series[i].volZScore, prefixRes.series[i].volZScore);
    assert.equal(fullRes.series[i].trendStrength, prefixRes.series[i].trendStrength);
    assert.equal(fullRes.series[i].cusumMax, prefixRes.series[i].cusumMax);
  }

  // Confirm sampleMean/sampleStdDev sanity
  assert.equal(sampleMean([2, 4, 6]), 4);
  assert.equal(sampleStdDev([2, 4, 6]), 2);
});
