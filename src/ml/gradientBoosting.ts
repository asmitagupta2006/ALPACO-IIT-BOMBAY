import {
  attributeRegressionTreePath,
  createSeededRng,
  predictRegressionTree,
  trainGbdtRegressionTree,
  type RegressionTreeNode,
} from './decisionTree';
import { sigmoid, softmax } from './metrics';

export interface MultiClassGbdtArtifact {
  type: 'gbdt_multiclass';
  numClasses: number;
  numFeatures: number;
  learningRate: number;
  baseScores: number[];
  rounds: RegressionTreeNode[][]; // [round][class]
  featureImportances: number[];
  temperature: number;
}

export interface BinaryGbdtArtifact {
  type: 'gbdt_binary';
  numFeatures: number;
  learningRate: number;
  baseScore: number;
  trees: RegressionTreeNode[];
  featureImportances: number[];
  plattA: number;
  plattB: number;
}

export function trainMultiClassGbdt(params: {
  X: number[][];
  y: number[];
  numClasses: number;
  XVal?: number[][];
  yVal?: number[];
  nEstimators?: number;
  learningRate?: number;
  maxDepth?: number;
  minSamplesLeaf?: number;
  l2Reg?: number;
  subsample?: number;
  seed?: number;
}): MultiClassGbdtArtifact {
  const { X, y, numClasses } = params;
  const nEstimators = params.nEstimators ?? 35;
  const learningRate = params.learningRate ?? 0.1;
  const maxDepth = params.maxDepth ?? 3;
  const minSamplesLeaf = params.minSamplesLeaf ?? 8;
  const l2Reg = params.l2Reg ?? 2.0;
  const subsample = params.subsample ?? 0.85;
  const n = X.length;
  const numFeatures = X[0]?.length ?? 0;
  const maxFeatures = Math.max(3, Math.ceil(numFeatures * 0.75));
  const rng = createSeededRng(params.seed ?? 1337);

  // Class weighting for imbalance resilience
  const counts = new Array(numClasses).fill(0);
  for (const cls of y) counts[cls] += 1;
  const classWeights = counts.map((c) => (c > 0 ? n / (numClasses * c) : 1));
  const priors = counts.map((c) => Math.max(1e-4, c / Math.max(1, n)));
  const baseScores = priors.map((p) => Math.log(p));

  const scores: number[][] = Array.from({ length: n }, () => [...baseScores]);
  const valScores: number[][] = params.XVal
    ? Array.from({ length: params.XVal.length }, () => [...baseScores])
    : [];

  const featureImportances = new Array(numFeatures).fill(0);
  const rounds: RegressionTreeNode[][] = [];

  let bestValLoss = Infinity;
  let bestRoundCount = nEstimators;
  let patience = 0;

  for (let m = 0; m < nEstimators; m++) {
    // Subsample indices chronologically-safe
    const subIdx: number[] = [];
    for (let i = 0; i < n; i++) {
      if (rng() <= subsample) subIdx.push(i);
    }
    if (subIdx.length < minSamplesLeaf * 2) {
      for (let i = 0; i < n; i++) subIdx.push(i);
    }

    const probs = scores.map((s) => softmax(s));
    const roundTrees: RegressionTreeNode[] = [];

    for (let k = 0; k < numClasses; k++) {
      const gradients = new Array(n);
      const hessians = new Array(n);
      for (let i = 0; i < n; i++) {
        const target = y[i] === k ? 1 : 0;
        const p = probs[i][k];
        const w = classWeights[y[i]];
        gradients[i] = w * (p - target);
        hessians[i] = Math.max(1e-4, w * 2 * p * (1 - p));
      }

      const tree = trainGbdtRegressionTree({
        X,
        gradients,
        hessians,
        indices: subIdx,
        maxDepth,
        minSamplesLeaf,
        l2Reg,
        maxFeatures,
        rng,
        featureImportances,
      });
      roundTrees.push(tree);

      for (let i = 0; i < n; i++) {
        scores[i][k] += learningRate * predictRegressionTree(tree, X[i]);
      }
      if (params.XVal) {
        for (let i = 0; i < params.XVal.length; i++) {
          valScores[i][k] += learningRate * predictRegressionTree(tree, params.XVal[i]);
        }
      }
    }

    rounds.push(roundTrees);

    if (params.XVal && params.yVal && params.XVal.length > 10 && m >= 8) {
      let valLoss = 0;
      for (let i = 0; i < params.XVal.length; i++) {
        const vp = softmax(valScores[i]);
        valLoss -= Math.log(Math.max(1e-7, vp[params.yVal[i]]));
      }
      valLoss /= params.XVal.length;
      if (valLoss < bestValLoss - 1e-4) {
        bestValLoss = valLoss;
        bestRoundCount = rounds.length;
        patience = 0;
      } else {
        patience += 1;
        if (patience >= 6) break;
      }
    }
  }

  const finalRounds = rounds.slice(0, Math.max(5, bestRoundCount));
  const impSum = featureImportances.reduce((a, b) => a + b, 0) || 1;

  const artifact: MultiClassGbdtArtifact = {
    type: 'gbdt_multiclass',
    numClasses,
    numFeatures,
    learningRate,
    baseScores,
    rounds: finalRounds,
    featureImportances: featureImportances.map((v) => v / impSum),
    temperature: 1.0,
  };

  if (params.XVal && params.yVal && params.XVal.length > 10) {
    artifact.temperature = fitMultiClassTemp(artifact, params.XVal, params.yVal);
  }

  return artifact;
}

