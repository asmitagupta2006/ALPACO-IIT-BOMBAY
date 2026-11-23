import { AlertCircle, ArrowRight } from 'lucide-react';
import type {
  GuardrailAlert,
  GuardrailEvaluationResult,
  GuardrailRule,
} from '../../contracts/guardrails';
import type { SentinelOverviewResponse } from '../../contracts/sentinel';
import { formatPrice, formatTimestamp } from '../../utils/format';
import {
  formatDataModeLabel,
  regimeBadgeClass,
  regimeHexColor,
} from './uiHelpers';

export type NavSectionId =
  | 'overview'
  | 'monitor'
  | 'regime'
  | 'guardrails'
  | 'audit'
  | 'specs'
  | 'system';

export interface SentinelErrorInfo {
  message: string;
  code: string;
  timestamp: string;
}

interface OverviewDashboardProps {
  overview: SentinelOverviewResponse | null;
  isLoading: boolean;
  error: SentinelErrorInfo | null;
  onRetry: () => void;
  onNavigate: (section: NavSectionId) => void;
  onSelectSymbolResolution: (symbol: string, resolution: '5m' | '15m' | '1h') => void;
  guardrailRules: GuardrailRule[];
  guardrailAlerts: GuardrailAlert[];
  guardrailEvaluation: GuardrailEvaluationResult;
}

