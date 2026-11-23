import { AlertCircle, AlertTriangle, GitCommitHorizontal, RefreshCw } from 'lucide-react';
import type {
  AlertExplanationState,
  AlertExplanationSummary,
} from '../contracts/guardrails';
import type {
  Phase2RegimeLabel,
  Phase2RegimeResponse,
  RegimeTransitionMarker,
} from '../contracts/regime';
import { formatTimestamp } from '../utils/format';
import { ExplanationBox } from './ExplanationBox';

export interface RegimeChangeExplanationEntry {
  targetId: string;
  state: AlertExplanationState;
  explanation: AlertExplanationSummary | null;
  error: { message: string; timestamp: string } | null;
}

interface RegimeCardProps {
  symbol: string | null;
  regime: Phase2RegimeResponse | null;
  isLoading: boolean;
  error: { message: string; timestamp: string } | null;
  fetchedAt: string | null;
  onRetry: () => void;
  explainConfigured?: boolean;
  explainDisabledReason?: string | null;
  regimeChangeExplanation?: RegimeChangeExplanationEntry | null;
  onRetryRegimeExplain?: (transition: RegimeTransitionMarker) => void;
}

function regimeBadgeClasses(label: Phase2RegimeLabel): string {
  switch (label) {
    case 'Calm/Range':
      return 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300';
    case 'Trending':
      return 'border-sky-500/40 bg-sky-950/30 text-sky-300';
    case 'High-Volatility/Shock':
      return 'border-rose-500/45 bg-rose-950/35 text-rose-300';
  }
}

function scoreBarColor(score: number): string {
  if (score >= 65) return 'bg-rose-500';
  if (score >= 40) return 'bg-amber-400';
  return 'bg-emerald-500';
}

