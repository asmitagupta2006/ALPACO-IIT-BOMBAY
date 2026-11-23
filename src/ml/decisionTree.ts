export interface ClassificationTreeNode {
  isLeaf: boolean;
  probs: number[];
  featureIdx?: number;
  threshold?: number;
  left?: ClassificationTreeNode;
  right?: ClassificationTreeNode;
  impurityGain?: number;
  sampleWeightSum: number;
}

export interface RegressionTreeNode {
  isLeaf: boolean;
  value: number;
  featureIdx?: number;
  threshold?: number;
  left?: RegressionTreeNode;
  right?: RegressionTreeNode;
  gain?: number;
  sampleWeightSum: number;
}

export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function giniFromCounts(counts: number[], totalWeight: number): number {
  if (totalWeight <= 0) return 0;
  let sumSq = 0;
  for (let c = 0; c < counts.length; c++) {
    const p = counts[c] / totalWeight;
    sumSq += p * p;
  }
  return 1 - sumSq;
}

export function trainClassificationTree(params: {
  X: number[][];
  y: number[];
  numClasses: number;
  sampleWeights?: number[];
  indices?: number[];
  maxDepth: number;
  minSamplesLeaf: number;
  maxFeatures: number;
  rng: () => number;
  featureImportances: number[];
}): ClassificationTreeNode {
  const { X, y, numClasses, maxDepth, minSamplesLeaf, maxFeatures, rng, featureImportances } =
    params;
  const weights = params.sampleWeights ?? new Array(X.length).fill(1);
  const allIdx = params.indices ?? X.map((_, i) => i);
  const numFeatures = X[0]?.length ?? 0;

  const build = (idxs: number[], depth: number): ClassificationTreeNode => {
    const counts = new Array(numClasses).fill(0);
    let totalW = 0;
    for (const idx of idxs) {
      const w = weights[idx];
      counts[y[idx]] += w;
      totalW += w;
    }

    const probs = counts.map((c) => (totalW > 0 ? c / totalW : 1 / numClasses));
    const parentGini = giniFromCounts(counts, totalW);

    if (depth >= maxDepth || idxs.length < minSamplesLeaf * 2 || parentGini <= 1e-7) {
      return { isLeaf: true, probs, sampleWeightSum: totalW };
    }

    // Subsample features deterministically
    const featPool = Array.from({ length: numFeatures }, (_, f) => f);
    for (let i = featPool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = featPool[i];
      featPool[i] = featPool[j];
      featPool[j] = tmp;
    }
    const candidateFeatures = featPool.slice(0, Math.max(1, Math.min(numFeatures, maxFeatures)));

    let bestGain = 0;
    let bestFeature = -1;
    let bestThreshold = 0;

    for (const f of candidateFeatures) {
      const sorted = [...idxs].sort((a, b) => X[a][f] - X[b][f]);
      const leftCounts = new Array(numClasses).fill(0);
      const rightCounts = [...counts];
      let leftW = 0;
      let rightW = totalW;

      for (let i = 0; i < sorted.length - 1; i++) {
        const idx = sorted[i];
        const nextIdx = sorted[i + 1];
        const cls = y[idx];
        const w = weights[idx];

        leftCounts[cls] += w;
        rightCounts[cls] -= w;
        leftW += w;
        rightW -= w;

        const val = X[idx][f];
        const nextVal = X[nextIdx][f];
        if (nextVal - val <= 1e-12) continue;
        if (i + 1 < minSamplesLeaf || sorted.length - (i + 1) < minSamplesLeaf) continue;

        const leftGini = giniFromCounts(leftCounts, leftW);
        const rightGini = giniFromCounts(rightCounts, rightW);
        const weightedChildGini = (leftW / totalW) * leftGini + (rightW / totalW) * rightGini;
        const gain = totalW * (parentGini - weightedChildGini);

        if (gain > bestGain) {
          bestGain = gain;
          bestFeature = f;
          bestThreshold = 0.5 * (val + nextVal);
        }
      }
    }

    if (bestFeature === -1 || bestGain <= 1e-9) {
      return { isLeaf: true, probs, sampleWeightSum: totalW };
    }

    featureImportances[bestFeature] += bestGain;
    const leftIdx: number[] = [];
    const rightIdx: number[] = [];
    for (const idx of idxs) {
      if (X[idx][bestFeature] <= bestThreshold) {
        leftIdx.push(idx);
      } else {
        rightIdx.push(idx);
      }
    }

    if (leftIdx.length < minSamplesLeaf || rightIdx.length < minSamplesLeaf) {
      return { isLeaf: true, probs, sampleWeightSum: totalW };
    }

    return {
      isLeaf: false,
      probs,
      featureIdx: bestFeature,
      threshold: bestThreshold,
      left: build(leftIdx, depth + 1),
      right: build(rightIdx, depth + 1),
      impurityGain: bestGain,
      sampleWeightSum: totalW,
    };
  };

  return build(allIdx, 0);
}

export function predictClassificationTreeProbs(
  node: ClassificationTreeNode,
  x: number[],
): number[] {
  let curr = node;
  while (!curr.isLeaf && curr.featureIdx !== undefined && curr.threshold !== undefined) {
    curr = x[curr.featureIdx] <= curr.threshold ? curr.left! : curr.right!;
  }
  return curr.probs;
}

