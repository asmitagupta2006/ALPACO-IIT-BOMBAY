import type { SentinelOverviewResponse } from '../../contracts/sentinel';
import { actionToneClass } from './uiHelpers';

interface RiskPredictionPanelProps {
  overview: SentinelOverviewResponse | null;
  onInspectExplanation: (strategyId: string) => void;
}

export function RiskPredictionPanel({
  overview,
  onInspectExplanation,
}: RiskPredictionPanelProps) {
  if (!overview) {
    return (
      <div className="rounded-lg border border-slate-800 bg-[#111A2E] p-6 text-xs text-slate-400">
        Loading AI Risk Prediction Center...
      </div>
    );
  }

  const riskModel = overview.activeModels.risk;

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-100">
              Model 2 — Strategy Deterioration &amp; Risk-Breach Probability (30m / 60m)
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {riskModel
                ? `${riskModel.algorithm} (${riskModel.version}) · Untouched Test Acc ${(riskModel.metrics.testAccuracy * 100).toFixed(1)}% · Brier ${riskModel.metrics.brierScore.toFixed(3)}`
                : 'Rule-assisted risk probability estimator'}
            </p>
          </div>
          <span className="font-mono text-[11px] text-slate-400">
            Target: &ge;70% Precision with Meaningful Recall (Honest Out-of-Sample Metrics)
          </span>
        </div>

        {/* Risk Distribution Bar Comparison Across Monitored Strategies */}
        <div className="mt-4 space-y-3">
          {overview.strategies.map((snap) => {
            const p30 = snap.riskPrediction.probability30m * 100;
            const p60 = snap.riskPrediction.probability60m * 100;
            const tierTone =
              snap.riskPrediction.riskTier === 'Critical'
                ? 'text-rose-300 border-rose-500/40 bg-rose-950/30'
                : snap.riskPrediction.riskTier === 'High'
                  ? 'text-orange-300 border-orange-500/40 bg-orange-950/30'
                  : snap.riskPrediction.riskTier === 'Elevated'
                    ? 'text-amber-300 border-amber-500/40 bg-amber-950/30'
                    : 'text-emerald-300 border-emerald-500/35 bg-emerald-950/25';

            return (
              <div
                key={snap.strategy.id}
                className="rounded-md border border-slate-800 bg-[#0B1120] p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-semibold text-slate-100">
                        {snap.strategy.name}
                      </span>
                      <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${tierTone}`}>
                        {snap.riskPrediction.riskTier} Risk
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-400 font-mono">
                      {snap.riskPrediction.calibrationNote} · Calibrated Conf{' '}
                      {(snap.riskPrediction.confidence * 100).toFixed(0)}%
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className={`rounded border px-2.5 py-1 text-xs font-medium ${actionToneClass(snap.decision.action)}`}>
                      {snap.decision.action}
                    </span>
                    <button
                      type="button"
                      onClick={() => onInspectExplanation(snap.strategy.id)}
                      className="rounded border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-pointer"
                    >
                      Explain Drivers
                    </button>
                  </div>
                </div>

                {/* 30m and 60m Risk Probability Bars */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300">30-Minute Breach Probability</span>
                      <span className="font-mono font-semibold text-slate-100 tabular-nums">
                        {p30.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className={`h-full ${
                          p30 >= 70 ? 'bg-rose-500' : p30 >= 45 ? 'bg-amber-500' : 'bg-sky-500'
                        }`}
                        style={{ width: `${Math.max(2, p30)}%` }}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300">60-Minute Breach Probability</span>
                      <span className="font-mono font-semibold text-slate-100 tabular-nums">
                        {p60.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className={`h-full ${
                          p60 >= 70 ? 'bg-rose-500' : p60 >= 45 ? 'bg-amber-500' : 'bg-sky-500'
                        }`}
                        style={{ width: `${Math.max(2, p60)}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Top Contributing Features */}
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/70 sm:grid-cols-5">
                  {snap.riskPrediction.topFeatures.map((feat) => (
                    <div key={feat.feature} className="text-[11px]">
                      <div className="text-slate-400 truncate" title={feat.label}>
                        {feat.label}
                      </div>
                      <div className="font-mono text-slate-200 tabular-nums">
                        val {feat.value.toFixed(3)} ·{' '}
                        <span className={feat.contribution >= 0 ? 'text-rose-300' : 'text-emerald-300'}>
                          {feat.contribution >= 0 ? '+' : ''}
                          {feat.contribution.toFixed(3)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
