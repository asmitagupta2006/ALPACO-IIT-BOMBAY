import { useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { AlertCircle, AlertTriangle, Database, LogIn, RefreshCw, Sparkles } from 'lucide-react';
import type { FirestoreDecisionRecord } from '../contracts/guardrails';
import { formatDateTimeUtc, formatTimestamp } from '../utils/format';

interface DecisionLogPanelProps {
  user: User | null;
  authLoading: boolean;
  onSignIn: () => void;
  records: FirestoreDecisionRecord[];
  loading: boolean;
  error: { message: string; timestamp: string } | null;
  lastUpdated: string | null;
  onRefresh: () => void;
}

export function DecisionLogPanel({
  user,
  authLoading,
  onSignIn,
  records,
  loading,
  error,
  lastUpdated,
  onRefresh,
}: DecisionLogPanelProps) {
  const [symbolFilter, setSymbolFilter] = useState<string>('ALL');
  const [decisionFilter, setDecisionFilter] = useState<'ALL' | 'approved' | 'dismissed'>('ALL');

  const availableSymbols = useMemo(
    () => Array.from(new Set(records.map((r) => r.symbol))).sort(),
    [records],
  );

  const filteredRecords = useMemo(() => {
    return records.filter((rec) => {
      if (symbolFilter !== 'ALL' && rec.symbol !== symbolFilter) return false;
      if (decisionFilter !== 'ALL' && rec.decision !== decisionFilter) return false;
      return true;
    });
  }, [records, symbolFilter, decisionFilter]);

  return (
    <section
      aria-label="Firestore Decision Log"
      className="rounded-lg border border-slate-800/90 bg-[#111A2E]"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <Database className="h-4 w-4 text-sky-400" aria-hidden="true" />
          <h2 className="font-display text-sm font-semibold text-slate-100">
            Decision Log
          </h2>
          {user && (
            <span className="rounded border border-slate-700 bg-[#0B1120] px-2 py-0.5 font-mono text-[11px] text-slate-300 tabular-nums">
              {filteredRecords.length} shown · {records.length} saved
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter decision log by symbol"
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value)}
            disabled={!user}
            className="rounded border border-slate-700 bg-[#0B1120] px-2.5 py-1 text-xs text-slate-100 disabled:opacity-50 cursor-pointer"
          >
            <option value="ALL">All Symbols</option>
            {availableSymbols.map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter decision log by decision"
            value={decisionFilter}
            onChange={(e) =>
              setDecisionFilter(e.target.value as 'ALL' | 'approved' | 'dismissed')
            }
            disabled={!user}
            className="rounded border border-slate-700 bg-[#0B1120] px-2.5 py-1 text-xs text-slate-100 disabled:opacity-50 cursor-pointer"
          >
            <option value="ALL">All Decisions</option>
            <option value="approved">Approved</option>
            <option value="dismissed">Dismissed</option>
          </select>

          <button
            type="button"
            onClick={onRefresh}
            disabled={!user || loading}
            aria-label="Refresh Firestore decision log"
            className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-[#0B1120] px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="p-5 space-y-4">
        {!authLoading && !user ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-800 bg-[#0B1120] p-4 text-xs text-slate-300">
            <div className="space-y-1">
              <p className="font-medium text-slate-100">
                Sign in with Google to save and view your Decision Log
              </p>
              <p className="text-slate-400">
                The dashboard remains open without login. Signing in stores decisions privately
                under your own Firestore user path (<code className="font-mono">users/{'{uid}'}/decisions</code>).
              </p>
            </div>
            <button
              type="button"
              onClick={onSignIn}
              className="inline-flex items-center gap-1.5 rounded border border-sky-500/45 bg-sky-950/35 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-900/45 cursor-pointer shrink-0"
            >
              <LogIn className="h-3.5 w-3.5" />
              <span>Sign in with Google</span>
            </button>
          </div>
        ) : error ? (
          <div className="rounded-md border border-rose-500/35 bg-rose-950/20 p-4 text-xs text-rose-200">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                <div className="space-y-1">
                  <p className="font-medium text-rose-100">Unable to load Firestore decision log</p>
                  <p className="text-rose-300/90 break-words">{error.message}</p>
                  <p className="font-mono text-[11px] text-rose-400/80 tabular-nums">
                    At {formatTimestamp(error.timestamp)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onRefresh}
                className="rounded border border-rose-500/40 px-3 py-1 text-xs font-medium text-rose-100 hover:bg-rose-900/40 cursor-pointer shrink-0"
              >
                Retry
              </button>
            </div>
          </div>
        ) : loading && records.length === 0 ? (
          <div className="h-24 animate-pulse rounded-md border border-slate-800 bg-[#0B1120]/70" />
        ) : records.length === 0 ? (
          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-5 text-center text-xs text-slate-400">
            No decisions logged yet
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-4 text-xs text-slate-400">
            No saved decisions match the current Symbol / Decision filters.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-slate-800/80 bg-[#0B1120]">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800/80 text-[11px] font-medium text-slate-400">
                  <th className="px-3.5 py-2.5">Time (UTC)</th>
                  <th className="px-3.5 py-2.5">Symbol · TF</th>
                  <th className="px-3.5 py-2.5">Action</th>
                  <th className="px-3.5 py-2.5">Rules Fired &amp; Thresholds</th>
                  <th className="px-3.5 py-2.5">Regime &amp; Input Values</th>
                  <th className="px-3.5 py-2.5 text-right">My Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredRecords.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-900/40 align-top">
                    <td className="px-3.5 py-2.5 font-mono text-[11px] text-slate-400 whitespace-nowrap tabular-nums">
                      {formatDateTimeUtc(rec.decidedAt ?? rec.createdAt)}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-slate-200 whitespace-nowrap">
                      {rec.symbol} · {rec.timeframe}
                    </td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap">
                      <span
                        className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${
                          rec.action === 'PAUSE'
                            ? 'border-rose-500/45 bg-rose-950/35 text-rose-200'
                            : rec.action === 'REDUCE SIZE'
                              ? 'border-amber-500/40 bg-amber-950/30 text-amber-200'
                              : 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                        }`}
                      >
                        {rec.action}
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5 space-y-1.5">
                      <div className="font-medium text-slate-200">
                        {rec.rulesFired.join(', ')}
                      </div>
                      <div className="font-mono text-[11px] text-slate-400">
                        {rec.thresholds.join(' | ')}
                      </div>
                      {rec.explanation && (
                        <div className="mt-1.5 rounded border border-slate-800 bg-[#111A2E]/90 p-2.5 text-[11px] space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-slate-300">
                            <span className="inline-flex items-center gap-1 font-medium text-sky-300">
                              <Sparkles className="h-3 w-3" aria-hidden="true" />
                              <span>Saved Explanation</span>
                              {rec.explanation.status === 'unverified' && (
                                <span className="inline-flex items-center gap-0.5 rounded border border-amber-500/45 bg-amber-950/35 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">
                                  <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />
                                  <span>Unverified</span>
                                </span>
                              )}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              AI-generated explanation. Decisions come from the rules, not the model.
                            </span>
                          </div>
                          <p className="text-slate-200 leading-relaxed">{rec.explanation.summary}</p>
                          {rec.explanation.whyItFired.length > 0 && (
                            <ul className="list-disc pl-4 space-y-0.5 text-slate-400">
                              {rec.explanation.whyItFired.map((pt, idx) => (
                                <li key={idx}>{pt}</li>
                              ))}
                            </ul>
                          )}
                          <div className="font-mono text-[10px] text-slate-400 tabular-nums">
                            Source: Gemini ({rec.explanation.model}), generated{' '}
                            {formatTimestamp(rec.explanation.generatedAt)}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-[11px] text-slate-300 tabular-nums">
                      <div>
                        {rec.regime} · Score {rec.riskScore.toFixed(1)}
                      </div>
                      <div className="text-slate-400">
                        VolZ{' '}
                        {rec.inputValues.volZScore !== null
                          ? `${rec.inputValues.volZScore.toFixed(2)}σ`
                          : '—'}{' '}
                        · Trend{' '}
                        {rec.inputValues.trendStrength !== null
                          ? `${rec.inputValues.trendStrength.toFixed(2)}σ`
                          : '—'}{' '}
                        · CUSUM{' '}
                        {rec.inputValues.cusumMax !== null
                          ? `${rec.inputValues.cusumMax.toFixed(2)}σ`
                          : '—'}
                      </div>
                    </td>
                    <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
                      <span
                        className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${
                          rec.decision === 'approved'
                            ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                            : 'border-slate-600 bg-slate-800/70 text-slate-200'
                        }`}
                      >
                        {rec.decision ?? 'pending'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Provenance Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3 text-[11px] text-slate-400">
          <span className="font-mono tabular-nums">
            Source: Firestore, last updated {formatTimestamp(lastUpdated)}
          </span>
          <span className="font-mono text-slate-500">
            {user ? `Scoped to uid:${user.uid.slice(0, 8)}…` : 'Optional Google Sign-In'}
          </span>
        </div>
      </div>
    </section>
  );
}