export function RegimeCard({
  symbol,
  regime,
  isLoading,
  error,
  fetchedAt,
  onRetry,
  explainConfigured = false,
  explainDisabledReason = null,
  regimeChangeExplanation = null,
  onRetryRegimeExplain,
}: RegimeCardProps) {
  if (!symbol) {
    return null;
  }

  const lastUpdatedIso = fetchedAt ?? regime?.computedAt ?? null;
  const latestTransition =
    regime && regime.sufficientData && regime.transitions.length > 0
      ? regime.transitions[regime.transitions.length - 1]
      : null;

  return (
    <section
      aria-label="Market Regime Detection Card"
      className="rounded-lg border border-slate-800/90 bg-[#111A2E]"
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="font-display text-sm font-semibold text-slate-100">
            Market Regime Detection
          </h2>
          <span className="rounded border border-slate-700 bg-[#0B1120] px-2 py-0.5 font-mono text-[11px] text-slate-300">
            {regime?.symbol ?? symbol} · {regime?.resolution ?? '—'}
          </span>
          {regime && !regime.sufficientData && (
            <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-950/30 px-2.5 py-0.5 font-mono text-xs font-medium text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Insufficient data</span>
            </span>
          )}
          {regime && regime.sufficientData && regime.currentRegime && (
            <span
              className={`rounded border px-2.5 py-0.5 font-mono text-xs font-semibold ${regimeBadgeClasses(
                regime.currentRegime,
              )}`}
            >
              {regime.currentRegime}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {regime && regime.sufficientData && regime.score !== null && (
            <div className="flex items-center gap-2.5">
              <span className="text-[11px] text-slate-400">Regime Risk Score</span>
              <span className="font-mono text-base font-semibold text-slate-100 tabular-nums">
                {regime.score.toFixed(1)}
                <span className="text-xs font-normal text-slate-400"> / 100</span>
              </span>
              <div className="hidden sm:block h-2 w-24 overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full transition-all duration-300 ${scoreBarColor(regime.score)}`}
                  style={{ width: `${Math.max(2, Math.min(100, regime.score))}%` }}
                />
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={onRetry}
            disabled={isLoading}
            title="Recompute regime metrics"
            aria-label="Recompute regime metrics"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-[#0B1120] px-2.5 py-1 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-slate-100 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="p-5 space-y-4">
        {isLoading && !regime && (
          <div className="space-y-2.5">
            <div className="h-4 w-64 animate-pulse rounded bg-slate-800" />
            <div className="h-28 animate-pulse rounded border border-slate-800/70 bg-[#0B1120]/70" />
          </div>
        )}

        {!isLoading && error && !regime && (
          <div className="rounded-md border border-rose-500/30 bg-rose-950/20 p-4 text-xs text-rose-200">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                <div className="space-y-1">
                  <p className="font-medium text-rose-100">Regime computation unavailable</p>
                  <p className="text-rose-300/90 break-words">{error.message}</p>
                  <p className="font-mono text-[11px] text-rose-400/80 tabular-nums">
                    At {formatTimestamp(error.timestamp)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onRetry}
                className="rounded border border-rose-500/40 px-3 py-1 text-xs font-medium text-rose-100 hover:bg-rose-900/40 cursor-pointer shrink-0"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {regime && !regime.sufficientData && (
          <div className="rounded-md border border-amber-500/35 bg-amber-950/20 p-4 text-xs text-amber-200 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-amber-100">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
              <span>Insufficient data</span>
            </div>
            <p className="text-amber-200/90 leading-relaxed">
              {regime.insufficientReason ||
                `Need at least ${regime.candlesRequired} candles; received ${regime.candleCountUsed}.`}
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-amber-300/85 tabular-nums">
              <span>
                Candles received: {regime.candleCountUsed} / {regime.candlesRequired} required
              </span>
              <span>Last candle: {formatTimestamp(regime.lastCandleIso)}</span>
              <span>Checked: {formatTimestamp(regime.computedAt)}</span>
            </div>
            <p className="text-[11px] text-amber-300/80">
              No regime label or score is emitted without sufficient causal history. Select a wider
              lookback window (e.g., 24H–7D) or finer candle timeframe (5m / 15m).
            </p>
          </div>
        )}

        {regime && regime.sufficientData && (
          <>
            {/* Ticker Warning / Timestamp Gaps Warning if present */}
            {(regime.tickerError || regime.timestampGaps.length > 0) && (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/30 bg-amber-950/15 px-3.5 py-2 text-[11px] text-amber-200">
                {regime.timestampGaps.length > 0 && (
                  <span>
                    Timestamp gaps detected: {regime.timestampGaps.length} gap(s) in raw Delta
                    candles (no synthetic bars fabricated).
                  </span>
                )}
                {regime.tickerError && (
                  <span>
                    Optional ticker snapshot unavailable ({regime.tickerError}); ticker inputs
                    excluded.
                  </span>
                )}
              </div>
            )}

            {/* Exact Inputs Table */}
            <div className="overflow-x-auto rounded-md border border-slate-800/80 bg-[#0B1120]">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800/80 text-[11px] font-medium text-slate-400">
                    <th className="px-3.5 py-2.5">Input Feature</th>
                    <th className="px-3.5 py-2.5">Value</th>
                    <th className="px-3.5 py-2.5">Unit</th>
                    <th className="px-3.5 py-2.5">Score Weight</th>
                    <th className="px-3.5 py-2.5">Formula / Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {regime.inputs.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-900/40">
                      <td className="px-3.5 py-2 font-medium text-slate-200 whitespace-nowrap">
                        {item.label}
                        {item.category === 'ticker_optional' && (
                          <span className="ml-1.5 text-[10px] font-normal text-slate-500">
                            (ticker)
                          </span>
                        )}
                      </td>
                      <td className="px-3.5 py-2 font-mono tabular-nums whitespace-nowrap">
                        {item.available ? (
                          <span className="text-slate-100 font-medium">{item.formattedValue}</span>
                        ) : (
                          <span className="text-amber-300/90">Excluded</span>
                        )}
                      </td>
                      <td className="px-3.5 py-2 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                        {item.unit}
                      </td>
                      <td className="px-3.5 py-2 font-mono text-[11px] text-slate-300 tabular-nums whitespace-nowrap">
                        {item.weight > 0 ? `${(item.weight * 100).toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-3.5 py-2 text-[11px] text-slate-400">
                        {item.available
                          ? item.formulaNote
                          : item.reasonIfExcluded || 'Absent from API response'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Parameters Disclosure */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-800/70 bg-[#0B1120]/70 px-3.5 py-2 font-mono text-[11px] text-slate-400 tabular-nums">
              <span>
                Windows: shortVol={regime.parameters.shortVolWindow} · baseline=
                {regime.parameters.baselineVolWindow} · EMA={regime.parameters.emaWindow}/
                {regime.parameters.emaSlopeLookback} · minBars=
                {regime.parameters.minCandlesRequired}
              </span>
              <span>
                Thresholds: volZ≥{regime.parameters.volZHighThreshold}σ · |trend|≥
                {regime.parameters.trendStrengthThreshold}σ · CUSUM k=
                {regime.parameters.cusumDriftK}σ / H={regime.parameters.cusumThresholdH}σ
              </span>
            </div>

            {/* Phase 4: Latest Regime Change Explanation */}
            {latestTransition && (
              <div className="space-y-2 rounded-md border border-slate-800/80 bg-[#0B1120] p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 font-medium text-slate-200">
                    <GitCommitHorizontal className="h-4 w-4 text-sky-400" aria-hidden="true" />
                    <span>
                      Latest Regime Change: {latestTransition.fromRegime} →{' '}
                      {latestTransition.toRegime}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                    At {formatTimestamp(new Date(latestTransition.time * 1000).toISOString())} · Score{' '}
                    {latestTransition.riskScore.toFixed(1)}
                  </span>
                </div>
                <ExplanationBox
                  title="Regime Change Explanation"
                  configured={explainConfigured}
                  disabledReason={explainDisabledReason}
                  state={regimeChangeExplanation?.state ?? 'idle'}
                  explanation={regimeChangeExplanation?.explanation ?? null}
                  error={regimeChangeExplanation?.error ?? null}
                  onRetry={
                    onRetryRegimeExplain
                      ? () => onRetryRegimeExplain(latestTransition)
                      : undefined
                  }
                />
              </div>
            )}
          </>
        )}

        {/* Provenance & Candle Count Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3 text-[11px] text-slate-400">
          <span className="font-mono tabular-nums">
            Source: Delta candles, last updated {formatTimestamp(lastUpdatedIso)}
          </span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono tabular-nums text-slate-400">
            <span>
              Candles used: {regime ? regime.candleCountUsed : '—'}
              {regime && regime.sufficientData
                ? ` (${regime.classifiedBarCount} classified · ${regime.transitions.length} shifts)`
                : ''}
            </span>
            <span>Last candle: {formatTimestamp(regime?.lastCandleIso)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