function fitMultiClassTemp(
  artifact: MultiClassGbdtArtifact,
  XVal: number[][],
  yVal: number[],
): number {
  const temps = [0.75, 0.9, 1.0, 1.15, 1.35, 1.6];
  const rawLogits = XVal.map((x) => computeMultiClassLogits(artifact, x));
  let bestT = 1.0;
  let bestLoss = Infinity;

  for (const t of temps) {
    let nll = 0;
    for (let i = 0; i < rawLogits.length; i++) {
      const probs = softmax(rawLogits[i].map((v) => v / t));
      nll -= Math.log(Math.max(1e-7, probs[yVal[i]]));
    }
    if (nll < bestLoss) {
      bestLoss = nll;
      bestT = t;
    }
  }
  return bestT;
}

function computeMultiClassLogits(artifact: MultiClassGbdtArtifact, x: number[]): number[] {
  const logits = [...artifact.baseScores];
  for (const roundTrees of artifact.rounds) {
    for (let k = 0; k < artifact.numClasses; k++) {
      logits[k] += artifact.learningRate * predictRegressionTree(roundTrees[k], x);
    }
  }
  return logits;
}

export function predictMultiClassGbdt(
  artifact: MultiClassGbdtArtifact,
  x: number[],
): {
  predictedClass: number;
  probabilities: number[];
  confidence: number;
} {
  const logits = computeMultiClassLogits(artifact, x);
  const probabilities = softmax(logits.map((v) => v / artifact.temperature));
  let bestClass = 0;
  let bestProb = -1;
  for (let c = 0; c < probabilities.length; c++) {
    if (probabilities[c] > bestProb) {
      bestProb = probabilities[c];
      bestClass = c;
    }
  }
  return {
    predictedClass: bestClass,
    probabilities,
    confidence: bestProb,
  };
}

export function explainMultiClassGbdt(
  artifact: MultiClassGbdtArtifact,
  x: number[],
  targetClass: number,
): number[] {
  const contribs = new Array(artifact.numFeatures).fill(0);
  const scale = artifact.learningRate / artifact.temperature;
  for (const roundTrees of artifact.rounds) {
    attributeRegressionTreePath(roundTrees[targetClass], x, scale, contribs);
  }
  return contribs;
}

/**
 * Binary XGBoost-style GBDT for Strategy Deterioration / Risk Event Probability
 */
