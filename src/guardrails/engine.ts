import type {
  ConditionLogic,
  FiredGuardrailRule,
  GuardrailAction,
  GuardrailAlert,
  GuardrailCondition,
  GuardrailEvaluationResult,
  GuardrailInputSnapshot,
  GuardrailMetricId,
  GuardrailOperator,
  GuardrailRule,
} from '../contracts/guardrails.ts';
import type { Phase2RegimeLabel, Phase2RegimeResponse } from '../contracts/regime.ts';

export interface MetricDefinition {
  id: GuardrailMetricId;
  label: string;
  kind: 'number' | 'regime';
  unit: string;
  min?: number;
  max?: number;
  step?: number;
  allowedOperators: GuardrailOperator[];
}

export const METRIC_DEFINITIONS: Record<GuardrailMetricId, MetricDefinition> = {
  risk_score: {
    id: 'risk_score',
    label: 'Regime Risk Score',
    kind: 'number',
    unit: 'pts',
    min: 0,
    max: 100,
    step: 0.5,
    allowedOperators: ['>', '>=', '<', '<='],
  },
  vol_z_score: {
    id: 'vol_z_score',
    label: 'Volatility Z-Score',
    kind: 'number',
    unit: 'σ',
    min: -10,
    max: 25,
    step: 0.1,
    allowedOperators: ['>', '>=', '<', '<='],
  },
  abs_trend_strength: {
    id: 'abs_trend_strength',
    label: '|Trend Strength|',
    kind: 'number',
    unit: 'σ',
    min: 0,
    max: 25,
    step: 0.05,
    allowedOperators: ['>', '>=', '<', '<='],
  },
  cusum_max: {
    id: 'cusum_max',
    label: 'CUSUM Change-Point',
    kind: 'number',
    unit: 'σ',
    min: 0,
    max: 50,
    step: 0.1,
    allowedOperators: ['>', '>=', '<', '<='],
  },
  abs_funding_rate: {
    id: 'abs_funding_rate',
    label: '|Funding Rate (8h)|',
    kind: 'number',
    unit: '%',
    min: 0,
    max: 5,
    step: 0.001,
    allowedOperators: ['>', '>=', '<', '<='],
  },
  abs_mark_basis: {
    id: 'abs_mark_basis',
    label: '|Mark vs Spot Basis|',
    kind: 'number',
    unit: '%',
    min: 0,
    max: 25,
    step: 0.01,
    allowedOperators: ['>', '>=', '<', '<='],
  },
  abs_oi_change_6h: {
    id: 'abs_oi_change_6h',
    label: '|6h Open Interest Change|',
    kind: 'number',
    unit: '%',
    min: 0,
    max: 500,
    step: 0.5,
    allowedOperators: ['>', '>=', '<', '<='],
  },
  implied_volatility: {
    id: 'implied_volatility',
    label: 'Implied Volatility (Mark IV)',
    kind: 'number',
    unit: '%',
    min: 0,
    max: 1000,
    step: 1,
    allowedOperators: ['>', '>=', '<', '<='],
  },
  regime: {
    id: 'regime',
    label: 'Market Regime',
    kind: 'regime',
    unit: '',
    allowedOperators: ['=', '!='],
  },
};

export const VALID_REGIME_LABELS: readonly Phase2RegimeLabel[] = [
  'Calm/Range',
  'Trending',
  'High-Volatility/Shock',
];

const ACTION_SEVERITY: Record<GuardrailAction, number> = {
  CONTINUE: 0,
  'REDUCE SIZE': 1,
  PAUSE: 2,
};

export const READ_ONLY_GUARDRAIL_NOTICE =
  'Read-only recommendation only. No order is placed, modified, or cancelled.';

/**
 * Validates a user-authored guardrail rule before saving or evaluating.
 */
