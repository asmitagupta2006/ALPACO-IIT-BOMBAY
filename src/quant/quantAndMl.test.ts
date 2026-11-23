import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeltaCandle } from '../contracts/delta';
import { createSeededRng } from '../ml/decisionTree';
import { trainAndEvaluateRegimeModel, inferRegimeWithModel } from '../ml/regimeTrainer';
import { trainAndEvaluateRiskModel, predictStrategyDeterioration } from '../ml/riskTrainer';
import { cleanAndAuditCandles } from './dataCleaner';
import { evaluateDecisionEngine } from './decisionEngine';
import { buildExplainablePrediction } from './explainEngine';
import { engineerFeatures } from './indicators';
import { runPaperSimulation } from './paperSimulator';
import { calculateStrategyHealth } from './strategyHealth';

function makeSyntheticCandles(count = 520, startTime = 1790000000): DeltaCandle[] {
  const rng = createSeededRng(777);
  const out: DeltaCandle[] = [];
  let price = 84000;

  for (let i = 0; i < count; i++) {
    const phase = Math.floor(i / 65) % 4;
    let drift = 0;
    let vol = 0.0025;
    if (phase === 0) {
      drift = 0.0018;
      vol = 0.0026;
    } else if (phase === 1) {
      drift = 0;
      vol = 0.0015;
    } else if (phase === 2) {
      drift = (i % 2 === 0 ? 1 : -1) * 0.003;
      vol = 0.011;
    } else {
      drift = -0.0002 * Math.sin(i * 0.4);
      vol = 0.0028;
    }
    const ret = drift + (rng() + rng() - 1) * vol;
    const open = price;
    const close = Math.max(100, open * (1 + ret));
    const spread = Math.max(open * 0.001, Math.abs(close - open) * 0.6 + open * vol * 0.5);
    out.push({
      time: startTime + i * 900,
      open,
      high: Math.max(open, close) + spread,
      low: Math.min(open, close) - spread,
      close,
      volume: 100 + rng() * 200,
    });
    price = close;
  }
  return out;
}

test('cleanAndAuditCandles removes duplicates, fixes OHLC bounds, and fills short gaps', () => {
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
    sourceMode: 'historical_cache',
    nowUnixSec: 4000,
  });

  assert.equal(report.duplicatesRemoved, 1);
  assert.equal(report.nonMonotonicFixed, 1);
  assert.equal(report.anomaliesRepaired, 1);
  assert.equal(report.missingBarsDetected, 1);
  assert.equal(report.missingBarsFilled, 1);
  assert.equal(candles.length, 4);
  assert.equal(candles[1].high >= Math.max(candles[1].open, candles[1].close), true);
  assert.equal(candles[2].time, 2700);
  assert.equal(candles[2].volume, 0);
});

test('engineerFeatures is strictly causal (prefix invariance / zero look-ahead)', () => {
  const candles = makeSyntheticCandles(160);
  const fullFeatures = engineerFeatures(candles);
  const prefixFeatures = engineerFeatures(candles.slice(0, 120));

  // Features at bar 100 must be identical regardless of future bars [120..159]
  assert.equal(fullFeatures[100].ema20, prefixFeatures[100].ema20);
  assert.equal(fullFeatures[100].rsi14, prefixFeatures[100].rsi14);
  assert.equal(fullFeatures[100].atr14, prefixFeatures[100].atr14);
  assert.equal(fullFeatures[100].realizedVol20, prefixFeatures[100].realizedVol20);
  assert.equal(fullFeatures[100].trendStrength, prefixFeatures[100].trendStrength);
});

test('Model 1 regime trainer executes chronological 70/15/15 split and walk-forward CV', () => {
  const candles = makeSyntheticCandles(520);
  const res = trainAndEvaluateRegimeModel({ candles, algorithm: 'gbdt' });

  assert.equal(res.metrics.splitSummary.purgeGapBars, 2);
  assert.ok(res.metrics.splitSummary.trainRows > res.metrics.splitSummary.testRows);
  assert.ok(res.metrics.walkForwardFolds.length >= 2);
  assert.ok(res.metrics.testAccuracy >= 0 && res.metrics.testAccuracy <= 1);
  assert.ok(res.metrics.brierScore >= 0 && res.metrics.brierScore <= 1);
  assert.equal(res.metrics.confusionMatrix.labels.length, 5);

  const features = engineerFeatures(candles);
  const inf = inferRegimeWithModel({
    symbol: 'BTCUSD',
    resolution: '15m',
    featureRow: features[features.length - 1],
    prevFeatureRow: features[features.length - 2],
    artifact: res.artifact,
    modelVersion: 'v1.0.0',
    dataQualityScore: 98,
  });
  const probSum = Object.values(inf.probabilities).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(probSum - 1) < 0.01);
  assert.equal(inf.isFallbackRule, false);
});

