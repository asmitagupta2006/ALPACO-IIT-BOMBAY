import {
  attributeClassificationTreePath,
  createSeededRng,
  predictClassificationTreeProbs,
  trainClassificationTree,
  type ClassificationTreeNode,
} from './decisionTree';
import { softmax } from './metrics';

export interface RandomForestArtifact {
  type: 'random_forest';
  numClasses: number;
  numFeatures: number;
  trees: ClassificationTreeNode[];
  featureImportances: number[];
  temperature: number;
}

export function trainRandomForest(params: {
  X: number[][];
  y: number[];
  numClasses: number;
  nTrees?: number;
  maxDepth?: number;
  minSamplesLeaf?: number;
  seed?: number;
  XVal?: number[][];
  yVal?: number[];
}): RandomForestArtifact {
  const { X, y, numClasses } = params;
  const nTrees = params.nTrees ?? 32;
  const maxDepth = params.maxDepth ?? 6;
  const minSamplesLeaf = params.minSamplesLeaf ?? 6;
  const numFeatures = X[0]?.length ?? 0;
  const maxFeatures = Math.max(2, Math.round(Math.sqrt(numFeatures)));
  const rng = createSeededRng(params.seed ?? 42);

  // Class-balanced sample weights to prevent silent collapse onto majority regime
  const classCounts = new Array(numClasses).fill(0);
  for (const label of y) classCounts[label] += 1;
  const sampleWeights = y.map((label) => {
    const cnt = classCounts[label] || 1;
    return X.length / (numClasses * cnt);
  });

  const featureImportances = new Array(numFeatures).fill(0);
  const trees: ClassificationTreeNode[] = [];

  for (let t = 0; t < nTrees; t++) {
    // Contiguous block-bootstrap sampling (block size 8) to preserve local temporal autocorrelation
    const sampleIdx: number[] = [];
    const blockSize = Math.min(8, Math.max(2, Math.floor(X.length / 20)));
    while (sampleIdx.length < X.length) {
      const start = Math.floor(rng() * Math.max(1, X.length - blockSize + 1));
      for (let b = 0; b < blockSize && sampleIdx.length < X.length; b++) {
        sampleIdx.push(start + b);
      }
    }

    const tree = trainClassificationTree({
      X,
      y,
      numClasses,
      sampleWeights,
      indices: sampleIdx,
      maxDepth,
      minSamplesLeaf,
      maxFeatures,
      rng,
      featureImportances,
    });
    trees.push(tree);
  }

  const impSum = featureImportances.reduce((a, b) => a + b, 0) || 1;
  const normImp = featureImportances.map((v) => v / impSum);

  const artifact: RandomForestArtifact = {
    type: 'random_forest',
    numClasses,
    numFeatures,
    trees,
    featureImportances: normImp,
    temperature: 1.0,
  };

  if (params.XVal && params.yVal && params.XVal.length > 10) {
    artifact.temperature = fitTemperatureScaling(artifact, params.XVal, params.yVal);
  }

  return artifact;
}

function rawAvgProbs(artifact: RandomForestArtifact, x: number[]): number[] {
  const avg = new Array(artifact.numClasses).fill(0);
  for (const tree of artifact.trees) {
    const p = predictClassificationTreeProbs(tree, x);
    for (let c = 0; c < artifact.numClasses; c++) {
      avg[c] += p[c] ?? 0;
    }
  }
  const n = Math.max(1, artifact.trees.length);
  return avg.map((v) => Math.max(1e-6, v / n));
}

function fitTemperatureScaling(
  artifact: RandomForestArtifact,
  XVal: number[][],
  yVal: number[],
): number {
  const candidates = [0.7, 0.85, 1.0, 1.25, 1.5, 1.8];
  let bestT = 1.0;
  let bestLoss = Infinity;

  const rawList = XVal.map((x) => rawAvgProbs(artifact, x));
  for (const temp of candidates) {
    let nll = 0;
    for (let i = 0; i < rawList.length; i++) {
      const logits = rawList[i].map((p) => Math.log(p) / temp);
      const probs = softmax(logits);
      nll -= Math.log(Math.max(1e-7, probs[yVal[i]]));
    }
    if (nll < bestLoss) {
      bestLoss = nll;
      bestT = temp;
    }
  }
  return bestT;
}

export function predictRandomForest(
  artifact: RandomForestArtifact,
  x: number[],
): {
  predictedClass: number;
  probabilities: number[];
  confidence: number;
} {
  const avg = rawAvgProbs(artifact, x);
  const probabilities =
    artifact.temperature === 1.0
      ? avg
      : softmax(avg.map((p) => Math.log(p) / artifact.temperature));

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

export function explainRandomForestPrediction(
  artifact: RandomForestArtifact,
  x: number[],
  targetClass: number,
): number[] {
  const contribs = new Array(artifact.numFeatures).fill(0);
  for (const tree of artifact.trees) {
    attributeClassificationTreePath(tree, x, targetClass, contribs);
  }
  const n = Math.max(1, artifact.trees.length);
  return contribs.map((v) => v / n);
}