export function validateGuardrailRule(
  rule: Partial<GuardrailRule>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!rule.name || rule.name.trim().length < 2) {
    errors.push('Rule name must be at least 2 characters.');
  } else if (rule.name.trim().length > 80) {
    errors.push('Rule name must be 80 characters or fewer.');
  }

  if (rule.action !== 'REDUCE SIZE' && rule.action !== 'PAUSE') {
    errors.push('Resulting action must be REDUCE SIZE or PAUSE.');
  }

  if (rule.logic !== 'OR' && rule.logic !== 'AND') {
    errors.push('Condition combinator must be OR or AND.');
  }

  if (!Array.isArray(rule.conditions) || rule.conditions.length === 0) {
    errors.push('Rule must contain at least one condition.');
    return { valid: false, errors };
  }

  if (rule.conditions.length > 4) {
    errors.push('Rule cannot contain more than 4 conditions.');
  }

  rule.conditions.forEach((cond, idx) => {
    const prefix = `Condition ${idx + 1}`;
    const def = METRIC_DEFINITIONS[cond.metric];
    if (!def) {
      errors.push(`${prefix}: unknown metric "${String(cond.metric)}".`);
      return;
    }

    if (!def.allowedOperators.includes(cond.operator)) {
      errors.push(`${prefix}: invalid operator "${cond.operator}" for ${def.label}.`);
    }

    if (def.kind === 'number') {
      if (
        typeof cond.thresholdNumber !== 'number' ||
        !Number.isFinite(cond.thresholdNumber)
      ) {
        errors.push(`${prefix}: threshold must be a finite number.`);
      } else if (
        (def.min !== undefined && cond.thresholdNumber < def.min) ||
        (def.max !== undefined && cond.thresholdNumber > def.max)
      ) {
        errors.push(
          `${prefix}: ${def.label} threshold must be between ${def.min} and ${def.max}${def.unit}.`,
        );
      }
    } else {
      if (
        !cond.thresholdRegime ||
        !VALID_REGIME_LABELS.includes(cond.thresholdRegime)
      ) {
        errors.push(`${prefix}: select a valid Market Regime label.`);
      }
    }
  });

  return { valid: errors.length === 0, errors };
}

export function validateCooldownSeconds(value: number): {
  valid: boolean;
  error: string | null;
} {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return { valid: false, error: 'Cooldown must be a whole number of seconds.' };
  }
  if (value < 0 || value > 86_400) {
    return { valid: false, error: 'Cooldown must be between 0 and 86,400 seconds.' };
  }
  return { valid: true, error: null };
}

function getNumericInputById(
  regimeOutput: Phase2RegimeResponse,
  id: string,
): { value: number | null; reason: string | null } {
  const item = regimeOutput.inputs.find((entry) => entry.id === id);
  if (!item) {
    return { value: null, reason: `Field "${id}" not returned in regime output` };
  }
  if (!item.available || item.value === null || !Number.isFinite(item.value)) {
    return {
      value: null,
      reason: item.reasonIfExcluded || `${item.label} unavailable in regime output`,
    };
  }
  return { value: item.value, reason: null };
}

export function extractInputSnapshot(
  regimeOutput: Phase2RegimeResponse,
): GuardrailInputSnapshot | null {
  if (!regimeOutput.sufficientData || !regimeOutput.currentRegime || regimeOutput.score === null) {
    return null;
  }

  return {
    regime: regimeOutput.currentRegime,
    riskScore: regimeOutput.score,
    volZScore: getNumericInputById(regimeOutput, 'volZScore').value,
    trendStrength: getNumericInputById(regimeOutput, 'trendStrength').value,
    cusumMax: getNumericInputById(regimeOutput, 'cusumMax').value,
    fundingRate: getNumericInputById(regimeOutput, 'fundingRate').value,
    markIndexBasis: getNumericInputById(regimeOutput, 'markIndexBasis').value,
    oiChange6h: getNumericInputById(regimeOutput, 'oiChange6h').value,
    impliedVolatility: getNumericInputById(regimeOutput, 'impliedVolatility').value,
  };
}