export function OverviewDashboard({
  overview,
  isLoading,
  error,
  onRetry,
  onNavigate,
  onSelectSymbolResolution,
  guardrailRules,
  guardrailAlerts,
  guardrailEvaluation,
}: OverviewDashboardProps) {
  if (isLoading && !overview) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg border border-slate-800 bg-[#111A2E]" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-lg border border-slate-800 bg-[#111A2E]" />
      </div>
    );
  }

  if (error) {
    return (
      <section className="rounded-lg border border-rose-500/40 bg-rose-950/20 p-5 text-xs text-rose-200 space-y-2">
        <div className="flex items-start gap-2.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <div className="space-y-1.5">
            <p className="font-medium text-rose-100">
              Live Delta Exchange India data unavailable
            </p>
            <p className="text-rose-200/95 break-words">{error.message}</p>
            <div className="font-mono text-[11px] text-rose-300/85 tabular-nums">
              Reason: {error.code} · Timestamp: {formatTimestamp(error.timestamp)}
            </div>
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 rounded border border-rose-500/45 px-3 py-1.5 text-xs font-medium text-rose-100 hover:bg-rose-900/40 cursor-pointer"
            >
              Retry Live Delta Request
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (!overview) return null;

  const { regime, dataQuality, heatmap } = overview;
  const modeBadge = formatDataModeLabel(overview.dataMode);
  const findInput = (id: string) => regime.inputs.find((item) => item.id === id) ?? null;
  const shortVolInput = findInput('shortVol');
  const volZInput = findInput('volZScore');
  const trendInput = findInput('trendStrength');
  const cusumInput = findInput('cusumMax');

  const trailingClassified = regime.series.filter((pt) => pt.regime !== null).slice(-72);
  const enabledRulesCount = guardrailRules.filter((r) => r.enabled).length;
  const pendingAlertsCount = guardrailAlerts.filter((a) => a.status === 'pending').length;

  return (
    <div className="space-y-5">
      {/* Top KPI Strip (100% Real Delta Exchange India Measurements) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Detected Market Regime</span>
            <span className="font-mono text-[11px]">
              {overview.selectedSymbol} · {overview.resolution}
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span
              className={`inline-block rounded border px-2 py-0.5 text-xs font-semibold ${regimeBadgeClass(
                regime.sufficientData ? regime.currentRegime : null,
              )}`}
            >
              {regime.sufficientData && regime.currentRegime
                ? regime.currentRegime
                : 'Insufficient data'}
            </span>
            <span className="font-mono text-sm font-semibold text-slate-100 tabular-nums">
              {regime.sufficientData && regime.score !== null
                ? `${regime.score.toFixed(1)}/100`
                : '—'}
            </span>
          </div>
          <div className="mt-2 text-[11px] text-slate-400 font-mono tabular-nums truncate">
            {regime.candleCountUsed} Delta bars · last {formatTimestamp(regime.lastCandleIso)}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Realized Vol &amp; Z-Score</span>
            <span className="font-mono text-[11px]">
              {regime.parameters.shortVolWindow}/{regime.parameters.baselineVolWindow}-bar
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-mono text-xl font-semibold text-slate-100 tabular-nums">
              {shortVolInput?.available ? shortVolInput.formattedValue : '—'}
            </span>
            <span className="font-mono text-xs text-sky-300 tabular-nums">
              {volZInput?.available ? volZInput.formattedValue : '—'}
            </span>
          </div>
          <div className="mt-2 text-[11px] text-slate-400 font-mono tabular-nums truncate">
            Trend {trendInput?.available ? trendInput.formattedValue : '—'} · CUSUM{' '}
            {cusumInput?.available ? cusumInput.formattedValue : '—'}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Delta Feed Integrity</span>
            <span className="font-mono text-[11px] tabular-nums">
              {dataQuality.qualityScore}/100
            </span>
          </div>
          <div className="mt-2">
            <span
              className={`inline-block rounded border px-2 py-0.5 text-[11px] font-medium ${modeBadge.toneClass}`}
            >
              {modeBadge.label}
            </span>
          </div>
          <div className="mt-2 text-[11px] text-slate-400 font-mono tabular-nums">
            {dataQuality.validBars} valid bars · {dataQuality.missingBarsDetected} gaps ·{' '}
            {formatTimestamp(overview.generatedAt)}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>User Guardrail Rules</span>
            <span className="font-mono text-[11px] tabular-nums">
              {pendingAlertsCount} pending
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="font-mono text-xl font-semibold text-slate-100 tabular-nums">
              {enabledRulesCount} active
            </span>
            <span className="text-xs text-slate-400 font-mono tabular-nums">
              {guardrailRules.length} configured
            </span>
          </div>
          <div className="mt-2 text-[11px] text-slate-400 truncate">
            {guardrailEvaluation.available
              ? guardrailEvaluation.firedRules.length > 0
                ? `Active alert: ${guardrailEvaluation.action}`
                : 'No user rule thresholds breached'
              : guardrailEvaluation.unavailableReason || 'Waiting for regime evaluation'}
          </div>
        </div>
      </div>

      {/* Main Split: Multi-Contract Regime Matrix + Deterministic Causal Inputs */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5">
          <div className="flex items-start justify-between gap-3 border-b border-slate-800/80 pb-3">
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-100">
                Multi-Contract Delta Regime Matrix
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Live BTCUSD &amp; ETHUSD perpetual classifications computed strictly from real Delta candles
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('regime')}
              className="inline-flex items-center gap-1 text-xs font-medium text-sky-400 hover:text-sky-300 cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>Full Regime Engine</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {heatmap.map((cell) => (
              <button
                key={`${cell.symbol}-${cell.resolution}`}
                type="button"
                onClick={() =>
                  onSelectSymbolResolution(
                    cell.symbol,
                    cell.resolution as '5m' | '15m' | '1h',
                  )
                }
                className="rounded-md border border-slate-800 bg-[#0B1120] p-3 text-left transition-colors hover:border-sky-500/50 cursor-pointer"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono font-semibold text-slate-100">
                    {cell.symbol} · {cell.resolution}
                  </span>
                  <span className="font-mono text-[11px] text-slate-300 tabular-nums">
                    {cell.lastClose !== null ? formatPrice(cell.lastClose) : '—'}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span
                    className={`rounded border px-2 py-0.5 text-[11px] font-medium ${regimeBadgeClass(
                      cell.currentRegime,
                    )}`}
                  >
                    {cell.sufficientData && cell.currentRegime
                      ? cell.currentRegime
                      : 'Insufficient data'}
                  </span>
                  <span className="font-mono text-[11px] text-slate-300 tabular-nums">
                    {cell.riskScore !== null ? `${cell.riskScore.toFixed(1)}/100` : '—'}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-slate-400 tabular-nums">
                  <span>
                    VolZ {cell.volZScore !== null ? `${cell.volZScore.toFixed(2)}σ` : '—'}
                  </span>
                  <span>
                    ShortVol {cell.shortVolPct !== null ? `${cell.shortVolPct.toFixed(3)}%` : '—'}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <h2 className="font-display text-sm font-semibold text-slate-100">
              Regime Risk Score Inputs ({overview.selectedSymbol})
            </h2>
            <span className="font-mono text-[11px] text-slate-400">
              {regime.transitions.length} shifts
            </span>
          </div>

          {!regime.sufficientData ? (
            <p className="text-xs text-amber-300">{regime.insufficientReason}</p>
          ) : (
            <div className="space-y-2">
              {regime.inputs.map((inp) => (
                <div
                  key={inp.id}
                  className="flex items-center justify-between gap-3 rounded border border-slate-800/80 bg-[#0B1120] px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="text-slate-200 truncate">{inp.label}</div>
                    {inp.reasonIfExcluded && (
                      <div className="text-[10px] text-slate-500 truncate">
                        {inp.reasonIfExcluded}
                      </div>
                    )}
                  </div>
                  <div className="text-right font-mono tabular-nums shrink-0">
                    <div
                      className={
                        inp.available ? 'text-slate-100 font-semibold' : 'text-slate-500'
                      }
                    >
                      {inp.formattedValue}
                    </div>
                    {inp.weight > 0 && (
                      <div className="text-[10px] text-slate-400">
                        wt {(inp.weight * 100).toFixed(1)}%
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {trailingClassified.length > 0 && (
            <div className="border-t border-slate-800/80 pt-3">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span>Trailing {trailingClassified.length}-Bar Regime Sequence</span>
                <span className="font-mono text-[11px]">{overview.resolution}</span>
              </div>
              <div className="flex h-4 w-full overflow-hidden rounded border border-slate-800 bg-[#0B1120]">
                {trailingClassified.map((pt) => (
                  <div
                    key={pt.time}
                    title={`${new Date(pt.time * 1000).toISOString().slice(11, 16)} UTC — ${pt.regime} (score ${pt.riskScore?.toFixed(1) ?? '—'})`}
                    className="flex-1 h-full"
                    style={{ backgroundColor: regimeHexColor(pt.regime), opacity: 0.85 }}
                  />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Navigation Shortcuts to Active Real Workflows */}
      <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5">
        <h2 className="font-display text-sm font-semibold text-slate-100 border-b border-slate-800/80 pb-3">
          Workspace Workflows
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <button
            type="button"
            onClick={() => onNavigate('monitor')}
            className="flex items-center justify-between rounded-md border border-slate-800 bg-[#0B1120] px-3.5 py-2.5 text-left text-xs hover:border-sky-500/40 cursor-pointer"
          >
            <div>
              <div className="font-medium text-slate-100">Live Market Monitor</div>
              <div className="text-[11px] text-slate-400">Candles, ticker &amp; WS stream</div>
            </div>
            <ArrowRight className="h-4 w-4 text-slate-400 shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => onNavigate('regime')}
            className="flex items-center justify-between rounded-md border border-slate-800 bg-[#0B1120] px-3.5 py-2.5 text-left text-xs hover:border-sky-500/40 cursor-pointer"
          >
            <div>
              <div className="font-medium text-slate-100">Regime Detection Engine</div>
              <div className="text-[11px] text-slate-400">Vol Z-score, EMA slope &amp; CUSUM</div>
            </div>
            <ArrowRight className="h-4 w-4 text-slate-400 shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => onNavigate('guardrails')}
            className="flex items-center justify-between rounded-md border border-slate-800 bg-[#0B1120] px-3.5 py-2.5 text-left text-xs hover:border-sky-500/40 cursor-pointer"
          >
            <div>
              <div className="font-medium text-slate-100">Guardrails &amp; Decision Log</div>
              <div className="text-[11px] text-slate-400">User rules &amp; Firestore audit</div>
            </div>
            <ArrowRight className="h-4 w-4 text-slate-400 shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => onNavigate('system')}
            className="flex items-center justify-between rounded-md border border-slate-800 bg-[#0B1120] px-3.5 py-2.5 text-left text-xs hover:border-sky-500/40 cursor-pointer"
          >
            <div>
              <div className="font-medium text-slate-100">System &amp; API Health</div>
              <div className="text-[11px] text-slate-400">Delta REST/WS &amp; dataset audit</div>
            </div>
            <ArrowRight className="h-4 w-4 text-slate-400 shrink-0" />
          </button>
        </div>
      </section>
    </div>
  );
}
