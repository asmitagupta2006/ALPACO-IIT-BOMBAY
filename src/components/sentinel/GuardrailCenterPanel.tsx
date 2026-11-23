import { useEffect, useState } from 'react';
import { AlertOctagon, CheckCircle2, Save, ShieldAlert } from 'lucide-react';
import type { GuardrailConfig, SentinelOverviewResponse } from '../../contracts/sentinel';
import { actionToneClass, severityToneClass } from './uiHelpers';

interface GuardrailCenterPanelProps {
  overview: SentinelOverviewResponse | null;
  onSaveGuardrail: (config: GuardrailConfig) => Promise<void>;
  onKillSwitch: (reason: string) => Promise<void>;
  onResumeStrategies: () => Promise<void>;
}

export function GuardrailCenterPanel({
  overview,
  onSaveGuardrail,
  onKillSwitch,
  onResumeStrategies,
}: GuardrailCenterPanelProps) {
  const [selectedId, setSelectedId] = useState<string>('strat-btc-momentum');
  const [draft, setDraft] = useState<GuardrailConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [killModalOpen, setKillModalOpen] = useState(false);
  const [killReason, setKillReason] = useState('Operator emergency volatility risk halt');
  const [killConfirmed, setKillConfirmed] = useState(false);

  const selectedSnap =
    overview?.strategies.find((s) => s.strategy.id === selectedId) ??
    overview?.strategies[0] ??
    null;

  useEffect(() => {
    if (selectedSnap) {
      setDraft(selectedSnap.guardrail);
    }
  }, [selectedSnap?.guardrail.strategyId, selectedSnap?.guardrail.updatedAt]);

  if (!overview || !selectedSnap || !draft) {
    return (
      <div className="rounded-lg border border-slate-800 bg-[#111A2E] p-6 text-xs text-slate-400">
        Loading Risk Guardrail Center...
      </div>
    );
  }

  const anyKilled = overview.strategies.some((s) => s.guardrail.status === 'killed');
  const allBreaches = overview.strategies.flatMap((s) =>
    s.decision.breaches.map((b) => ({
      strategyName: s.strategy.name,
      symbol: s.strategy.symbol,
      action: s.decision.action,
      ...b,
    })),
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMessage(null);
    try {
      await onSaveGuardrail(draft);
      setSaveMessage('Guardrail thresholds saved & recorded in immutable audit log.');
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : 'Failed to update guardrails');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Emergency Control Banner */}
      <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-sm font-semibold text-slate-100">
            Execution Safety Gate &amp; Global Kill Switch
          </h2>
          <p className="text-xs text-slate-400">
            Default mode: <span className="font-mono text-slate-200">Paper Trading</span>. Regime Sentinel never executes live trades autonomously; explicit human confirmation is required for live actions or halts.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {anyKilled ? (
            <button
              type="button"
              onClick={() => void onResumeStrategies()}
              className="inline-flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-950/40 px-4 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-900/50 cursor-pointer"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>Human Sign-Off: Resume Paper Monitoring</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setKillConfirmed(false);
                setKillModalOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-md border border-rose-500/50 bg-rose-950/40 px-4 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-900/50 cursor-pointer"
            >
              <AlertOctagon className="h-4 w-4" />
              <span>Trigger Kill Switch</span>
            </button>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {/* Threshold Configuration Form */}
        <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
            <h2 className="font-display text-sm font-semibold text-slate-100">
              Configurable Strategy Risk Limits
            </h2>
            <select
              aria-label="Select strategy guardrail profile"
              value={selectedSnap.strategy.id}
              onChange={(e) => setSelectedId(e.target.value)}
              className="rounded border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-100 cursor-pointer"
            >
              {overview.strategies.map((s) => (
                <option key={s.strategy.id} value={s.strategy.id}>
                  {s.strategy.name} ({s.strategy.symbol})
                </option>
              ))}
            </select>
          </div>

          <form onSubmit={handleSave} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <NumberInput
                label="Max Daily Loss (%)"
                value={draft.maxDailyLossPct}
                step={0.5}
                min={0.5}
                max={25}
                onChange={(v) => setDraft({ ...draft, maxDailyLossPct: v })}
              />
              <NumberInput
                label="Max Strategy Drawdown (%)"
                value={draft.maxDrawdownPct}
                step={0.5}
                min={1}
                max={40}
                onChange={(v) => setDraft({ ...draft, maxDrawdownPct: v })}
              />
              <NumberInput
                label="Max Position Exposure ($)"
                value={draft.maxExposureUsd}
                step={5000}
                min={1000}
                max={1000000}
                onChange={(v) => setDraft({ ...draft, maxExposureUsd: v })}
              />
              <NumberInput
                label="Max Leverage (x)"
                value={draft.maxLeverage}
                step={0.5}
                min={1}
                max={25}
                onChange={(v) => setDraft({ ...draft, maxLeverage: v })}
              />
              <NumberInput
                label="Max Execution Slippage (bps)"
                value={draft.maxSlippageBps}
                step={0.5}
                min={1}
                max={100}
                onChange={(v) => setDraft({ ...draft, maxSlippageBps: v })}
              />
              <NumberInput
                label="Max Consecutive Losses"
                value={draft.maxConsecutiveLosses}
                step={1}
                min={1}
                max={20}
                onChange={(v) => setDraft({ ...draft, maxConsecutiveLosses: Math.round(v) })}
              />
              <NumberInput
                label="Max Permitted Risk Prob (%)"
                value={draft.maxRiskProbPct}
                step={1}
                min={20}
                max={95}
                onChange={(v) => setDraft({ ...draft, maxRiskProbPct: v })}
              />
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Execution Mode (Paper Default)
                </label>
                <select
                  aria-label="Execution Mode"
                  value={draft.tradingMode}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      tradingMode: e.target.value === 'live_gated' ? 'live_gated' : 'paper',
                    })
                  }
                  className="w-full rounded border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs text-slate-100"
                >
                  <option value="paper">Paper Trading (Safe Default)</option>
                  <option value="live_gated">Live Gated (Human Approval Required)</option>
                </select>
              </div>
            </div>

            {saveMessage && (
              <p className="text-xs text-sky-300">{saveMessage}</p>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-slate-800/70">
              <span className="text-[11px] text-slate-400">
                Status: <strong className="text-slate-200 uppercase">{draft.status}</strong>
              </span>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-md border border-sky-500/40 bg-sky-950/35 px-4 py-2 text-xs font-medium text-sky-200 hover:bg-sky-900/45 cursor-pointer disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                <span>{saving ? 'Saving...' : 'Save Guardrail Limits'}</span>
              </button>
            </div>
          </form>
        </section>

        {/* Active Breach Detection & Model 3 Rule Evaluation */}
        <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <h2 className="font-display text-sm font-semibold text-slate-100">
              Active Threshold Breaches &amp; Rule Alerts
            </h2>
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {allBreaches.length} active
            </span>
          </div>

          {allBreaches.length === 0 ? (
            <div className="rounded-md border border-emerald-500/25 bg-emerald-950/15 p-4 text-xs text-emerald-200">
              All monitored strategies are currently within configured hard guardrail limits.
              Adjust thresholds on the left (e.g., tighten Max Leverage or Max Drawdown) to test real-time breach detection.
            </div>
          ) : (
            <div className="space-y-2.5">
              {allBreaches.map((b, idx) => (
                <div
                  key={`${b.strategyName}-${b.rule}-${idx}`}
                  className="rounded-md border border-slate-800 bg-[#0B1120] p-3 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-100">
                      {b.strategyName} · {b.rule}
                    </span>
                    <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${severityToneClass(b.severity)}`}>
                      {b.severity}
                    </span>
                  </div>
                  <p className="text-slate-300">{b.explanation}</p>
                  <div className="flex items-center justify-between pt-1 font-mono text-[11px] text-slate-400">
                    <span>
                      Current {b.currentValue} vs Limit {b.thresholdValue}
                    </span>
                    <span className={`rounded border px-1.5 py-0.5 font-sans ${actionToneClass(b.action)}`}>
                      {b.action}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Human Confirmation Kill-Switch Dialog */}
      {killModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm Emergency Kill Switch"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
        >
          <div className="w-full max-w-md rounded-lg border border-rose-500/40 bg-[#111A2E] p-5 space-y-4">
            <div className="flex items-center gap-2.5 text-rose-300">
              <ShieldAlert className="h-5 w-5" />
              <h3 className="font-display text-base font-semibold">
                Confirm Emergency Kill Switch
              </h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Activating the global kill switch sets every monitored strategy status to{' '}
              <span className="font-mono text-rose-300">KILLED</span>, zeros active exposure,
              and writes a signed audit entry requiring human sign-off to resume.
            </p>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">
                Operator Reason (Audited)
              </label>
              <input
                type="text"
                value={killReason}
                onChange={(e) => setKillReason(e.target.value)}
                className="w-full rounded border border-slate-700 bg-[#0B1120] px-3 py-2 text-xs text-slate-100"
              />
            </div>
            <label className="flex items-start gap-2 text-xs text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={killConfirmed}
                onChange={(e) => setKillConfirmed(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                I explicitly confirm halting all monitored strategies and logging this action.
              </span>
            </label>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setKillModalOpen(false)}
                className="rounded border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!killConfirmed}
                onClick={async () => {
                  await onKillSwitch(killReason);
                  setKillModalOpen(false);
                }}
                className="rounded border border-rose-500/50 bg-rose-900/50 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-800/60 disabled:opacity-40 cursor-pointer"
              >
                Confirm Kill Switch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NumberInput({
  label,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onChange: (val: number) => void;
}) {
  return (
    <div>
      <label className="block text-[11px] text-slate-400 mb-1">{label}</label>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded border border-slate-700 bg-[#0B1120] px-3 py-1.5 font-mono text-xs text-slate-100 tabular-nums focus:border-sky-500 focus:outline-none"
      />
    </div>
  );
}
