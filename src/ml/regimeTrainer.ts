import type { CandleResolution, DeltaCandle } from '../contracts/delta';
import {
  MARKET_REGIMES,
  type EngineeredFeatureRow,
  type FeatureContribution,
  type MarketRegime,
  type ModelEvaluationMetrics,
  type RegimeInference,
  type RegimeQuantileThresholds,
  type WalkForwardFoldResult,
} from '../contracts/sentinel';
import {
  MODEL_FEATURE_NAMES,
  engineerFeatures,
  extractFeatureVector,
} from '../quant/indicators';
import { computeRegimeQuantiles, labelBarRegime } from '../quant/regimeLabels';
import {
  explainMultiClassGbdt,
  predictMultiClassGbdt,
  trainMultiClassGbdt,
  type MultiClassGbdtArtifact,
} from './gradientBoosting';
import { computeClassificationMetrics, computePsi } from './metrics';
import {
  explainRandomForestPrediction,
  predictRandomForest,
  trainRandomForest,
  type RandomForestArtifact,
} from './randomForest';

export type RegimeAlgorithmChoice = 'gbdt' | 'random_forest';

export interface SerializedRegimeArtifact {
  modelKind: 'regime';
  algorithm: RegimeAlgorithmChoice;
  thresholds: RegimeQuantileThresholds;
  baselineRealizedVol: number[];
  model: MultiClassGbdtArtifact | RandomForestArtifact;
}

export interface RegimeTrainingOutput {
  artifact: SerializedRegimeArtifact;
  metrics: ModelEvaluationMetrics;
  hyperparameters: Record<string, string | number>;
}

const WARMUP_BARS = 50;
const PURGE_GAP_BARS = 2;

export function buildRegimeSupervisedDataset(
  candles: DeltaCandle[],
  thresholdsOverride?: RegimeQuantileThresholds,
): {
  X: number[][];
  y: number[];
  rows: EngineeredFeatureRow[];
  thresholds: RegimeQuantileThresholds;
  trainEndIdx: number;
  valStartIdx: number;
  valEndIdx: number;
  testStartIdx: number;
} {
  const features = engineerFeatures(candles);
  const usableStart = Math.min(WARMUP_BARS, Math.max(0, Math.floor(features.length * 0.1)));
  // Last bar has no (t+1) target; usable pairs span [usableStart .. features.length - 2]
  const totalPairs = Math.max(0, features.length - 1 - usableStart);

  const trainCount = Math.floor(totalPairs * 0.7);
  const valCount = Math.floor(totalPairs * 0.15);

  const trainEndPair = trainCount;
  const valStartPair = Math.min(totalPairs, trainEndPair + PURGE_GAP_BARS);
  const valEndPair = Math.min(totalPairs, valStartPair + valCount);
  const testStartPair = Math.min(totalPairs, valEndPair + PURGE_GAP_BARS);

  const trainRows = features.slice(usableStart, usableStart + Math.max(20, trainEndPair));
  const thresholds = thresholdsOverride ?? computeRegimeQuantiles(trainRows);

  const X: number[][] = [];
  const y: number[] = [];
  const rows: EngineeredFeatureRow[] = [];

  for (let i = usableStart; i < features.length - 1; i++) {
    const current = features[i];
    const next = features[i + 1];
    // Target is regime at t+1 using only causal features at <= t (zero look-ahead leakage)
    const nextRegime = labelBarRegime(next, thresholds, current);
    const labelIdx = MARKET_REGIMES.indexOf(nextRegime);

    X.push(extractFeatureVector(current));
    y.push(labelIdx);
    rows.push(current);
  }

  return {
    X,
    y,
    rows,
    thresholds,
    trainEndIdx: trainEndPair,
    valStartIdx: valStartPair,
    valEndIdx: valEndPair,
    testStartIdx: testStartPair,
  };
}

