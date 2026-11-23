import type { User } from 'firebase/auth';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  LogIn,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import type { AlertDecision, GuardrailAlert } from '../contracts/guardrails';
import { formatTimestamp } from '../utils/format';
import { ExplanationBox } from './ExplanationBox';

interface GuardrailAlertFeedProps {
  alerts: GuardrailAlert[];
  user: User | null;
  authLoading: boolean;
  authError: string | null;
  explainConfigured: boolean;
  explainDisabledReason: string | null;
  onSignIn: () => void;
  onDecide: (alertId: string, decision: AlertDecision) => void;
  onRetrySave: (alertId: string) => void;
  onRetryExplain: (alertId: string) => void;
}

function statusBadge(alert: GuardrailAlert): { label: string; className: string } {
  switch (alert.status) {
    case 'pending':
      return {
        label: 'Pending Decision',
        className: 'border-sky-500/40 bg-sky-950/35 text-sky-200',
      };
    case 'approved':
      return {
        label: 'Approved',
        className: 'border-emerald-500/40 bg-emerald-950/35 text-emerald-200',
      };
    case 'dismissed':
      return {
        label: 'Dismissed',
        className: 'border-slate-600 bg-slate-800/70 text-slate-200',
      };
    case 'superseded':
      return {
        label: 'Superseded',
        className: 'border-amber-500/35 bg-amber-950/25 text-amber-300',
      };
  }
}