function resolveMetricValue(
  regimeOutput: Phase2RegimeResponse,
  metric: GuardrailMetricId,
): {
  value: number | Phase2RegimeLabel | null;
  display: string;
  missingReason: string | null;
} {
  const def = METRIC_DEFINITIONS[metric];

  if (metric === 'regime') {
    if (!regimeOutput.currentRegime) {
      return { value: null, display: 'Unavailable', missingReason: 'Regime label absent' };
    }
    return { value: regimeOutput.currentRegime, display: regimeOutput.currentRegime, missingReason: null };
  }

  if (metric === 'risk_score') {
    if (regimeOutput.score === null || !Number.isFinite(regimeOutput.score)) {
      return { value: null, display: 'Unavailable', missingReason: 'Risk score absent' };
    }
    return {
      value: regimeOutput.score,
      display: `${regimeOutput.score.toFixed(1)} pts`,
      missingReason: null,
    };
  }

  const map: Record<
    Exclude<GuardrailMetricId, 'regime' | 'risk_score'>,
    { inputId: string; abs: boolean; decimals: number }
  > = {
    vol_z_score: { inputId: 'volZScore', abs: false, decimals: 2 },
    abs_trend_strength: { inputId: 'trendStrength', abs: true, decimals: 2 },
    cusum_max: { inputId: 'cusumMax', abs: false, decimals: 2 },
    abs_funding_rate: { inputId: 'fundingRate', abs: true, decimals: 4 },
    abs_mark_basis: { inputId: 'markIndexBasis', abs: true, decimals: 4 },
    abs_oi_change_6h: { inputId: 'oiChange6h', abs: true, decimals: 2 },
    implied_volatility: { inputId: 'impliedVolatility', abs: false, decimals: 2 },
  };

  const spec = map[metric];
  const raw = getNumericInputById(regimeOutput, spec.inputId);
  if (raw.value === null) {
    return {
      value: null,
      display: 'Excluded',
      missingReason: raw.reason ?? `${def.label} excluded`,
    };
  }

  const effective = spec.abs ? Math.abs(raw.value) : raw.value;
  return {
    value: effective,
    display: `${effective.toFixed(spec.decimals)}${def.unit}`,
    missingReason: null,
  };
}

function compareNumeric(
  actual: number,
  op: GuardrailOperator,
  threshold: number,
): boolean {
  switch (op) {
    case '>':
      return actual > threshold;
    case '>=':
      return actual >= threshold;
    case '<':
      return actual < threshold;
    case '<=':
      return actual <= threshold;
    default:
      return false;
  }
}

export function formatConditionThreshold(cond: GuardrailCondition): string {
  const def = METRIC_DEFINITIONS[cond.metric];
  if (def.kind === 'regime') {
    return cond.thresholdRegime ?? '—';
  }
  return typeof cond.thresholdNumber === 'number'
    ? `${cond.thresholdNumber}${def.unit}`
    : '—';
}