test('Model 2 risk trainer, strategy health, decision engine, and explainability operate end-to-end', () => {
  const candles = makeSyntheticCandles(480);
  const riskTrain = trainAndEvaluateRiskModel({ candles, horizonMinutes: 30 });
  assert.ok(riskTrain.metrics.testAccuracy >= 0);
  assert.ok(riskTrain.metrics.walkForwardFolds.length >= 2);

  const features = engineerFeatures(candles);
  const latest = features[features.length - 1];
  const strategy = {
    id: 'strat-btc-momentum',
    name: 'BTC Momentum Trend',
    archetype: 'trend_following' as const,
    symbol: 'BTCUSD',
    timeframe: '15m' as const,
    preferredRegimes: ['Trending' as const],
    hostileRegimes: ['Ranging' as const, 'Transition / Unstable' as const],
    tradingMode: 'paper' as const,
    status: 'active' as const,
    leverage: 6,
    exposureUsd: 60000,
    equityUsd: 25000,
    recentDrawdownPct: 4.5,
    maxDrawdownPct: 7.2,
    dailyLossPct: 2.1,
    winRatePct: 46,
    profitFactor: 1.05,
    consecutiveLosses: 3,
    avgSlippageBps: 5.5,
    recentReturnsPct: [-0.8, -0.5, -0.4],
    isSimulatedMetrics: true,
  };

  const health = calculateStrategyHealth({
    strategy,
    currentRegime: 'Transition / Unstable',
    featureRow: latest,
  });
  assert.ok(health.totalScore >= 0 && health.totalScore <= 100);
  assert.equal(health.components.regimeMismatchPenalty, 20);

  const pred = predictStrategyDeterioration({
    strategy,
    regime: 'Transition / Unstable',
    featureRow: latest,
    artifact: riskTrain.artifact,
    modelVersion: 'risk-v1',
    dataQualityScore: 95,
  });
  assert.ok(pred.probability30m >= 0 && pred.probability30m <= 1);
  assert.ok(pred.probability60m >= pred.probability30m - 0.01);

  const guardrail = {
    strategyId: strategy.id,
    strategyName: strategy.name,
    symbol: strategy.symbol,
    maxDailyLossPct: 3.0,
    maxDrawdownPct: 4.0, // intentionally breached (4.5 >= 4.0)
    maxExposureUsd: 80000,
    maxLeverage: 5.0, // intentionally breached (6 > 5)
    maxSlippageBps: 8.0,
    maxConsecutiveLosses: 4,
    maxRiskProbPct: 70,
    tradingMode: 'paper' as const,
    status: 'active' as const,
    updatedAt: new Date().toISOString(),
  };

  const regimeInf = inferRegimeWithModel({
    symbol: 'BTCUSD',
    resolution: '15m',
    featureRow: latest,
    artifact: null,
    modelVersion: 'fallback',
    dataQualityScore: 60, // triggers rule fallback
  });

  const decision = evaluateDecisionEngine({
    strategy,
    health,
    regime: regimeInf,
    riskPrediction: {
      strategyId: strategy.id,
      symbol: strategy.symbol,
      horizonMinutes: 30,
      ...pred,
      calibrationNote: 'Test',
      modelVersion: 'risk-v1',
    },
    guardrail,
    dataQualityScore: 60,
  });

  assert.equal(decision.usedRuleFallback, true);
  assert.ok(decision.breaches.length >= 2);
  assert.ok(decision.breaches.some((b) => b.rule === 'Maximum Strategy Drawdown'));
  assert.ok(decision.breaches.some((b) => b.rule === 'Maximum Leverage'));
  assert.equal(decision.action, 'CRITICAL RISK WARNING');
  assert.equal(decision.humanApprovalRequired, true);

  const explanation = buildExplainablePrediction({
    strategy,
    health,
    regime: regimeInf,
    riskPrediction: {
      strategyId: strategy.id,
      symbol: strategy.symbol,
      horizonMinutes: 30,
      ...pred,
      calibrationNote: 'Test',
      modelVersion: 'risk-v1',
    },
    decision,
    dataQuality: cleanAndAuditCandles({
      rawCandles: candles,
      symbol: 'BTCUSD',
      resolution: '15m',
      sourceMode: 'historical_cache',
    }).report,
    riskBrierScore: riskTrain.metrics.brierScore,
  });
  assert.ok(explanation.whatHappened.length > 10);
  assert.ok(explanation.limitations.length >= 2);
});

test('runPaperSimulation outputs realistic equity comparison and transition events', () => {
  const sim = runPaperSimulation({
    strategyId: 'strat-btc-momentum',
    symbol: 'BTCUSD',
    targetRegime: 'Trending',
    simulateTransition: true,
    transitionToRegime: 'High Volatility',
    leverage: 5,
    capitalUsd: 25000,
    barsCount: 60,
    takerFeeBps: 5,
    baseSlippageBps: 2,
  });
  assert.equal(sim.isSimulated, true);
  assert.equal(sim.steps.length, 59);
  assert.ok(sim.summary.totalExecutionCostsUsd > 0);
  assert.ok(sim.events.some((e) => e.title.includes('Regime Transition')));
});
