import type { DeltaCandle } from '../contracts/delta';
import {
  MARKET_REGIMES,
  type EngineeredFeatureRow,
  type FeatureContribution,
  type MarketRegime,
  type ModelEvaluationMetrics,
  type StrategyArchetype,
  type StrategyProfile,
  type WalkForwardFoldResult,
} from '../contracts/sentinel';
import { engineerFeatures } from '../quant/indicators';
import { computeRegimeQuantiles, labelBarRegime } from '../quant/regimeLabels';
import {
  explainBinaryGbdt,
  predictBinaryGbdt,
  trainBinaryGbdt,
  type BinaryGbdtArtifact,
} from './gradientBoosting';
import { computeClassificationMetrics, computePsi } from './metrics';

export const RISK_FEATURE_NAMES: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'regimeCode', label: 'Regime Risk Encoding' },
  { key: 'regimeMismatch', label: 'Regime-Strategy Mismatch' },
  { key: 'recentDrawdownPct', label: 'Recent Strategy Drawdown (%)' },
  { key: 'winRateRecent', label: 'Trailing Win Rate' },
  { key: 'consecutiveLosses', label: 'Consecutive Losses' },
  { key: 'realizedVol20', label: 'Realized Volatility (20)' },
  { key: 'atrPct', label: 'ATR (% of Price)' },
  { key: 'volumeChange', label: 'Volume Surge Ratio' },
  { key: 'slippageBps', label: 'Execution Slippage (bps)' },
  { key: 'exposureNorm', label: 'Normalized Exposure' },
  { key: 'leverage', label: 'Effective Leverage' },
  { key: 'volClustering', label: 'Volatility Clustering (5/20)' },
];

export interface SerializedRiskArtifact {
  modelKind: 'risk';
  horizonBars: number;
  horizonMinutes: 30 | 60;
  baselineRiskFeatureVol: number[];
  model: BinaryGbdtArtifact;
}

export interface RiskTrainingOutput {
  artifact: SerializedRiskArtifact;
  metrics: ModelEvaluationMetrics;
  hyperparameters: Record<string, string | number>;
}

const ARCHETYPES: StrategyArchetype[] = [
  'trend_following',
  'mean_reversion',
  'volatility_breakout',
  'funding_arbitrage',
];

function isRegimeHostile(archetype: StrategyArchetype, regime: MarketRegime): number {
  if (regime === 'Transition / Unstable') return 1;
  if (archetype === 'trend_following' && (regime === 'Ranging' || regime === 'Low Volatility')) {
    return 1;
  }
  if (archetype === 'mean_reversion' && (regime === 'Trending' || regime === 'High Volatility')) {
    return 1;
  }
  if (archetype === 'volatility_breakout' && regime === 'Low Volatility') {
    return 0.7;
  }
  if (archetype === 'funding_arbitrage' && regime === 'High Volatility') {
    return 0.85;
  }
  return 0;
}

export function buildRiskFeatureVector(params: {
  regime: MarketRegime;
  archetype: StrategyArchetype;
  recentDrawdownPct: number;
  winRateRecent: number;
  consecutiveLosses: number;
  realizedVol20: number;
  atrPct: number;
  volumeChange: number;
  slippageBps: number;
  exposureUsd: number;
  equityUsd: number;
  leverage: number;
  volClustering: number;
}): number[] {
  const regimeCode = Math.max(0, MARKET_REGIMES.indexOf(params.regime)) / 4;
  const mismatch = isRegimeHostile(params.archetype, params.regime);
  const exposureNorm = params.exposureUsd / Math.max(1000, params.equityUsd * 4);

  return [
    regimeCode,
    mismatch,
    params.recentDrawdownPct,
    params.winRateRecent,
    params.consecutiveLosses,
    params.realizedVol20,
    params.atrPct,
    params.volumeChange,
    params.slippageBps,
    exposureNorm,
    params.leverage,
    params.volClustering,
  ];
}

