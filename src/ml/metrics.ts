import type { ClassMetrics, ConfusionMatrixData } from '../contracts/sentinel';

export function computeClassificationMetrics(params: {
  yTrue: number[];
  yPred: number[];
  probs: number[][];
  labels: string[];
}): {
  accuracy: number;
  macroPrecision: number;
  macroRecall: number;
  macroF1: number;
  brierScore: number;
  confusionMatrix: ConfusionMatrixData;
  perClass: ClassMetrics[];
} {
  const k = params.labels.length;
  const n = params.yTrue.length;
  const matrix: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));

  let correct = 0;
  let brierSum = 0;

  for (let i = 0; i < n; i++) {
    const t = params.yTrue[i];
    const p = params.yPred[i];
    if (t >= 0 && t < k && p >= 0 && p < k) {
      matrix[t][p] += 1;
      if (t === p) correct += 1;
    }
    const probRow = params.probs[i];
    if (probRow && probRow.length === k) {
      for (let c = 0; c < k; c++) {
        const target = c === t ? 1 : 0;
        const diff = probRow[c] - target;
        brierSum += diff * diff;
      }
    }
  }

  const perClass: ClassMetrics[] = [];
  let precSum = 0;
  let recSum = 0;
  let f1Sum = 0;
  let activeClasses = 0;

  for (let c = 0; c < k; c++) {
    const tp = matrix[c][c];
    let fp = 0;
    let fn = 0;
    let support = 0;
    for (let r = 0; r < k; r++) {
      support += matrix[c][r];
      if (r !== c) {
        fp += matrix[r][c];
        fn += matrix[c][r];
      }
    }
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    perClass.push({
      label: params.labels[c],
      precision,
      recall,
      f1,
      support,
    });

    if (support > 0) {
      precSum += precision;
      recSum += recall;
      f1Sum += f1;
      activeClasses += 1;
    }
  }

  const denom = Math.max(1, activeClasses);
  return {
    accuracy: n > 0 ? correct / n : 0,
    macroPrecision: precSum / denom,
    macroRecall: recSum / denom,
    macroF1: f1Sum / denom,
    brierScore: n > 0 ? brierSum / (n * k) : 0,
    confusionMatrix: {
      labels: [...params.labels],
      matrix,
    },
    perClass,
  };
}

/**
 * Population Stability Index (PSI) comparing baseline training feature/prediction
 * distribution vs current recent window.
 * PSI < 0.10 => Nominal; 0.10..0.25 => Moderate Shift; >= 0.25 => Drift Alert.
 */
export function computePsi(baseline: number[], current: number[], bins = 8): number {
  if (baseline.length < 10 || current.length < 5) return 0;

  const sorted = [...baseline].sort((a, b) => a - b);
  const edges: number[] = [];
  for (let b = 1; b < bins; b++) {
    const idx = Math.min(sorted.length - 1, Math.floor((b / bins) * sorted.length));
    edges.push(sorted[idx]);
  }

  const countBins = (arr: number[]) => {
    const counts = new Array(bins).fill(0);
    for (const v of arr) {
      let bucket = bins - 1;
      for (let b = 0; b < edges.length; b++) {
        if (v <= edges[b]) {
          bucket = b;
          break;
        }
      }
      counts[bucket] += 1;
    }
    const eps = 1e-4;
    return counts.map((c) => Math.max(eps, c / arr.length));
  };

  const p = countBins(baseline);
  const q = countBins(current);
  let psi = 0;
  for (let i = 0; i < bins; i++) {
    psi += (q[i] - p[i]) * Math.log(q[i] / p[i]);
  }
  return Math.max(0, Math.round(psi * 1000) / 1000);
}

export function softmax(logits: number[]): number[] {
  const maxLogit = Math.max(...logits);
  const exps = logits.map((v) => Math.exp(Math.max(-30, Math.min(30, v - maxLogit))));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

export function sigmoid(x: number): number {
  const clamped = Math.max(-30, Math.min(30, x));
  return 1 / (1 + Math.exp(-clamped));
}