export function evaluateGuardrailRules(params: {
  regimeOutput: Phase2RegimeResponse | null;
  rules: GuardrailRule[];
  evaluatedAtIso?: string;
}): GuardrailEvaluationResult {
  const nowIso = params.evaluatedAtIso ?? params.regimeOutput?.computedAt ?? new Date().toISOString();
  const { regimeOutput, rules } = params;

  if (!regimeOutput) {
    return {
      available: false,
      unavailableReason: 'Regime telemetry has not been loaded yet.',
      symbol: null,
      timeframe: null,
      timestamp: nowIso,
      candleTimestamp: null,
      action: null,
      firedRules: [],
      evaluatedRuleCount: rules.length,
      enabledRuleCount: rules.filter((r) => r.enabled).length,
      inputs: null,
      missingInputs: [],
      comparisons: [],
      readOnlyNotice: READ_ONLY_GUARDRAIL_NOTICE,
    };
  }

  if (!regimeOutput.sufficientData || !regimeOutput.currentRegime || regimeOutput.score === null) {
    return {
      available: false,
      unavailableReason:
        regimeOutput.insufficientReason ||
        'Insufficient regime data — guardrail emits NO recommendation.',
      symbol: regimeOutput.symbol,
      timeframe: regimeOutput.resolution,
      timestamp: nowIso,
      candleTimestamp: regimeOutput.lastCandleIso,
      action: null,
      firedRules: [],
      evaluatedRuleCount: rules.length,
      enabledRuleCount: rules.filter((r) => r.enabled).length,
      inputs: null,
      missingInputs: [],
      comparisons: [],
      readOnlyNotice: READ_ONLY_GUARDRAIL_NOTICE,
    };
  }

  const inputSnapshot = extractInputSnapshot(regimeOutput)!;
  const enabledRules = rules.filter((r) => r.enabled);
  const firedRules: FiredGuardrailRule[] = [];
  const missingMap = new Map<GuardrailMetricId, string>();
  const allComparisons: string[] = [];

  for (const rule of enabledRules) {
    const check = validateGuardrailRule(rule);
    if (!check.valid) continue;

    const evaluatedConditions = rule.conditions.map((cond) => {
      const def = METRIC_DEFINITIONS[cond.metric];
      const resolved = resolveMetricValue(regimeOutput, cond.metric);
      const thresholdDisplay = formatConditionThreshold(cond);

      if (resolved.value === null) {
        if (resolved.missingReason) {
          missingMap.set(cond.metric, resolved.missingReason);
        }
        return {
          conditionId: cond.id,
          metric: cond.metric,
          metricLabel: def.label,
          operator: cond.operator,
          thresholdDisplay,
          actualValue: null,
          actualDisplay: resolved.display,
          matched: false,
          missingInput: true,
          missingReason: resolved.missingReason,
        };
      }

      let matched = false;
      if (def.kind === 'regime' && typeof resolved.value === 'string') {
        matched =
          cond.operator === '='
            ? resolved.value === cond.thresholdRegime
            : resolved.value !== cond.thresholdRegime;
      } else if (
        def.kind === 'number' &&
        typeof resolved.value === 'number' &&
        typeof cond.thresholdNumber === 'number'
      ) {
        matched = compareNumeric(resolved.value, cond.operator, cond.thresholdNumber);
      }

      return {
        conditionId: cond.id,
        metric: cond.metric,
        metricLabel: def.label,
        operator: cond.operator,
        thresholdDisplay,
        actualValue: resolved.value,
        actualDisplay: resolved.display,
        matched,
        missingInput: false,
        missingReason: null,
      };
    });

    const ruleFired =
      rule.logic === 'AND'
        ? evaluatedConditions.length > 0 && evaluatedConditions.every((c) => c.matched)
        : evaluatedConditions.some((c) => c.matched);

    if (ruleFired) {
      const matchedConditions = evaluatedConditions.filter((c) => c.matched);
      const summaryParts = matchedConditions.map(
        (c) => `${c.metricLabel} ${c.actualDisplay} ${c.operator} ${c.thresholdDisplay}`,
      );
      const summaryText = `${rule.name} [${rule.action}]: ${summaryParts.join(` ${rule.logic} `)}`;
      allComparisons.push(...summaryParts);

      firedRules.push({
        ruleId: rule.id,
        ruleName: rule.name,
        action: rule.action,
        logic: rule.logic,
        matchedConditions,
        allConditions: evaluatedConditions,
        summaryText,
      });
    }
  }

  let finalAction: GuardrailAction = 'CONTINUE';
  for (const fr of firedRules) {
    if (ACTION_SEVERITY[fr.action] > ACTION_SEVERITY[finalAction]) {
      finalAction = fr.action;
    }
  }

  return {
    available: true,
    unavailableReason: null,
    symbol: regimeOutput.symbol,
    timeframe: regimeOutput.resolution,
    timestamp: nowIso,
    candleTimestamp: regimeOutput.lastCandleIso ?? nowIso,
    action: finalAction,
    firedRules,
    evaluatedRuleCount: rules.length,
    enabledRuleCount: enabledRules.length,
    inputs: inputSnapshot,
    missingInputs: Array.from(missingMap.entries()).map(([metric, reason]) => ({
      metric,
      reason,
    })),
    comparisons: allComparisons,
    readOnlyNotice: READ_ONLY_GUARDRAIL_NOTICE,
  };
}

export function buildEvaluationSignature(
  action: GuardrailAction,
  firedRules: FiredGuardrailRule[],
): string {
  const ruleIds = firedRules
    .map((r) => r.ruleId)
    .sort()
    .join(',');
  return `${action}::${ruleIds}`;
}

function makeAlertId(symbol: string, nowMs: number, counter: number): string {
  const cleanSymbol = symbol.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24);
  return `alt_${cleanSymbol}_${nowMs}_${counter}`;
}

/**
 * Reconciles a new guardrail evaluation into the existing alert feed:
 * - Never raises duplicate alerts when the exact same action & fired rule set repeats
 *   or falls within the configured cooldown window.
 * - Raises a new alert when action changes (to REDUCE SIZE or PAUSE) or a new rule fires
 *   (outside cooldown for identical signature).
 * - Marks any prior 'pending' alerts for the same (symbol, timeframe) as 'superseded'
 *   once they are no longer current.
 */
