import { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Info,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type {
  ConditionLogic,
  GuardrailAction,
  GuardrailCondition,
  GuardrailEvaluationResult,
  GuardrailMetricId,
  GuardrailOperator,
  GuardrailRule,
} from '../contracts/guardrails';
import type { Phase2RegimeLabel } from '../contracts/regime';
import {
  METRIC_DEFINITIONS,
  VALID_REGIME_LABELS,
  validateCooldownSeconds,
  validateGuardrailRule,
} from '../guardrails/engine';
import { formatTimestamp } from '../utils/format';

interface GuardrailRulesPanelProps {
  rules: GuardrailRule[];
  onAddRule: (rule: GuardrailRule) => void;
  onToggleRule: (ruleId: string) => void;
  onDeleteRule: (ruleId: string) => void;
  cooldownSeconds: number;
  onChangeCooldownSeconds: (seconds: number) => void;
  evaluation: GuardrailEvaluationResult;
}

interface DraftConditionRow {
  id: string;
  metric: GuardrailMetricId;
  operator: GuardrailOperator;
  thresholdInput: string;
  thresholdRegime: Phase2RegimeLabel;
}

function makeEmptyCondition(idx: number): DraftConditionRow {
  return {
    id: `cond_${Date.now()}_${idx}`,
    metric: 'risk_score',
    operator: '>',
    thresholdInput: '',
    thresholdRegime: 'High-Volatility/Shock',
  };
}

function actionBadgeClass(action: GuardrailAction): string {
  switch (action) {
    case 'PAUSE':
      return 'border-rose-500/50 bg-rose-950/40 text-rose-200';
    case 'REDUCE SIZE':
      return 'border-amber-500/45 bg-amber-950/35 text-amber-200';
    case 'CONTINUE':
      return 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300';
  }
}

export function GuardrailRulesPanel({
  rules,
  onAddRule,
  onToggleRule,
  onDeleteRule,
  cooldownSeconds,
  onChangeCooldownSeconds,
  evaluation,
}: GuardrailRulesPanelProps) {
  const [ruleName, setRuleName] = useState('');
  const [action, setAction] = useState<Exclude<GuardrailAction, 'CONTINUE'>>('REDUCE SIZE');
  const [logic, setLogic] = useState<ConditionLogic>('OR');
  const [draftConditions, setDraftConditions] = useState<DraftConditionRow[]>([
    makeEmptyCondition(1),
  ]);
  const [formErrors, setFormErrors] = useState<string[]>([]);

  const [cooldownDraft, setCooldownDraft] = useState<string>(String(cooldownSeconds));
  const [cooldownError, setCooldownError] = useState<string | null>(null);

  const handleMetricChange = (rowId: string, nextMetric: GuardrailMetricId) => {
    const def = METRIC_DEFINITIONS[nextMetric];
    setDraftConditions((prev) =>
      prev.map((row) =>
        row.id === rowId
          ? {
              ...row,
              metric: nextMetric,
              operator: def.allowedOperators[0],
              thresholdInput: '',
            }
          : row,
      ),
    );
  };

  const handleAddConditionRow = () => {
    if (draftConditions.length >= 4) return;
    setDraftConditions((prev) => [...prev, makeEmptyCondition(prev.length + 1)]);
  };

  const handleRemoveConditionRow = (rowId: string) => {
    if (draftConditions.length <= 1) return;
    setDraftConditions((prev) => prev.filter((c) => c.id !== rowId));
  };

  const handleSubmitRule = (e: React.FormEvent) => {
    e.preventDefault();
    const parseErrors: string[] = [];

    const parsedConditions: GuardrailCondition[] = draftConditions.map((row, idx) => {
      const def = METRIC_DEFINITIONS[row.metric];
      if (def.kind === 'regime') {
        return {
          id: `c_${idx + 1}`,
          metric: row.metric,
          operator: row.operator,
          thresholdRegime: row.thresholdRegime,
        };
      }

      const raw = row.thresholdInput.trim();
      if (raw.length === 0) {
        parseErrors.push(`Condition ${idx + 1}: enter a numeric threshold for ${def.label}.`);
        return {
          id: `c_${idx + 1}`,
          metric: row.metric,
          operator: row.operator,
          thresholdNumber: Number.NaN,
        };
      }
      const num = Number(raw);
      return {
        id: `c_${idx + 1}`,
        metric: row.metric,
        operator: row.operator,
        thresholdNumber: num,
      };
    });

    const newRule: GuardrailRule = {
      id: `rule_${Date.now()}`,
      name: ruleName.trim(),
      logic,
      conditions: parsedConditions,
      action,
      enabled: true,
    };

    const validation = validateGuardrailRule(newRule);
    const combinedErrors = Array.from(new Set([...parseErrors, ...validation.errors]));

    if (combinedErrors.length > 0) {
      setFormErrors(combinedErrors);
      return;
    }

    setFormErrors([]);
    onAddRule(newRule);
    setRuleName('');
    setDraftConditions([makeEmptyCondition(1)]);
  };

  const handleCooldownApply = (raw: string) => {
    setCooldownDraft(raw);
    const parsed = Number(raw.trim());
    if (raw.trim() === '') {
      setCooldownError('Enter a cooldown in seconds.');
      return;
    }
    const check = validateCooldownSeconds(parsed);
    if (!check.valid) {
      setCooldownError(check.error);
      return;
    }
    setCooldownError(null);
    onChangeCooldownSeconds(parsed);
  };

  return (
    <section
      aria-label="Deterministic Guardrail Rules and Live Evaluation"
      className="rounded-lg border border-slate-800/90 bg-[#111A2E]"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="font-display text-sm font-semibold text-slate-100">
            Guardrail Rule Engine (Read-Only)
          </h2>
          <span className="rounded border border-slate-700 bg-[#0B1120] px-2 py-0.5 font-mono text-[11px] text-slate-300">
            {rules.length} user rule{rules.length === 1 ? '' : 's'}
          </span>
          {evaluation.available && evaluation.action && rules.length > 0 && (
            <span
              className={`rounded border px-2.5 py-0.5 font-mono text-xs font-semibold ${actionBadgeClass(
                evaluation.action,
              )}`}
            >
              {evaluation.action}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <label htmlFor="guardrail-cooldown-input" className="text-[11px] text-slate-400">
            Alert Cooldown (s)
          </label>
          <input
            id="guardrail-cooldown-input"
            type="number"
            min={0}
            max={86400}
            step={1}
            value={cooldownDraft}
            onChange={(e) => handleCooldownApply(e.target.value)}
            className="w-20 rounded border border-slate-700 bg-[#0B1120] px-2 py-1 font-mono text-xs text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* User Threshold Ownership & Read-Only Notice */}
        <div className="flex items-start gap-2.5 rounded-md border border-sky-500/30 bg-sky-950/15 px-3.5 py-2.5 text-xs text-sky-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" aria-hidden="true" />
          <p className="leading-relaxed">
            No default thresholds are preset — all rules and thresholds are yours to set. Guardrail
            evaluation is deterministic and read-only: it outputs a recommendation only and{' '}
            <strong className="text-sky-100">never places, modifies, or cancels orders</strong>.
          </p>
        </div>

        {cooldownError && (
          <p className="text-xs text-rose-300 font-mono">{cooldownError}</p>
        )}

        {/* Live Evaluation Output Box */}
        {!evaluation.available ? (
          <div className="rounded-md border border-amber-500/35 bg-amber-950/20 p-4 text-xs text-amber-200 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-amber-100">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
              <span>Guardrail Evaluation Unavailable — No Recommendation Emitted</span>
            </div>
            <p className="text-amber-200/90">
              {evaluation.unavailableReason || 'Regime telemetry is unavailable.'}
            </p>
            <p className="font-mono text-[11px] text-amber-300/80 tabular-nums">
              {evaluation.symbol ? `${evaluation.symbol} · ${evaluation.timeframe} · ` : ''}
              Evaluated at {formatTimestamp(evaluation.timestamp)}
            </p>
          </div>
        ) : rules.length === 0 ? (
          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-4 text-xs text-slate-300 space-y-1">
            <p className="font-medium text-slate-100">No guardrail rules configured yet</p>
            <p className="text-slate-400">
              Regime telemetry is active for{' '}
              <span className="font-mono text-slate-200">
                {evaluation.symbol} · {evaluation.timeframe}
              </span>{' '}
              ({evaluation.inputs?.regime}, score {evaluation.inputs?.riskScore.toFixed(1)}/100).
              Create your own rule below to evaluate thresholds and generate alerts.
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
              <div className="flex flex-wrap items-center gap-2">
                {evaluation.action === 'CONTINUE' ? (
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                ) : (
                  <ShieldAlert
                    className={`h-4 w-4 ${
                      evaluation.action === 'PAUSE' ? 'text-rose-400' : 'text-amber-400'
                    }`}
                  />
                )}
                <span className="text-xs font-semibold text-slate-100">
                  Recommendation: {evaluation.action}
                </span>
                <span className="font-mono text-[11px] text-slate-400">
                  {evaluation.symbol} · {evaluation.timeframe}
                </span>
              </div>
              <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                Evaluated {formatTimestamp(evaluation.timestamp)}
              </span>
            </div>

            {evaluation.firedRules.length === 0 ? (
              <p className="text-xs text-slate-300">
                {evaluation.enabledRuleCount} enabled rule
                {evaluation.enabledRuleCount === 1 ? '' : 's'} checked — 0 rules breached.
              </p>
            ) : (
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium text-slate-400">
                  Fired Rules ({evaluation.firedRules.length}) — Most severe action wins:
                </div>
                <ul className="space-y-1">
                  {evaluation.firedRules.map((fr) => (
                    <li
                      key={fr.ruleId}
                      className="rounded border border-slate-800 bg-[#111A2E] px-3 py-1.5 font-mono text-[11px] text-slate-200"
                    >
                      {fr.summaryText}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {evaluation.inputs && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-slate-400 tabular-nums">
                <span>Regime: {evaluation.inputs.regime}</span>
                <span>Risk Score: {evaluation.inputs.riskScore.toFixed(1)}</span>
                <span>
                  Vol Z:{' '}
                  {evaluation.inputs.volZScore !== null
                    ? `${evaluation.inputs.volZScore.toFixed(2)}σ`
                    : 'Excluded'}
                </span>
                <span>
                  |Trend|:{' '}
                  {evaluation.inputs.trendStrength !== null
                    ? `${Math.abs(evaluation.inputs.trendStrength).toFixed(2)}σ`
                    : 'Excluded'}
                </span>
                <span>
                  CUSUM:{' '}
                  {evaluation.inputs.cusumMax !== null
                    ? `${evaluation.inputs.cusumMax.toFixed(2)}σ`
                    : 'Excluded'}
                </span>
              </div>
            )}

            {evaluation.missingInputs.length > 0 && (
              <p className="text-[11px] text-amber-300/90">
                Skipped condition inputs absent on {evaluation.symbol}:{' '}
                {evaluation.missingInputs
                  .map((m) => `${METRIC_DEFINITIONS[m.metric].label} (${m.reason})`)
                  .join('; ')}
              </p>
            )}
          </div>
        )}

        {/* Existing User Rules */}
        {rules.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Configured Rules
            </h3>
            <div className="space-y-2">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-800 bg-[#0B1120] px-3.5 py-2.5 text-xs"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={() => onToggleRule(rule.id)}
                      aria-label={`Enable rule ${rule.name}`}
                      className="mt-0.5 cursor-pointer"
                    />
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`font-medium ${
                            rule.enabled ? 'text-slate-100' : 'text-slate-500 line-through'
                          }`}
                        >
                          {rule.name}
                        </span>
                        <span
                          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${actionBadgeClass(
                            rule.action,
                          )}`}
                        >
                          {rule.action}
                        </span>
                        {!rule.enabled && (
                          <span className="font-mono text-[10px] text-slate-500">DISABLED</span>
                        )}
                      </div>
                      <div className="font-mono text-[11px] text-slate-400">
                        IF{' '}
                        {rule.conditions
                          .map((c) => {
                            const def = METRIC_DEFINITIONS[c.metric];
                            const tVal =
                              def.kind === 'regime'
                                ? c.thresholdRegime
                                : `${c.thresholdNumber}${def.unit}`;
                            return `${def.label} ${c.operator} ${tVal}`;
                          })
                          .join(` ${rule.logic} `)}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onDeleteRule(rule.id)}
                    aria-label={`Delete rule ${rule.name}`}
                    className="rounded border border-slate-800 p-1.5 text-slate-400 hover:border-rose-500/40 hover:text-rose-300 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Create New Rule Form */}
        <form
          onSubmit={handleSubmitRule}
          className="rounded-md border border-slate-800/90 bg-[#0B1120] p-4 space-y-3.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-slate-200">Add Guardrail Rule</h3>
            <span className="text-[11px] text-slate-400">
              Enter your own numeric thresholds or regime trigger
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <label htmlFor="rule-name-input" className="block text-[11px] text-slate-400 mb-1">
                Rule Name
              </label>
              <input
                id="rule-name-input"
                type="text"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder="e.g. High Volatility Pause"
                maxLength={80}
                className="w-full rounded border border-slate-700 bg-[#111A2E] px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="rule-action-select" className="block text-[11px] text-slate-400 mb-1">
                Resulting Action
              </label>
              <select
                id="rule-action-select"
                value={action}
                onChange={(e) =>
                  setAction(e.target.value === 'PAUSE' ? 'PAUSE' : 'REDUCE SIZE')
                }
                className="w-full rounded border border-slate-700 bg-[#111A2E] px-2.5 py-1.5 text-xs text-slate-100 cursor-pointer"
              >
                <option value="REDUCE SIZE">REDUCE SIZE</option>
                <option value="PAUSE">PAUSE</option>
              </select>
            </div>

            <div>
              <label htmlFor="rule-logic-select" className="block text-[11px] text-slate-400 mb-1">
                Condition Match
              </label>
              <select
                id="rule-logic-select"
                value={logic}
                onChange={(e) => setLogic(e.target.value === 'AND' ? 'AND' : 'OR')}
                className="w-full rounded border border-slate-700 bg-[#111A2E] px-2.5 py-1.5 text-xs text-slate-100 cursor-pointer"
              >
                <option value="OR">Match ANY condition (OR)</option>
                <option value="AND">Match ALL conditions (AND)</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            {draftConditions.map((row, idx) => {
              const def = METRIC_DEFINITIONS[row.metric];
              return (
                <div
                  key={row.id}
                  className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_0.7fr_1fr_auto] items-end"
                >
                  <div>
                    <label
                      htmlFor={`cond-metric-${row.id}`}
                      className="block text-[11px] text-slate-400 mb-1"
                    >
                      Condition {idx + 1} Metric
                    </label>
                    <select
                      id={`cond-metric-${row.id}`}
                      value={row.metric}
                      onChange={(e) =>
                        handleMetricChange(row.id, e.target.value as GuardrailMetricId)
                      }
                      className="w-full rounded border border-slate-700 bg-[#111A2E] px-2.5 py-1.5 text-xs text-slate-100 cursor-pointer"
                    >
                      {Object.values(METRIC_DEFINITIONS).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                          {m.unit ? ` (${m.unit})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor={`cond-op-${row.id}`}
                      className="block text-[11px] text-slate-400 mb-1"
                    >
                      Operator
                    </label>
                    <select
                      id={`cond-op-${row.id}`}
                      value={row.operator}
                      onChange={(e) =>
                        setDraftConditions((prev) =>
                          prev.map((c) =>
                            c.id === row.id
                              ? { ...c, operator: e.target.value as GuardrailOperator }
                              : c,
                          ),
                        )
                      }
                      className="w-full rounded border border-slate-700 bg-[#111A2E] px-2.5 py-1.5 font-mono text-xs text-slate-100 cursor-pointer"
                    >
                      {def.allowedOperators.map((op) => (
                        <option key={op} value={op}>
                          {op}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor={`cond-val-${row.id}`}
                      className="block text-[11px] text-slate-400 mb-1"
                    >
                      Threshold {def.kind === 'number' ? `(${def.min}..${def.max}${def.unit})` : ''}
                    </label>
                    {def.kind === 'regime' ? (
                      <select
                        id={`cond-val-${row.id}`}
                        value={row.thresholdRegime}
                        onChange={(e) =>
                          setDraftConditions((prev) =>
                            prev.map((c) =>
                              c.id === row.id
                                ? {
                                    ...c,
                                    thresholdRegime: e.target.value as Phase2RegimeLabel,
                                  }
                                : c,
                            ),
                          )
                        }
                        className="w-full rounded border border-slate-700 bg-[#111A2E] px-2.5 py-1.5 text-xs text-slate-100 cursor-pointer"
                      >
                        {VALID_REGIME_LABELS.map((lbl) => (
                          <option key={lbl} value={lbl}>
                            {lbl}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`cond-val-${row.id}`}
                        type="number"
                        step={def.step ?? 'any'}
                        min={def.min}
                        max={def.max}
                        value={row.thresholdInput}
                        onChange={(e) =>
                          setDraftConditions((prev) =>
                            prev.map((c) =>
                              c.id === row.id ? { ...c, thresholdInput: e.target.value } : c,
                            ),
                          )
                        }
                        placeholder="Enter threshold"
                        className="w-full rounded border border-slate-700 bg-[#111A2E] px-3 py-1.5 font-mono text-xs text-slate-100 tabular-nums placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                      />
                    )}
                  </div>

                  <div>
                    {draftConditions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveConditionRow(row.id)}
                        aria-label={`Remove condition ${idx + 1}`}
                        className="rounded border border-slate-700 px-2.5 py-1.5 text-xs text-slate-400 hover:text-rose-300 cursor-pointer"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {formErrors.length > 0 && (
            <div
              role="alert"
              className="rounded border border-rose-500/35 bg-rose-950/20 px-3 py-2 text-xs text-rose-200 space-y-1"
            >
              {formErrors.map((err) => (
                <div key={err} className="flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                  <span>{err}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={handleAddConditionRow}
              disabled={draftConditions.length >= 4}
              className="inline-flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Condition ({draftConditions.length}/4)</span>
            </button>

            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded border border-sky-500/45 bg-sky-950/40 px-4 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-900/50 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Guardrail Rule</span>
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