function simulateBarStrategyReturn(
  archetype: StrategyArchetype,
  row: EngineeredFeatureRow,
  regime: MarketRegime,
  leverage: number,
): number {
  const slippagePenalty = (0.00025 + row.rangeExpansion * 0.00018) * leverage;
  let alpha = 0;

  if (archetype === 'trend_following') {
    const dir = row.ema20 >= row.ema50 ? 1 : -1;
    alpha = dir * row.ret1 * (regime === 'Trending' ? 1.15 : regime === 'Ranging' ? -0.45 : 0.4);
  } else if (archetype === 'mean_reversion') {
    const dev = (row.close - row.ema20) / Math.max(row.ema20, 1);
    const dir = dev > 0 ? -1 : 1;
    alpha =
      dir *
      row.ret1 *
      (regime === 'Ranging' || regime === 'Low Volatility' ? 1.05 : -0.75);
  } else if (archetype === 'volatility_breakout') {
    const breakout = row.rangeExpansion > 1.35 ? Math.sign(row.ret1) : 0;
    alpha = breakout * row.ret1 * (regime === 'High Volatility' || regime === 'Trending' ? 1.1 : -0.35);
  } else {
    // Funding arbitrage earns steady carry unless extreme volatility causes basis dislocation
    alpha =
      (Math.abs(row.fundingRate) * 0.004 || 0.0002) -
      (regime === 'High Volatility' || regime === 'Transition / Unstable'
        ? Math.abs(row.ret1) * 0.85
        : Math.abs(row.ret1) * 0.12);
  }

  return Math.max(-0.18, Math.min(0.18, alpha * leverage - slippagePenalty));
}

/**
 * Generates strictly causal supervised training data for Model 2:
 * Risk Event (y=1) is pre-defined as: within the next `horizonBars` (e.g. 2 bars = 30m, 4 bars = 60m),
 * cumulative strategy drawdown worsens by >= 1.35% OR single-bar adverse shock >= 1.1%
 * OR consecutive losses reach >= 4.
 */
export function buildRiskSupervisedDataset(params: {
  candles: DeltaCandle[];
  horizonBars: number;
}): {
  X: number[][];
  y: number[];
  times: number[];
  trainEndIdx: number;
  valStartIdx: number;
  valEndIdx: number;
  testStartIdx: number;
} {
  const features = engineerFeatures(params.candles);
  const warmup = Math.min(45, Math.max(0, Math.floor(features.length * 0.1)));
  const trainSplitRow = Math.floor((features.length - warmup) * 0.7) + warmup;
  const thresholds = computeRegimeQuantiles(features.slice(warmup, trainSplitRow));

  const X: number[][] = [];
  const y: number[] = [];
  const times: number[] = [];

  // Interleave chronologically across bar t so chronological ordering is strictly preserved
  const states = ARCHETYPES.map((arch, idx) => ({
    archetype: arch,
    leverage: idx === 0 ? 5 : idx === 1 ? 4 : idx === 2 ? 6 : 3,
    equity: 25000,
    peakEquity: 25000,
    consecLosses: 0,
    recentWins: [] as number[],
  }));

  const barReturnsByArch: number[][] = ARCHETYPES.map(() => new Array(features.length).fill(0));
  const regimesByBar: MarketRegime[] = new Array(features.length).fill('Ranging');

  for (let i = 0; i < features.length; i++) {
    regimesByBar[i] = labelBarRegime(features[i], thresholds, i > 0 ? features[i - 1] : undefined);
    for (let s = 0; s < ARCHETYPES.length; s++) {
      barReturnsByArch[s][i] = simulateBarStrategyReturn(
        ARCHETYPES[s],
        features[i],
        regimesByBar[i],
        states[s].leverage,
      );
    }
  }

  for (let t = warmup; t < features.length - params.horizonBars; t++) {
    const row = features[t];
    const regime = regimesByBar[t];

    for (let s = 0; s < states.length; s++) {
      const st = states[s];
      const barRet = barReturnsByArch[s][t];
      st.equity *= 1 + barRet;
      if (st.equity > st.peakEquity) st.peakEquity = st.equity;
      if (barRet < 0) {
        st.consecLosses += 1;
        st.recentWins.push(0);
      } else {
        st.consecLosses = 0;
        st.recentWins.push(1);
      }
      if (st.recentWins.length > 20) st.recentWins.shift();

      const recentDrawdownPct = Math.max(
        0,
        ((st.peakEquity - st.equity) / Math.max(1, st.peakEquity)) * 100,
      );
      const winRateRecent =
        st.recentWins.length > 0
          ? st.recentWins.reduce((a, b) => a + b, 0) / st.recentWins.length
          : 0.55;
      const slippageBps = 2.5 + row.rangeExpansion * 2.2 + Math.max(0, row.volumeChange) * 1.4;
      const exposureUsd = st.equity * st.leverage * 0.65;

      // Label y using strictly future bars [t+1 .. t+horizonBars]
      let futureEquity = st.equity;
      let futurePeak = st.equity;
      let maxFutureDdIncrease = 0;
      let worstSingleBarPct = 0;
      let futureConsec = st.consecLosses;
      let maxFutureConsec = futureConsec;

      for (let h = 1; h <= params.horizonBars; h++) {
        const fRet = barReturnsByArch[s][t + h];
        futureEquity *= 1 + fRet;
        if (futureEquity > futurePeak) futurePeak = futureEquity;
        const ddPct = ((futurePeak - futureEquity) / Math.max(1, futurePeak)) * 100;
        if (ddPct > maxFutureDdIncrease) maxFutureDdIncrease = ddPct;
        if (-fRet * 100 > worstSingleBarPct) worstSingleBarPct = -fRet * 100;
        if (fRet < 0) {
          futureConsec += 1;
          if (futureConsec > maxFutureConsec) maxFutureConsec = futureConsec;
        } else {
          futureConsec = 0;
        }
      }

      const riskEvent =
        maxFutureDdIncrease >= 1.35 || worstSingleBarPct >= 1.05 || maxFutureConsec >= 4 ? 1 : 0;

      X.push(
        buildRiskFeatureVector({
          regime,
          archetype: st.archetype,
          recentDrawdownPct,
          winRateRecent,
          consecutiveLosses: st.consecLosses,
          realizedVol20: row.realizedVol20,
          atrPct: row.atrPct,
          volumeChange: row.volumeChange,
          slippageBps,
          exposureUsd,
          equityUsd: st.equity,
          leverage: st.leverage,
          volClustering: row.volClustering,
        }),
      );
      y.push(riskEvent);
      times.push(row.time);
    }
  }

  const total = X.length;
  const purge = params.horizonBars * ARCHETYPES.length;
  const trainEndIdx = Math.floor(total * 0.7);
  const valStartIdx = Math.min(total, trainEndIdx + purge);
  const valEndIdx = Math.min(total, valStartIdx + Math.floor(total * 0.15));
  const testStartIdx = Math.min(total, valEndIdx + purge);

  return {
    X,
    y,
    times,
    trainEndIdx,
    valStartIdx,
    valEndIdx,
    testStartIdx,
  };
}

