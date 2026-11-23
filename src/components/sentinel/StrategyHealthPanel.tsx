import type { SentinelOverviewResponse } from '../../contracts/sentinel';
import {
  actionToneClass,
  healthBarColor,
  healthToneClass,
  regimeBadgeClass,
} from './uiHelpers';

interface StrategyHealthPanelProps {
  overview: SentinelOverviewResponse | null;
  onInspectExplanation: (strategyId: string) => void;
}

export function StrategyHealthPanel({
  overview,
  onInspectExplanation,
}: StrategyHealthPanelProps) {
  if (!overview) {
    return (
      <div className="rounded-lg border border-slate-800 bg-[#111A2E] p-6 text-xs text-slate-400">
        Loading Strategy Health Monitor...
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-100">
              Documented Strategy Health Scoring System (0–100)
            </h2>
            <p className="mt-1 font-mono text-[11px] text-slate-400">
              Formula: Health = clamp(0, 100, 100 - DD_Penalty(&le;30) - Streak_Penalty(&le;20) - Slippage_Penalty(&le;15) - VolLev_Penalty(&le;18) - Regime_Mismatch(0|8|20|22) + ProfitFactor_Adj([-8,+8]))
            </p>
          </div>
          <span className="rounded border border-amber-500/35 bg-amber-950/25 px-2.5 py-1 text-[11px] text-amber-200">
            Market Regime &amp; ATR: Live Measured · Strategy Execution Telemetry: Paper-Monitored
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {overview.strategies.map((snap) => {
            const { strategy: s, health: h, regime: r, decision: d } = snap;
            return (
              <article
                key={s.id}
                className="rounded-md border border-slate-800 bg-[#0B1120] p-4 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-display text-sm font-semibold text-slate-100">
                      {s.name}
                    </h3>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span className="font-mono text-slate-200">{s.symbol}</span>
                      <span aria-hidden="true">·</span>
                      <span>{s.archetype.replace('_', ' ')}</span>
                      <span aria-hidden="true">·</span>
                      <span className={`rounded border px-1.5 py-0.5 text-[11px] ${regimeBadgeClass(r.regime)}`}>
                        {r.regime}
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className={`font-mono text-2xl font-semibold tabular-nums ${healthToneClass(h.totalScore)}`}>
                      {h.totalScore}
                      <span className="text-xs text-slate-500"> / 100</span>
                    </div>
                    <div className="text-[11px] text-slate-400">{h.statusLabel}</div>
                  </div>
                </div>

                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full ${healthBarColor(h.totalScore)}`}
                    style={{ width: `${h.totalScore}%` }}
                  />
                </div>

                {/* Component Arithmetic Breakdown */}
                <div className="grid grid-cols-3 gap-2 border-t border-slate-800/70 pt-3 text-[11px] font-mono tabular-nums">
                  <div>
                    <span className="text-slate-400">Drawdown Pen</span>
                    <div className="text-rose-300">-{h.components.drawdownPenalty.toFixed(1)}</div>
                  </div>
                  <div>
                    <span className="text-slate-400">Streak Pen</span>
                    <div className="text-rose-300">-{h.components.streakPenalty.toFixed(1)}</div>
                  </div>
                  <div>
                    <span className="text-slate-400">Slippage Pen</span>
                    <div className="text-amber-300">-{h.components.slippagePenalty.toFixed(1)}</div>
                  </div>
                  <div>
                    <span className="text-slate-400">Vol×Lev Pen</span>
                    <div className="text-amber-300">-{h.components.volExposurePenalty.toFixed(1)}</div>
                  </div>
                  <div>
                    <span className="text-slate-400">Regime Fit</span>
                    <div className={h.components.regimeMismatchPenalty > 0 ? 'text-rose-300' : 'text-emerald-300'}>
                      -{h.components.regimeMismatchPenalty}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-400">PF Adj</span>
                    <div className={h.components.profitFactorAdjustment >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
                      {h.components.profitFactorAdjustment >= 0 ? '+' : ''}
                      {h.components.profitFactorAdjustment.toFixed(1)}
                    </div>
                  </div>
                </div>

                {/* Execution & Exposure Telemetry */}
                <div className="grid grid-cols-4 gap-2 border-t border-slate-800/70 pt-3 text-xs font-mono tabular-nums">
                  <div>
                    <div className="text-[11px] font-sans text-slate-400">Win Rate / PF</div>
                    <div className="text-slate-200">{s.winRatePct}% / {s.profitFactor.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-sans text-slate-400">Recent / Max DD</div>
                    <div className="text-slate-200">{s.recentDrawdownPct.toFixed(1)}% / {s.maxDrawdownPct.toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-sans text-slate-400">Exposure / Lev</div>
                    <div className="text-slate-200">${(s.exposureUsd / 1000).toFixed(1)}K · {s.leverage}x</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-sans text-slate-400">Slippage</div>
                    <div className="text-slate-200">{s.avgSlippageBps.toFixed(1)} bps</div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/70 pt-3">
                  <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${actionToneClass(d.action)}`}>
                    {d.action}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-500">
                      {s.isSimulatedMetrics ? 'Simulated telemetry' : 'Measured telemetry'}
                    </span>
                    <button
                      type="button"
                      onClick={() => onInspectExplanation(s.id)}
                      className="rounded border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-800 cursor-pointer"
                    >
                      Inspect XAI
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