/**
 * Saabas local tree-path contribution for class c:
 * Exact difference in node probability along the decision path attributed to each split feature.
 */
export function attributeClassificationTreePath(
  node: ClassificationTreeNode,
  x: number[],
  targetClass: number,
  outContribs: number[],
): void {
  let curr = node;
  while (!curr.isLeaf && curr.featureIdx !== undefined && curr.threshold !== undefined) {
    const next = x[curr.featureIdx] <= curr.threshold ? curr.left! : curr.right!;
    const delta = (next.probs[targetClass] ?? 0) - (curr.probs[targetClass] ?? 0);
    outContribs[curr.featureIdx] += delta;
    curr = next;
  }
}

/**
 * L2-regularized gradient boosting regression tree (XGBoost-style exact split gain):
 * Gain = 0.5 * (G_L^2/(H_L + lambda) + G_R^2/(H_R + lambda) - (G_L+G_R)^2/(H_L+H_R+lambda))
 * Leaf value = -G / (H + lambda)
 */
export function trainGbdtRegressionTree(params: {
  X: number[][];
  gradients: number[];
  hessians: number[];
  indices: number[];
  maxDepth: number;
  minSamplesLeaf: number;
  l2Reg: number;
  maxFeatures: number;
  rng: () => number;
  featureImportances: number[];
}): RegressionTreeNode {
  const { X, gradients, hessians, indices, maxDepth, minSamplesLeaf, l2Reg, maxFeatures, rng, featureImportances } =
    params;
  const numFeatures = X[0]?.length ?? 0;

  const build = (idxs: number[], depth: number): RegressionTreeNode => {
    let sumG = 0;
    let sumH = 0;
    for (const idx of idxs) {
      sumG += gradients[idx];
      sumH += hessians[idx];
    }
    const leafValue = -sumG / (sumH + l2Reg);

    if (depth >= maxDepth || idxs.length < minSamplesLeaf * 2 || sumH <= 1e-9) {
      return { isLeaf: true, value: leafValue, sampleWeightSum: idxs.length };
    }

    const featPool = Array.from({ length: numFeatures }, (_, f) => f);
    for (let i = featPool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = featPool[i];
      featPool[i] = featPool[j];
      featPool[j] = tmp;
    }
    const candidateFeatures = featPool.slice(0, Math.max(1, Math.min(numFeatures, maxFeatures)));

    const parentScore = (sumG * sumG) / (sumH + l2Reg);
    let bestGain = 0;
    let bestFeature = -1;
    let bestThreshold = 0;

    for (const f of candidateFeatures) {
      const sorted = [...idxs].sort((a, b) => X[a][f] - X[b][f]);
      let leftG = 0;
      let leftH = 0;

      for (let i = 0; i < sorted.length - 1; i++) {
        const idx = sorted[i];
        const nextIdx = sorted[i + 1];
        leftG += gradients[idx];
        leftH += hessians[idx];

        const val = X[idx][f];
        const nextVal = X[nextIdx][f];
        if (nextVal - val <= 1e-12) continue;
        if (i + 1 < minSamplesLeaf || sorted.length - (i + 1) < minSamplesLeaf) continue;

        const rightG = sumG - leftG;
        const rightH = sumH - leftH;
        const gain =
          0.5 *
          ((leftG * leftG) / (leftH + l2Reg) +
            (rightG * rightG) / (rightH + l2Reg) -
            parentScore);

        if (gain > bestGain) {
          bestGain = gain;
          bestFeature = f;
          bestThreshold = 0.5 * (val + nextVal);
        }
      }
    }

    if (bestFeature === -1 || bestGain <= 1e-7) {
      return { isLeaf: true, value: leafValue, sampleWeightSum: idxs.length };
    }

    featureImportances[bestFeature] += bestGain;
    const leftIdx: number[] = [];
    const rightIdx: number[] = [];
    for (const idx of idxs) {
      if (X[idx][bestFeature] <= bestThreshold) {
        leftIdx.push(idx);
      } else {
        rightIdx.push(idx);
      }
    }

    if (leftIdx.length < minSamplesLeaf || rightIdx.length < minSamplesLeaf) {
      return { isLeaf: true, value: leafValue, sampleWeightSum: idxs.length };
    }

    return {
      isLeaf: false,
      value: leafValue,
      featureIdx: bestFeature,
      threshold: bestThreshold,
      left: build(leftIdx, depth + 1),
      right: build(rightIdx, depth + 1),
      gain: bestGain,
      sampleWeightSum: idxs.length,
    };
  };

  return build(indices, 0);
}

export function predictRegressionTree(node: RegressionTreeNode, x: number[]): number {
  let curr = node;
  while (!curr.isLeaf && curr.featureIdx !== undefined && curr.threshold !== undefined) {
    curr = x[curr.featureIdx] <= curr.threshold ? curr.left! : curr.right!;
  }
  return curr.value;
}

export function attributeRegressionTreePath(
  node: RegressionTreeNode,
  x: number[],
  scale: number,
  outContribs: number[],
): void {
  let curr = node;
  while (!curr.isLeaf && curr.featureIdx !== undefined && curr.threshold !== undefined) {
    const next = x[curr.featureIdx] <= curr.threshold ? curr.left! : curr.right!;
    outContribs[curr.featureIdx] += scale * (next.value - curr.value);
    curr = next;
  }
}