export function trainAndEvaluateRiskModel(params: {
  candles: DeltaCandle[];
  horizonMinutes?: 30 | 60;
}): RiskTrainingOutput {
  const horizonMinutes = params.horizonMinutes ?? 30;
  const horizonBars = horizonMinutes === 60 ? 4 : 2;
  const ds = buildRiskSupervisedDataset({
    candles: params.candles,
    horizonBars,
  });

  if (ds.X.length < 120 || ds.testStartIdx >= ds.X.length - 8) {
    throw new Error(
      `Insufficient bars (${params.candles.length}) to train and validate Model 2 risk predictor.`,
    );
  }

  const XTrain = ds.X.slice(0, ds.trainEndIdx);
  const yTrain = ds.y.slice(0, ds.trainEndIdx);
  const XVal = ds.X.slice(ds.valStartIdx, ds.valEndIdx);
  const yVal = ds.y.slice(ds.valStartIdx, ds.valEndIdx);
  const XTest = ds.X.slice(ds.testStartIdx);
  const yTest = ds.y.slice(ds.testStartIdx);

  const labels = ['Normal', 'Risk Breach'];
  const candidates = [
    { nEstimators: 32, learningRate: 0.08, maxDepth: 3, l2Reg: 2.5 },
    { nEstimators: 42, learningRate: 0.1, maxDepth: 4, l2Reg: 3.0 },
  ];

  let bestModel = trainBinaryGbdt({
    X: XTrain,
    y: yTrain,
    XVal,
    yVal,
    ...candidates[0],
  });
  let bestValF1 = -1;
  let bestParams: Record<string, string | number> = {};

  for (const cfg of candidates) {
    const candidate = trainBinaryGbdt({
      X: XTrain,
      y: yTrain,
      XVal,
      yVal,
      ...cfg,
    });
    const valProbs = XVal.map((x) => predictBinaryGbdt(candidate, x));
    const evalRes = computeClassificationMetrics({
      yTrue: yVal,
      yPred: valProbs.map((p) => (p >= 0.5 ? 1 : 0)),
      probs: valProbs.map((p) => [1 - p, p]),
      labels,
    });
    const posF1 = evalRes.perClass[1]?.f1 ?? evalRes.macroF1;
    if (posF1 >= bestValF1) {
      bestValF1 = posF1;
      bestModel = candidate;
      bestParams = {
        algorithm: 'XGBoost-Style Binary GBDT',
        horizonMinutes,
        maxDepth: cfg.maxDepth,
        learningRate: cfg.learningRate,
        treesTrained: candidate.trees.length,
        plattA: Math.round(candidate.plattA * 100) / 100,
        plattB: Math.round(candidate.plattB * 100) / 100,
      };
    }
  }

  const evalSet = (Xs: number[][], ys: number[]) => {
    const ps = Xs.map((x) => predictBinaryGbdt(bestModel, x));
    return computeClassificationMetrics({
      yTrue: ys,
      yPred: ps.map((p) => (p >= 0.5 ? 1 : 0)),
      probs: ps.map((p) => [1 - p, p]),
      labels,
    });
  };

  const trainEval = evalSet(XTrain, yTrain);
  const valEval = evalSet(XVal, yVal);
  const testEval = evalSet(XTest, yTest);

  // 4-Fold Expanding Walk-Forward Validation
  const walkForwardFolds: WalkForwardFoldResult[] = [];
  const foldSpan = Math.floor((ds.X.length * 0.45) / 4);
  const firstEnd = Math.floor(ds.X.length * 0.48);
  const purge = horizonBars * ARCHETYPES.length;

  if (foldSpan >= 16) {
    for (let f = 0; f < 4; f++) {
      const fTrainEnd = firstEnd + f * foldSpan;
      const fTestStart = fTrainEnd + purge;
      const fTestEnd = Math.min(ds.X.length, fTestStart + foldSpan);
      if (fTestEnd - fTestStart < 12) continue;

      const fModel = trainBinaryGbdt({
        X: ds.X.slice(0, fTrainEnd),
        y: ds.y.slice(0, fTrainEnd),
        nEstimators: 28,
        learningRate: 0.09,
        maxDepth: Number(bestParams.maxDepth) || 3,
        seed: 500 + f,
      });
      const fProbs = ds.X.slice(fTestStart, fTestEnd).map((x) => predictBinaryGbdt(fModel, x));
      const fEval = computeClassificationMetrics({
        yTrue: ds.y.slice(fTestStart, fTestEnd),
        yPred: fProbs.map((p) => (p >= 0.5 ? 1 : 0)),
        probs: fProbs.map((p) => [1 - p, p]),
        labels,
      });

      walkForwardFolds.push({
        fold: f + 1,
        trainCount: fTrainEnd,
        testCount: fTestEnd - fTestStart,
        trainStartIso: new Date(ds.times[0] * 1000).toISOString(),
        testEndIso: new Date(ds.times[fTestEnd - 1] * 1000).toISOString(),
        accuracy: fEval.accuracy,
        macroF1: fEval.macroF1,
        brierScore: fEval.brierScore,
      });
    }
  }

  const featureImportance = RISK_FEATURE_NAMES.map((meta, idx) => ({
    feature: meta.key,
    label: meta.label,
    importance: Math.round((bestModel.featureImportances[idx] ?? 0) * 10000) / 10000,
  })).sort((a, b) => b.importance - a.importance);

  const baselineVol = XTrain.map((r) => r[5] ?? 0);
  const testVol = XTest.map((r) => r[5] ?? 0);
  const driftPsi = computePsi(baselineVol, testVol);
  const driftStatus =
    driftPsi >= 0.25 ? 'Drift Alert' : driftPsi >= 0.1 ? 'Moderate Shift' : 'Nominal';

  return {
    artifact: {
      modelKind: 'risk',
      horizonBars,
      horizonMinutes,
      baselineRiskFeatureVol: baselineVol.slice(-240),
      model: bestModel,
    },
    metrics: {
      splitSummary: {
        totalRows: ds.X.length,
        trainRows: XTrain.length,
        valRows: XVal.length,
        testRows: XTest.length,
        purgeGapBars: purge,
      },
      trainAccuracy: trainEval.accuracy,
      valAccuracy: valEval.accuracy,
      testAccuracy: testEval.accuracy,
      macroPrecision: testEval.macroPrecision,
      macroRecall: testEval.macroRecall,
      macroF1: testEval.macroF1,
      brierScore: testEval.brierScore,
      positivePrecision: testEval.perClass[1]?.precision ?? 0,
      positiveRecall: testEval.perClass[1]?.recall ?? 0,
      confusionMatrix: testEval.confusionMatrix,
      perClass: testEval.perClass,
      walkForwardFolds,
      featureImportance,
      hyperparameters: bestParams,
      driftPsi,
      driftStatus,
    },
    hyperparameters: bestParams,
  };
}