export function trainBinaryGbdt(params: {
  X: number[][];
  y: number[]; // 0 or 1
  XVal?: number[][];
  yVal?: number[];
  nEstimators?: number;
  learningRate?: number;
  maxDepth?: number;
  minSamplesLeaf?: number;
  l2Reg?: number;
  seed?: number;
}): BinaryGbdtArtifact {
  const { X, y } = params;
  const nEstimators = params.nEstimators ?? 40;
  const learningRate = params.learningRate ?? 0.08;
  const maxDepth = params.maxDepth ?? 3;
  const minSamplesLeaf = params.minSamplesLeaf ?? 8;
  const l2Reg = params.l2Reg ?? 2.5;
  const n = X.length;
  const numFeatures = X[0]?.length ?? 0;
  const maxFeatures = Math.max(3, Math.ceil(numFeatures * 0.8));
  const rng = createSeededRng(params.seed ?? 2026);

  const posCount = y.filter((v) => v === 1).length;
  const negCount = Math.max(1, n - posCount);
  // Moderate positive weighting to balance precision & recall on rare risk spikes
  const posWeight = Math.min(3.5, Math.max(1.0, Math.sqrt(negCount / Math.max(1, posCount))));
  const baseProb = Math.min(0.95, Math.max(0.05, posCount / Math.max(1, n)));
  const baseScore = Math.log(baseProb / (1 - baseProb));

  const scores = new Array(n).fill(baseScore);
  const valScores = params.XVal ? new Array(params.XVal.length).fill(baseScore) : [];
  const featureImportances = new Array(numFeatures).fill(0);
  const trees: RegressionTreeNode[] = [];

  let bestValLoss = Infinity;
  let bestRound = nEstimators;
  let patience = 0;

  for (let m = 0; m < nEstimators; m++) {
    const subIdx: number[] = [];
    for (let i = 0; i < n; i++) {
      if (rng() <= 0.85) subIdx.push(i);
    }
    if (subIdx.length < minSamplesLeaf * 2) {
      for (let i = 0; i < n; i++) subIdx.push(i);
    }

    const gradients = new Array(n);
    const hessians = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = sigmoid(scores[i]);
      const w = y[i] === 1 ? posWeight : 1.0;
      gradients[i] = w * (p - y[i]);
      hessians[i] = Math.max(1e-4, w * p * (1 - p));
    }

    const tree = trainGbdtRegressionTree({
      X,
      gradients,
      hessians,
      indices: subIdx,
      maxDepth,
      minSamplesLeaf,
      l2Reg,
      maxFeatures,
      rng,
      featureImportances,
    });
    trees.push(tree);

    for (let i = 0; i < n; i++) {
      scores[i] += learningRate * predictRegressionTree(tree, X[i]);
    }

    if (params.XVal && params.yVal && params.XVal.length > 10) {
      let vLoss = 0;
      for (let i = 0; i < params.XVal.length; i++) {
        valScores[i] += learningRate * predictRegressionTree(tree, params.XVal[i]);
        const vp = sigmoid(valScores[i]);
        vLoss -=
          params.yVal[i] * Math.log(Math.max(1e-7, vp)) +
          (1 - params.yVal[i]) * Math.log(Math.max(1e-7, 1 - vp));
      }
      vLoss /= params.XVal.length;
      if (m >= 8) {
        if (vLoss < bestValLoss - 1e-4) {
          bestValLoss = vLoss;
          bestRound = trees.length;
          patience = 0;
        } else {
          patience += 1;
          if (patience >= 6) break;
        }
      }
    }
  }

  const finalTrees = trees.slice(0, Math.max(6, bestRound));
  const impSum = featureImportances.reduce((a, b) => a + b, 0) || 1;

  const artifact: BinaryGbdtArtifact = {
    type: 'gbdt_binary',
    numFeatures,
    learningRate,
    baseScore,
    trees: finalTrees,
    featureImportances: featureImportances.map((v) => v / impSum),
    plattA: 1.0,
    plattB: 0.0,
  };

  if (params.XVal && params.yVal && params.XVal.length > 12) {
    const fitted = fitPlattScaling(artifact, params.XVal, params.yVal);
    artifact.plattA = fitted.a;
    artifact.plattB = fitted.b;
  }

  return artifact;
}

function fitPlattScaling(
  artifact: BinaryGbdtArtifact,
  XVal: number[][],
  yVal: number[],
): { a: number; b: number } {
  const raw = XVal.map((x) => {
    let s = artifact.baseScore;
    for (const t of artifact.trees) s += artifact.learningRate * predictRegressionTree(t, x);
    return s;
  });

  // Grid search over Platt slope & intercept optimizing validation log-loss
  let bestA = 1.0;
  let bestB = 0.0;
  let bestLoss = Infinity;
  for (const a of [0.6, 0.8, 1.0, 1.2]) {
    for (const b of [-0.6, -0.3, 0.0, 0.3]) {
      let loss = 0;
      for (let i = 0; i < raw.length; i++) {
        const p = sigmoid(a * raw[i] + b);
        loss -=
          yVal[i] * Math.log(Math.max(1e-7, p)) +
          (1 - yVal[i]) * Math.log(Math.max(1e-7, 1 - p));
      }
      if (loss < bestLoss) {
        bestLoss = loss;
        bestA = a;
        bestB = b;
      }
    }
  }
  return { a: bestA, b: bestB };
}

export function predictBinaryGbdt(artifact: BinaryGbdtArtifact, x: number[]): number {
  let score = artifact.baseScore;
  for (const tree of artifact.trees) {
    score += artifact.learningRate * predictRegressionTree(tree, x);
  }
  return sigmoid(artifact.plattA * score + artifact.plattB);
}

export function explainBinaryGbdt(artifact: BinaryGbdtArtifact, x: number[]): number[] {
  const contribs = new Array(artifact.numFeatures).fill(0);
  const scale = artifact.learningRate * artifact.plattA;
  for (const tree of artifact.trees) {
    attributeRegressionTreePath(tree, x, scale, contribs);
  }
  return contribs;
}
