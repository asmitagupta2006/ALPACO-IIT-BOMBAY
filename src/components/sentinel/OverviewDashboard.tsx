import { AlertTriangle, ArrowRight, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { SentinelOverviewResponse } from '../../contracts/sentinel';
import { formatTimestamp } from '../../utils/format';
import {
  actionToneClass,
  formatDataModeLabel,
  healthBarColor,
  healthToneClass,
  regimeBadgeClass,
  regimeHexColor,
  severityToneClass,
} from './uiHelpers';

export type NavSectionId =
  | 'overview'
  | 'monitor'
  | 'regime'
  | 'health'
  | 'risk'
  | 'guardrails'
  | 'explain'
  | 'paper'
  | 'training'
  | 'audit'
  | 'specs'
  | 'system'
  | 'deck';

interface OverviewDashboardProps {
  overview: SentinelOverviewResponse | null;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onNavigate: (section: NavSectionId) => void;
  onSelectStrategyForExplain: (strategyId: string) => void;
}

export function OverviewDashboard({
  overview,
  isLoading,
  error,
  onRetry,
  onNavigate,
  onSelectStrategyForExplain,
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

  if (error && !overview) {
    return (
      <section className="rounded-lg border border-rose-500/35 bg-rose-950/20 p-5 text-xs text-rose-200">
        <p className="font-medium text-rose-100">Unable to load Regime Sentinel overview</p>
        <p className="mt-1 text-rose-300/90">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded border border-rose-500/40 px-3 py-1.5 text-xs font-medium text-rose-100 hover:bg-rose-900/40 cursor-pointer"
        >
          Retry Analysis
        </button>
      </section>
    );
  }

  if (!overview) return null;

  const modeBadge = formatDataModeLabel(overview.dataMode);
  const avgHealth =
    overview.strategies.length > 0
      ? Math.round(
          overview.strategies.reduce((s, x) => s + x.health.totalScore, 0) /
            overview.strategies.length,
        )
      : 0;
  const maxRisk30 = Math.max(...overview.strategies.map((s) => s.riskPrediction.probability30m), 0);
  const totalBreaches = overview.strategies.reduce((s, x) => s + x.decision.breaches.length, 0);
  const anyKilled = overview.strategies.some((s) => s.guardrail.status === 'killed');

  return (
    <div className="space-y-5">
      {/* Top KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Detected Market Regime</span>
            <span className="font-mono text-[11px]">{overview.selectedSymbol} · {overview.resolution}</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span
              className={`inline-block rounded border px-2 py-0.5 text-xs font-semibold ${regimeBadgeClass(overview.regime.regime)}`}
            >
              {overview.regime.regime}
            </span>
            <span className="font-mono text-sm font-semibold text-slate-100 tabular-nums">
              {Math.round(overview.regime.confidence * 100)}% conf
            </span>
          </div>
          <div className="mt-2 text-[11px] text-slate-400 truncate">
            {overview.regime.modelAlgorithm} · {overview.regime.modelVersion}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Portfolio Mean Health</span>
            <span className="font-mono text-[11px]">0–100 scale</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className={`font-mono text-2xl font-semibold tabular-nums ${healthToneClass(avgHealth)}`}>
              {avgHealth} / 100
            </span>
            <span className="text-xs text-slate-400">
              {overview.strategies.length} monitored
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full ${healthBarColor(avgHealth)}`}
              style={{ width: `${avgHealth}%` }}
            />
          </div>
        </div>

        <div className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Peak 30m Risk Probability</span>
            <span className="font-mono text-[11px]">Model 2</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span
              className={`font-mono text-2xl font-semibold tabular-nums ${
                maxRisk30 >= 0.65
                  ? 'text-rose-400'
                  : maxRisk30 >= 0.42
                    ? 'text-amber-300'
                    : 'text-emerald-300'
              }`}
            >
              {(maxRisk30 * 100).toFixed(1)}%
            </span>
            <span className="text-xs text-slate-400">
              {totalBreaches} guardrail breach{totalBreaches === 1 ? '' : 'es'}
            </span>
          </div>
          <div className="mt-2 text-[11px] text-slate-400">
            {anyKilled
              ? 'Global Kill Switch ACTIVE'
              : 'Human approval gated for live actions'}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Data Quality & Provenance</span>
            <span className="font-mono text-[11px] tabular-nums">
              {overview.dataQuality.qualityScore}/100
            </span>
          </div>
          <div className="mt-2">
            <span className={`inline-block rounded border px-2 py-0.5 text-[11px] font-medium ${modeBadge.toneClass}`}>
              {modeBadge.label}
            </span>
          </div>
          <div className="mt-2 text-[11px] text-slate-400 font-mono tabular-nums">
            {overview.dataQuality.validBars} clean bars · updated {formatTimestamp(overview.generatedAt)}
          </div>
        </div>
      </div>

      {/* Main Split: Monitored Strategies Table + Regime Probability & Transition Snapshot */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5">
          <div className="flex items-start justify-between gap-3 border-b border-slate-800/80 pb-3">
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-100">
                Monitored Algorithmic Strategies
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Live Delta Exchange market regimes paired with paper-monitored strategy telemetry
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('health')}
              className="inline-flex items-center gap-1 text-xs font-medium text-sky-400 hover:text-sky-300 cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>Health Breakdown</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800/80 text-[11px] text-slate-400">
                  <th className="py-2 pr-2.5 font-medium">Strategy</th>
                  <th className="py-2 px-2.5 font-medium">Pair / Regime</th>
                  <th className="py-2 px-2.5 font-medium text-right">Health</th>
                  <th className="py-2 px-2.5 font-medium text-right whitespace-nowrap">30m Risk</th>
                  <th className="py-2 px-2.5 font-medium">Recommendation</th>
                  <th className="py-2 pl-2.5 font-medium text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {overview.strategies.map((snap) => (
                  <tr key={snap.strategy.id} className="hover:bg-slate-900/40">
                    <td className="py-3 pr-2.5">
                      <div className="font-medium text-slate-100 whitespace-nowrap">{snap.strategy.name}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-slate-400 tabular-nums whitespace-nowrap">
                        {snap.strategy.leverage}x · ${snap.strategy.exposureUsd.toLocaleString()} ·{' '}
                        {snap.strategy.tradingMode === 'paper' ? 'Paper' : 'Live-Gated'}
                      </div>
                    </td>
                    <td className="py-3 px-2.5 whitespace-nowrap">
                      <div className="font-mono text-slate-200">{snap.strategy.symbol}</div>
                      <div className="mt-0.5 text-[11px] text-slate-400">{snap.regime.regime}</div>
                    </td>
                    <td className="py-3 px-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                      <span className={`font-semibold ${healthToneClass(snap.health.totalScore)}`}>
                        {snap.health.totalScore}
                      </span>
                      <span className="text-slate-500">/100</span>
                    </td>
                    <td className="py-3 px-2.5 text-right font-mono tabular-nums text-slate-200 whitespace-nowrap">
                      {(snap.riskPrediction.probability30m * 100).toFixed(1)}%
                    </td>
                    <td className="py-3 px-2.5">
                      <span
                        className={`inline-block rounded border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${actionToneClass(snap.decision.action)}`}
                      >
                        {snap.decision.action}
                      </span>
                    </td>
                    <td className="py-3 pl-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          onSelectStrategyForExplain(snap.strategy.id);
                          onNavigate('explain');
                        }}
                        className="rounded border border-slate-700 bg-[#0B1120] px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-sky-500/50 hover:text-sky-300 cursor-pointer whitespace-nowrap"
                      >
                        Explain
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Regime Probabilities + Transition Timeline Strip */}
        <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <h2 className="font-display text-sm font-semibold text-slate-100">
              Regime Class Probabilities
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('regime')}
              className="text-xs font-medium text-sky-400 hover:text-sky-300 cursor-pointer"
            >
              Full Engine
            </button>
          </div>

          <div className="space-y-2.5">
            {Object.entries(overview.regime.probabilities)
              .sort((a, b) => b[1] - a[1])
              .map(([name, prob]) => (
                <div key={name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-200">{name}</span>
                    <span className="font-mono text-slate-300 tabular-nums">
                      {(prob * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[#0B1120]">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.max(2, prob * 100)}%`,
                        backgroundColor: regimeHexColor(name as SentinelOverviewResponse['regime']['regime']),
                      }}
                    />
                  </div>
                </div>
              ))}
          </div>

          <div className="border-t border-slate-800/80 pt-3">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span>72-Bar Regime Sequence ({overview.selectedSymbol})</span>
              <span className="font-mono text-[11px]">{overview.resolution}</span>
            </div>
            <div className="flex h-4 w-full overflow-hidden rounded border border-slate-800 bg-[#0B1120]">
              {overview.timeline.map((pt) => (
                <div
                  key={pt.time}
                  title={`${new Date(pt.time * 1000).toISOString().slice(11, 16)} UTC — ${pt.regime} (${Math.round(pt.confidence * 100)}%)`}
                  className="flex-1 h-full"
                  style={{ backgroundColor: regimeHexColor(pt.regime), opacity: 0.85 }}
                />
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Recent Transition Alerts + Quick Workflows */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <h2 className="font-display text-sm font-semibold text-slate-100">
              Recent Regime Transition & Safety Alerts
            </h2>
            <span className="font-mono text-[11px] text-slate-400 tabular-nums">
              {overview.recentAlerts.length} logged
            </span>
          </div>

          <div className="mt-3 space-y-2.5">
            {overview.recentAlerts.slice(0, 4).map((alert) => (
              <div
                key={alert.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-slate-800/80 bg-[#0B1120] p-3 text-xs"
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium ${severityToneClass(alert.severity)}`}
                    >
                      {alert.severity === 'Critical' ? (
                        <ShieldAlert className="h-3 w-3" />
                      ) : alert.severity === 'Warning' ? (
                        <AlertTriangle className="h-3 w-3" />
                      ) : (
                        <ShieldCheck className="h-3 w-3" />
                      )}
                      {alert.severity}
                    </span>
                    <span className="font-mono font-semibold text-slate-200">{alert.symbol}</span>
                    <span className="text-slate-300">
                      {alert.fromRegime} → {alert.toRegime}
                    </span>
                  </div>
                  <p className="text-slate-400">{alert.reason}</p>
                </div>
                <div className="text-right shrink-0">
                  <span
                    className={`inline-block rounded border px-2 py-0.5 text-[11px] font-medium ${actionToneClass(alert.recommendedAction)}`}
                  >
                    {alert.recommendedAction}
                  </span>
                  <div className="mt-1 font-mono text-[11px] text-slate-500 tabular-nums">
                    {formatTimestamp(alert.timestamp)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5 space-y-3">
          <h2 className="font-display text-sm font-semibold text-slate-100 border-b border-slate-800/80 pb-3">
            Platform Safety & Evaluation Modules
          </h2>
          <div className="grid grid-cols-1 gap-2.5">
            <button
              type="button"
              onClick={() => onNavigate('guardrails')}
              className="flex items-center justify-between rounded-md border border-slate-800 bg-[#0B1120] px-3.5 py-2.5 text-left text-xs hover:border-sky-500/40 cursor-pointer"
            >
              <div>
                <div className="font-medium text-slate-100">Risk Guardrail Center & Kill Switch</div>
                <div className="text-[11px] text-slate-400">
                  Configure hard limits and human-confirmed emergency halt
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-400 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => onNavigate('paper')}
              className="flex items-center justify-between rounded-md border border-slate-800 bg-[#0B1120] px-3.5 py-2.5 text-left text-xs hover:border-sky-500/40 cursor-pointer"
            >
              <div>
                <div className="font-medium text-slate-100">Paper Trading Regime Simulator</div>
                <div className="text-[11px] text-slate-400">
                  Stress-test strategies across simulated regime transitions
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-400 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => onNavigate('training')}
              className="flex items-center justify-between rounded-md border border-slate-800 bg-[#0B1120] px-3.5 py-2.5 text-left text-xs hover:border-sky-500/40 cursor-pointer"
            >
              <div>
                <div className="font-medium text-slate-100">AI Training & Walk-Forward Center</div>
                <div className="text-[11px] text-slate-400">
                  Train real GBDT / Random Forest models with 70/15/15 chronological validation
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-slate-400 shrink-0" />
            </button>

            <button
              type="button"
              onClick={() => onNavigate('deck')}
              className="flex items-center justify-between rounded-md border border-sky-500/30 bg-sky-950/20 px-3.5 py-2.5 text-left text-xs hover:border-sky-400/50 cursor-pointer"
            >
              <div>
                <div className="font-medium text-sky-200">Techfest 6-Slide Presentation View</div>
                <div className="text-[11px] text-sky-300/80">
                  Competition narrative backed by live measured & simulated telemetry
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-sky-300 shrink-0" />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