export function reconcileAlertFeed(params: {
  existingAlerts: GuardrailAlert[];
  evaluation: GuardrailEvaluationResult;
  cooldownSeconds: number;
  previousRegime?: Phase2RegimeLabel | null;
  nowMs?: number;
}): {
  alerts: GuardrailAlert[];
  createdAlert: GuardrailAlert | null;
  supersededCount: number;
} {
  const { existingAlerts, evaluation, cooldownSeconds } = params;
  const nowMs = params.nowMs ?? Date.now();

  if (
    !evaluation.available ||
    !evaluation.action ||
    !evaluation.symbol ||
    !evaluation.timeframe ||
    !evaluation.inputs
  ) {
    return { alerts: existingAlerts, createdAlert: null, supersededCount: 0 };
  }

  const symbol = evaluation.symbol;
  const timeframe = evaluation.timeframe;
  const cooldownMs = Math.max(0, cooldownSeconds) * 1000;

  // Case 1: Evaluation returned CONTINUE (or no actionable rules fired)
  if (evaluation.action === 'CONTINUE' || evaluation.firedRules.length === 0) {
    let supersededCount = 0;
    const nextAlerts = existingAlerts.map((alert) => {
      if (
        alert.symbol === symbol &&
        alert.timeframe === timeframe &&
        alert.status === 'pending'
      ) {
        supersededCount += 1;
        return { ...alert, status: 'superseded' as const };
      }
      return alert;
    });
    return { alerts: nextAlerts, createdAlert: null, supersededCount };
  }

  const signature = buildEvaluationSignature(evaluation.action, evaluation.firedRules);

  // Latest alert for this (symbol, timeframe) regardless of status
  const latestSameScope = existingAlerts.find(
    (a) => a.symbol === symbol && a.timeframe === timeframe,
  );

  // If the current condition matches the most recent alert for this pair & timeframe:
  // 1) If that alert is still pending, it's already current — do not duplicate!
  // 2) If that alert was already decided within cooldownMs, suppress duplicate spam!
  if (latestSameScope && latestSameScope.signature === signature) {
    if (latestSameScope.status === 'pending') {
      return { alerts: existingAlerts, createdAlert: null, supersededCount: 0 };
    }
    if (nowMs - latestSameScope.createdAtMs < cooldownMs) {
      return { alerts: existingAlerts, createdAlert: null, supersededCount: 0 };
    }
  }

  // Also check if ANY alert with the identical signature fired within cooldownMs
  const recentSameSig = existingAlerts.find(
    (a) =>
      a.symbol === symbol &&
      a.timeframe === timeframe &&
      a.signature === signature &&
      nowMs - a.createdAtMs < cooldownMs,
  );
  if (recentSameSig) {
    return { alerts: existingAlerts, createdAlert: null, supersededCount: 0 };
  }

  // Check whether action changed or at least one new rule fired compared to latest active/recent scope alert
  const prevRuleSet = new Set(
    latestSameScope?.firedRules.map((r) => r.ruleId) ?? [],
  );
  const newRuleFired = evaluation.firedRules.some((r) => !prevRuleSet.has(r.ruleId));
  const actionChanged = !latestSameScope || latestSameScope.action !== evaluation.action;
  const cooldownExpired =
    !latestSameScope || nowMs - latestSameScope.createdAtMs >= cooldownMs;

  if (!actionChanged && !newRuleFired && !cooldownExpired) {
    return { alerts: existingAlerts, createdAlert: null, supersededCount: 0 };
  }

  let supersededCount = 0;
  const updatedAlerts = existingAlerts.map((alert) => {
    if (
      alert.symbol === symbol &&
      alert.timeframe === timeframe &&
      alert.status === 'pending'
    ) {
      supersededCount += 1;
      return { ...alert, status: 'superseded' as const };
    }
    return alert;
  });

  const newAlert: GuardrailAlert = {
    id: makeAlertId(symbol, nowMs, existingAlerts.length + 1),
    signature,
    symbol,
    timeframe,
    previousRegime: params.previousRegime ?? latestSameScope?.regime ?? null,
    regime: evaluation.inputs.regime,
    riskScore: evaluation.inputs.riskScore,
    action: evaluation.action,
    firedRules: evaluation.firedRules,
    ruleNames: evaluation.firedRules.map((r) => `${r.ruleName} (${r.action})`),
    thresholds: evaluation.firedRules.map((r) => r.summaryText),
    inputValues: evaluation.inputs,
    comparisons: evaluation.comparisons,
    createdAt: evaluation.timestamp,
    createdAtMs: nowMs,
    candleTimestamp: evaluation.candleTimestamp ?? evaluation.timestamp,
    status: 'pending',
    decision: null,
    decidedAt: null,
    firestoreState: 'not_saved',
    firestoreError: null,
    explanationState: 'idle',
    explanation: null,
    explanationError: null,
  };

  return {
    alerts: [newAlert, ...updatedAlerts],
    createdAlert: newAlert,
    supersededCount,
  };
}