export function predictStrategyDeterioration(params: {
  strategy: StrategyProfile;
  regime: MarketRegime;
  featureRow: EngineeredFeatureRow;
  artifact: SerializedRiskArtifact | null;
  modelVersion: string;
  dataQualityScore: number;
}): {
  probability30m: number;
  probability60m: number;
  riskTier: 'Low' | 'Moderate' | 'Elevated' | 'High' | 'Critical';
  confidence: number;
  isFallbackRule: boolean;
  topFeatures: FeatureContribution[];
} {
  const { strategy, regime, featureRow, artifact, dataQualityScore } = params;
  const x = buildRiskFeatureVector({
    regime,
    archetype: strategy.archetype,
    recentDrawdownPct: strategy.recentDrawdownPct,
    winRateRecent: strategy.winRatePct / 100,
    consecutiveLosses: strategy.consecutiveLosses,
    realizedVol20: featureRow.realizedVol20,
    atrPct: featureRow.atrPct,
    volumeChange: featureRow.volumeChange,
    slippageBps: strategy.avgSlippageBps,
    exposureUsd: strategy.exposureUsd,
    equityUsd: strategy.equityUsd,
    leverage: strategy.leverage,
    volClustering: featureRow.volClustering,
  });

  let prob30m = 0;
  let isFallbackRule = false;
  let contribs: number[] = new Array(RISK_FEATURE_NAMES.length).fill(0);

  if (!artifact || dataQualityScore < 65) {
    isFallbackRule = true;
    const mismatch = isRegimeHostile(strategy.archetype, regime);
    const raw =
      0.1 +
      mismatch * 0.28 +
      Math.min(0.25, strategy.recentDrawdownPct / 18) +
      Math.min(0.2, strategy.consecutiveLosses * 0.04) +
      Math.min(0.15, (featureRow.volClustering - 1) * 0.25);
    prob30m = Math.max(0.03, Math.min(0.96, raw));
    contribs = [0.05, mismatch * 0.28, strategy.recentDrawdownPct * 0.02, 0, strategy.consecutiveLosses * 0.04, featureRow.realizedVol20 * 12, 0, 0, strategy.avgSlippageBps * 0.01, 0, strategy.leverage * 0.01, Math.max(0, featureRow.volClustering - 1) * 0.2];
  } else {
    prob30m = predictBinaryGbdt(artifact.model, x);
    contribs = explainBinaryGbdt(artifact.model, x);
  }

  // 60m horizon compounds survival hazard conservatively unless already near ceiling
  const prob60m = Math.min(0.98, 1 - Math.pow(1 - prob30m, 1.45));
  const maxP = Math.max(prob30m, prob60m);

  const riskTier =
    maxP >= 0.78
      ? 'Critical'
      : maxP >= 0.6
        ? 'High'
        : maxP >= 0.42
          ? 'Elevated'
          : maxP >= 0.22
            ? 'Moderate'
            : 'Low';

  const topFeatures: FeatureContribution[] = RISK_FEATURE_NAMES.map((meta, idx) => ({
    feature: meta.key,
    label: meta.label,
    value: Math.round((x[idx] ?? 0) * 10000) / 10000,
    contribution: Math.round((contribs[idx] ?? 0) * 1000) / 1000,
    direction: ((contribs[idx] ?? 0) >= 0 ? 'increases_risk' : 'reduces_risk') as
      | 'increases_risk'
      | 'reduces_risk',
  }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 5);

  // Calibration certainty rises away from 0.5 boundary and drops if data quality is degraded
  const boundaryDist = Math.abs(prob30m - 0.5) * 2;
  const confidence = Math.max(
    0.35,
    Math.min(0.95, (0.55 + boundaryDist * 0.35) * (dataQualityScore / 100)),
  );

  return {
    probability30m: Math.round(prob30m * 1000) / 1000,
    probability60m: Math.round(prob60m * 1000) / 1000,
    riskTier,
    confidence: Math.round(confidence * 1000) / 1000,
    isFallbackRule,
    topFeatures,
  };
}