export function GuardrailAlertFeed({
  alerts,
  user,
  authLoading,
  authError,
  explainConfigured,
  explainDisabledReason,
  onSignIn,
  onDecide,
  onRetrySave,
  onRetryExplain,
}: GuardrailAlertFeedProps) {
  const pendingCount = alerts.filter((a) => a.status === 'pending').length;

  return (
    <section
      aria-label="Guardrail Alert Feed and Operator Approval"
      className="rounded-lg border border-slate-800/90 bg-[#111A2E]"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="font-display text-sm font-semibold text-slate-100">
            Guardrail Alert Feed
          </h2>
          <span className="rounded border border-slate-700 bg-[#0B1120] px-2 py-0.5 font-mono text-[11px] text-slate-300 tabular-nums">
            {pendingCount} pending · {alerts.length} total
          </span>
        </div>
        <span className="text-[11px] text-slate-400">
          Human approval required · Records decision only (no order is sent)
        </span>
      </div>

      <div className="p-5 space-y-4">
        {/* Session-Only Warning Banner When Not Signed In */}
        {!authLoading && !user && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/35 bg-amber-950/20 px-4 py-3 text-xs text-amber-200">
            <div className="space-y-0.5">
              <div className="font-semibold text-amber-100">
                Not signed in — session-only decisions
              </div>
              <p className="text-amber-200/90">
                Alerts still appear and can be approved or dismissed for this session, but decisions
                will not be saved to Firestore until you sign in with Google.
              </p>
              {authError && (
                <p className="font-mono text-[11px] text-rose-300">{authError}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onSignIn}
              className="inline-flex items-center gap-1.5 rounded border border-amber-400/50 bg-amber-900/40 px-3 py-1.5 text-xs font-semibold text-amber-100 hover:bg-amber-800/50 cursor-pointer shrink-0"
            >
              <LogIn className="h-3.5 w-3.5" />
              <span>Sign in with Google</span>
            </button>
          </div>
        )}

        {/* Alert Cards */}
        {alerts.length === 0 ? (
          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-4 text-xs text-slate-400">
            No guardrail alerts triggered yet. Alerts are raised only when an enabled rule fires
            against live regime telemetry (with duplicate suppression and cooldown active).
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => {
              const badge = statusBadge(alert);
              const isPending = alert.status === 'pending';
              const isSaving = alert.firestoreState === 'saving';

              return (
                <article
                  key={alert.id}
                  className={`rounded-md border p-4 text-xs space-y-3 ${
                    alert.status === 'superseded'
                      ? 'border-slate-800/70 bg-[#0B1120]/60 opacity-80'
                      : 'border-slate-800 bg-[#0B1120]'
                  }`}
                >
                  {/* Top Row */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px] font-semibold ${
                          alert.action === 'PAUSE'
                            ? 'border-rose-500/50 bg-rose-950/40 text-rose-200'
                            : 'border-amber-500/45 bg-amber-950/35 text-amber-200'
                        }`}
                      >
                        <ShieldAlert className="h-3 w-3" />
                        <span>{alert.action}</span>
                      </span>
                      <span className="font-mono font-semibold text-slate-100">
                        {alert.symbol} · {alert.timeframe}
                      </span>
                      <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                        {alert.regime} ({alert.riskScore.toFixed(1)}/100)
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded border px-2 py-0.5 font-mono text-[10px] font-medium ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                      <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                        {formatTimestamp(alert.createdAt)}
                      </span>
                    </div>
                  </div>

                  {/* Fired Rules & Exact Comparisons */}
                  <div className="space-y-1">
                    <div className="text-[11px] font-medium text-slate-400">
                      Fired Rules ({alert.firedRules.length}):
                    </div>
                    <ul className="space-y-1">
                      {alert.thresholds.map((line, i) => (
                        <li
                          key={`${alert.id}-t-${i}`}
                          className="rounded border border-slate-800/80 bg-[#111A2E] px-2.5 py-1 font-mono text-[11px] text-slate-200"
                        >
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Observed Input Values */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-slate-400 tabular-nums">
                    <span>
                      Vol Z:{' '}
                      {alert.inputValues.volZScore !== null
                        ? `${alert.inputValues.volZScore.toFixed(2)}σ`
                        : 'Excluded'}
                    </span>
                    <span>
                      Trend:{' '}
                      {alert.inputValues.trendStrength !== null
                        ? `${alert.inputValues.trendStrength.toFixed(2)}σ`
                        : 'Excluded'}
                    </span>
                    <span>
                      CUSUM:{' '}
                      {alert.inputValues.cusumMax !== null
                        ? `${alert.inputValues.cusumMax.toFixed(2)}σ`
                        : 'Excluded'}
                    </span>
                    {alert.inputValues.fundingRate !== null && (
                      <span>Funding: {alert.inputValues.fundingRate.toFixed(4)}%</span>
                    )}
                    {alert.inputValues.impliedVolatility !== null && (
                      <span>IV: {alert.inputValues.impliedVolatility.toFixed(2)}%</span>
                    )}
                  </div>

                  {/* Phase 4: Gemini Explanation Box */}
                  <ExplanationBox
                    title="Guardrail Alert Explanation"
                    configured={explainConfigured}
                    disabledReason={explainDisabledReason}
                    state={alert.explanationState}
                    explanation={alert.explanation}
                    error={alert.explanationError}
                    onRetry={() => onRetryExplain(alert.id)}
                  />

                  {/* Decision Actions or Final State */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-2.5">
                    {isPending ? (
                      <>
                        <span className="text-[11px] text-slate-400">
                          Approve records your acknowledgement only — no order is sent.
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => onDecide(alert.id, 'approved')}
                            className="inline-flex items-center gap-1.5 rounded border border-emerald-500/45 bg-emerald-950/35 px-3 py-1 text-xs font-semibold text-emerald-200 hover:bg-emerald-900/45 cursor-pointer disabled:opacity-50"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>Approve</span>
                          </button>
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={() => onDecide(alert.id, 'dismissed')}
                            className="inline-flex items-center gap-1.5 rounded border border-slate-600 bg-slate-800/60 px-3 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700/70 cursor-pointer disabled:opacity-50"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            <span>Dismiss</span>
                          </button>
                        </div>
                      </>
                    ) : alert.status === 'superseded' ? (
                      <div className="flex items-center gap-1.5 text-[11px] text-amber-300/90">
                        <Clock className="h-3.5 w-3.5" />
                        <span>
                          Superseded by a newer evaluation — locked against duplicate decision.
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2 w-full">
                        <span className="font-mono text-[11px] text-slate-300 tabular-nums">
                          Decision: <strong className="uppercase">{alert.decision}</strong> at{' '}
                          {formatTimestamp(alert.decidedAt)} (locked)
                        </span>

                        {alert.firestoreState === 'saved' && (
                          <span className="font-mono text-[11px] text-emerald-300">
                            Saved to Firestore
                          </span>
                        )}
                        {alert.firestoreState === 'saving' && (
                          <span className="font-mono text-[11px] text-sky-300">
                            Saving to Firestore...
                          </span>
                        )}
                        {alert.firestoreState === 'not_saved' && (
                          <span className="font-mono text-[11px] text-amber-300">
                            Session only (not saved — sign in to persist)
                          </span>
                        )}
                        {alert.firestoreState === 'error' && (
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-rose-300">
                              <AlertCircle className="h-3.5 w-3.5" />
                              <span>Save failed: {alert.firestoreError}</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => onRetrySave(alert.id)}
                              className="inline-flex items-center gap-1 rounded border border-rose-500/45 px-2.5 py-0.5 text-[11px] font-medium text-rose-100 hover:bg-rose-900/40 cursor-pointer"
                            >
                              <RefreshCw className="h-3 w-3" />
                              <span>Retry</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