export function trainAndEvaluateRegimeModel(params: {
  candles: DeltaCandle[];
  algorithm: RegimeAlgorithmChoice;
}): RegimeTrainingOutput {
  const ds = buildRegimeSupervisedDataset(params.candles);
  if (ds.X.length < 90 || ds.testStartIdx >= ds.X.length - 5) {
    throw new Error(
      `Insufficient cleaned candles (${params.candles.length}) for chronological 70/15/15 split and walk-forward validation.`,
    );
  }

  const XTrain = ds.X.slice(0, ds.trainEndIdx);
  const yTrain = ds.y.slice(0, ds.trainEndIdx);
  const XVal = ds.X.slice(ds.valStartIdx, ds.valEndIdx);
  const yVal = ds.y.slice(ds.valStartIdx, ds.valEndIdx);
  const XTest = ds.X.slice(ds.testStartIdx);
  const yTest = ds.y.slice(ds.testStartIdx);

  const numClasses = MARKET_REGIMES.length;
  let bestArtifact: MultiClassGbdtArtifact | RandomForestArtifact | null = null;
  let bestValAcc = -1;
  let bestParams: Record<string, string | number> = {};

  if (params.algorithm === 'gbdt') {
    const candidates = [
      { maxDepth: 3, learningRate: 0.08, nEstimators: 32, l2Reg: 2.0 },
      { maxDepth: 4, learningRate: 0.1, nEstimators: 36, l2Reg: 2.5 },
      { maxDepth: 3, learningRate: 0.13, nEstimators: 28, l2Reg: 1.5 },
    ];
    for (const cfg of candidates) {
      const candidate = trainMultiClassGbdt({
        X: XTrain,
        y: yTrain,
        numClasses,
        XVal,
        yVal,
        ...cfg,
      });
      const valPreds = XVal.map((x) => predictMultiClassGbdt(candidate, x));
      const valMetrics = computeClassificationMetrics({
        yTrue: yVal,
        yPred: valPreds.map((p) => p.predictedClass),
        probs: valPreds.map((p) => p.probabilities),
        labels: [...MARKET_REGIMES],
      });
      if (valMetrics.accuracy > bestValAcc) {
        bestValAcc = valMetrics.accuracy;
        bestArtifact = candidate;
        bestParams = {
          algorithm: 'Gradient Boosted Trees',
          maxDepth: cfg.maxDepth,
          learningRate: cfg.learningRate,
          roundsTrained: candidate.rounds.length,
          l2Reg: cfg.l2Reg,
          temperature: candidate.temperature,
        };
      }
    }
  } else {
    const candidates = [
      { nTrees: 28, maxDepth: 5, minSamplesLeaf: 6 },
      { nTrees: 36, maxDepth: 6, minSamplesLeaf: 5 },
    ];
    for (const cfg of candidates) {
      const candidate = trainRandomForest({
        X: XTrain,
        y: yTrain,
        numClasses,
        XVal,
        yVal,
        ...cfg,
      });
      const valPreds = XVal.map((x) => predictRandomForest(candidate, x));
      const valMetrics = computeClassificationMetrics({
        yTrue: yVal,
        yPred: valPreds.map((p) => p.predictedClass),
        probs: valPreds.map((p) => p.probabilities),
        labels: [...MARKET_REGIMES],
      });
      if (valMetrics.accuracy > bestValAcc) {
        bestValAcc = valMetrics.accuracy;
        bestArtifact = candidate;
        bestParams = {
          algorithm: 'Random Forest',
          nTrees: cfg.nTrees,
          maxDepth: cfg.maxDepth,
          minSamplesLeaf: cfg.minSamplesLeaf,
          temperature: candidate.temperature,
        };
      }
    }
  }

  const model = bestArtifact!;
  const predict = (x: number[]) =>
    model.type === 'gbdt_multiclass'
      ? predictMultiClassGbdt(model, x)
      : predictRandomForest(model, x);

  const trainPreds = XTrain.map(predict);
  const valPreds = XVal.map(predict);
  const testPreds = XTest.map(predict);

  const trainEval = computeClassificationMetrics({
    yTrue: yTrain,
    yPred: trainPreds.map((p) => p.predictedClass),
    probs: trainPreds.map((p) => p.probabilities),
    labels: [...MARKET_REGIMES],
  });
  const valEval = computeClassificationMetrics({
    yTrue: yVal,
    yPred: valPreds.map((p) => p.predictedClass),
    probs: valPreds.map((p) => p.probabilities),
    labels: [...MARKET_REGIMES],
  });
  const testEval = computeClassificationMetrics({
    yTrue: yTest,
    yPred: testPreds.map((p) => p.predictedClass),
    probs: testPreds.map((p) => p.probabilities),
    labels: [...MARKET_REGIMES],
  });

  // Expanding Walk-Forward Validation (4 chronological folds)
  const walkForwardFolds: WalkForwardFoldResult[] = [];
  const foldSpan = Math.floor((ds.X.length * 0.45) / 4);
  const firstTrainEnd = Math.floor(ds.X.length * 0.48);

  if (foldSpan >= 12) {
    for (let f = 0; f < 4; f++) {
      const fTrainEnd = firstTrainEnd + f * foldSpan;
      const fTestStart = fTrainEnd + PURGE_GAP_BARS;
      const fTestEnd = Math.min(ds.X.length, fTestStart + foldSpan);
      if (fTestEnd - fTestStart < 8) continue;

      const fXTrain = ds.X.slice(0, fTrainEnd);
      const fYTrain = ds.y.slice(0, fTrainEnd);
      const fXTest = ds.X.slice(fTestStart, fTestEnd);
      const fYTest = ds.y.slice(fTestStart, fTestEnd);

      const fModel =
        params.algorithm === 'gbdt'
          ? trainMultiClassGbdt({
              X: fXTrain,
              y: fYTrain,
              numClasses,
              nEstimators: 24,
              learningRate: 0.1,
              maxDepth: Number(bestParams.maxDepth) || 3,
              seed: 100 + f,
            })
          : trainRandomForest({
              X: fXTrain,
              y: fYTrain,
              numClasses,
              nTrees: 24,
              maxDepth: Number(bestParams.maxDepth) || 5,
              seed: 100 + f,
            });

      const fPreds = fXTest.map((x) =>
        fModel.type === 'gbdt_multiclass'
          ? predictMultiClassGbdt(fModel, x)
          : predictRandomForest(fModel, x),
      );
      const fEval = computeClassificationMetrics({
        yTrue: fYTest,
        yPred: fPreds.map((p) => p.predictedClass),
        probs: fPreds.map((p) => p.probabilities),
        labels: [...MARKET_REGIMES],
      });

      walkForwardFolds.push({
        fold: f + 1,
        trainCount: fXTrain.length,
        testCount: fXTest.length,
        trainStartIso: new Date(ds.rows[0].time * 1000).toISOString(),
        testEndIso: new Date(ds.rows[fTestEnd - 1].time * 1000).toISOString(),
        accuracy: fEval.accuracy,
        macroF1: fEval.macroF1,
        brierScore: fEval.brierScore,
      });
    }
  }

  const featureImportance = MODEL_FEATURE_NAMES.map((meta, idx) => ({
    feature: meta.key,
    label: meta.label,
    importance: Math.round((model.featureImportances[idx] ?? 0) * 10000) / 10000,
  })).sort((a, b) => b.importance - a.importance);

  const baselineVol = ds.rows.slice(0, ds.trainEndIdx).map((r) => r.realizedVol20);
  const recentVol = ds.rows.slice(ds.testStartIdx).map((r) => r.realizedVol20);
  const driftPsi = computePsi(baselineVol, recentVol);
  const driftStatus =
    driftPsi >= 0.25 ? 'Drift Alert' : driftPsi >= 0.1 ? 'Moderate Shift' : 'Nominal';

  return {
    artifact: {
      modelKind: 'regime',
      algorithm: params.algorithm,
      thresholds: ds.thresholds,
      baselineRealizedVol: baselineVol.slice(-240),
      model,
    },
    metrics: {
      splitSummary: {
        totalRows: ds.X.length,
        trainRows: XTrain.length,
        valRows: XVal.length,
        testRows: XTest.length,
        purgeGapBars: PURGE_GAP_BARS,
      },
      trainAccuracy: trainEval.accuracy,
      valAccuracy: valEval.accuracy,
      testAccuracy: testEval.accuracy,
      macroPrecision: testEval.macroPrecision,
      macroRecall: testEval.macroRecall,
      macroF1: testEval.macroF1,
      brierScore: testEval.brierScore,
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

export function inferRegimeWithModel(params: {
  symbol: string;
  resolution: CandleResolution;
  featureRow: EngineeredFeatureRow;
  prevFeatureRow?: EngineeredFeatureRow;
  artifact: SerializedRegimeArtifact | null;
  modelVersion: string;
  dataQualityScore: number;
}): RegimeInference {
  const { featureRow, artifact, dataQualityScore } = params;

  if (!artifact || dataQualityScore < 65) {
    const fallbackThresholds = artifact?.thresholds ?? computeRegimeQuantiles([featureRow]);
    const regime = labelBarRegime(featureRow, fallbackThresholds, params.prevFeatureRow);
    const probs: Record<MarketRegime, number> = {
      Trending: 0.08,
      Ranging: 0.08,
      'High Volatility': 0.08,
      'Low Volatility': 0.08,
      'Transition / Unstable': 0.08,
    };
    probs[regime] = 0.68;

    return {
      symbol: params.symbol,
      resolution: params.resolution,
      timestamp: featureRow.time,
      regime,
      probabilities: probs,
      confidence: 0.68,
      modelVersion: artifact ? `${params.modelVersion} (Rule Fallback)` : 'Rule Baseline',
      modelAlgorithm: 'Causal Rule Fallback',
      isFallbackRule: true,
      features: featureRow,
      topDrivers: [
        {
          feature: 'realizedVol20',
          label: 'Realized Volatility (20)',
          value: featureRow.realizedVol20,
          contribution: 0.28,
          direction: 'supports_regime',
        },
        {
          feature: 'trendStrength',
          label: 'Trend Strength',
          value: featureRow.trendStrength,
          contribution: 0.22,
          direction: 'supports_regime',
        },
        {
          feature: 'volClustering',
          label: 'Volatility Clustering (5/20)',
          value: featureRow.volClustering,
          contribution: 0.18,
          direction: 'supports_regime',
        },
      ],
    };
  }

  const x = extractFeatureVector(featureRow);
  const pred =
    artifact.model.type === 'gbdt_multiclass'
      ? predictMultiClassGbdt(artifact.model, x)
      : predictRandomForest(artifact.model, x);

  const regime = MARKET_REGIMES[pred.predictedClass] ?? 'Ranging';
  const probabilities = {
    Trending: pred.probabilities[0] ?? 0,
    Ranging: pred.probabilities[1] ?? 0,
    'High Volatility': pred.probabilities[2] ?? 0,
    'Low Volatility': pred.probabilities[3] ?? 0,
    'Transition / Unstable': pred.probabilities[4] ?? 0,
  };

  const rawContribs =
    artifact.model.type === 'gbdt_multiclass'
      ? explainMultiClassGbdt(artifact.model, x, pred.predictedClass)
      : explainRandomForestPrediction(artifact.model, x, pred.predictedClass);

  const topDrivers: FeatureContribution[] = MODEL_FEATURE_NAMES.map((meta, idx) => ({
    feature: meta.key,
    label: meta.label,
    value: x[idx] ?? 0,
    contribution: Math.round((rawContribs[idx] ?? 0) * 1000) / 1000,
    direction: ((rawContribs[idx] ?? 0) >= 0 ? 'supports_regime' : 'opposes_regime') as
      | 'supports_regime'
      | 'opposes_regime',
  }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 5);

  return {
    symbol: params.symbol,
    resolution: params.resolution,
    timestamp: featureRow.time,
    regime,
    probabilities,
    confidence: pred.confidence,
    modelVersion: params.modelVersion,
    modelAlgorithm:
      artifact.algorithm === 'gbdt' ? 'Gradient Boosted Trees' : 'Random Forest',
    isFallbackRule: false,
    features: featureRow,
    topDrivers,
  };
}
