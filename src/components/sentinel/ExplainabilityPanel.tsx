import { useEffect, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { fetchExplanation } from '../../api/sentinelApi';
import type { CandleResolution } from '../../contracts/delta';
import type {
  ExplainablePrediction,
  SentinelOverviewResponse,
} from '../../contracts/sentinel';
import { actionToneClass, regimeBadgeClass } from './uiHelpers';

interface ExplainabilityPanelProps {
  overview: SentinelOverviewResponse | null;
  selectedStrategyId: string;
  onSelectStrategyId: (id: string) => void;
  resolution: CandleResolution;
  dataMode: 'live' | 'demo';
}

export function ExplainabilityPanel({
  overview,
  selectedStrategyId,
  onSelectStrategyId,
  resolution,
  dataMode,
}: ExplainabilityPanelProps) {
  const [explanation, setExplanation] = useState<ExplainablePrediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geminiLoading, setGeminiLoading] = useState(false);

  const strategy =
    overview?.strategies.find((s) => s.strategy.id === selectedStrategyId) ??
    overview?.strategies[0] ??
    null;

  const loadExplanation = async (useGemini = false) => {
    if (!strategy) return;
    if (useGemini) setGeminiLoading(true);
    else setLoading(true);
    setError(null);
    try {
      const data = await fetchExplanation({
        symbol: strategy.strategy.symbol,
        resolution,
        strategyId: strategy.strategy.id,
        mode: dataMode,
        gemini: useGemini,
      });
      setExplanation(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load AI explanation');
    } finally {
      setLoading(false);
      setGeminiLoading(false);
    }
  };

  useEffect(() => {
    void loadExplanation(false);
  }, [strategy?.strategy.id, strategy?.strategy.symbol, resolution, dataMode]);

  if (!overview || !strategy) {
    return (
      <div className="rounded-lg border border-slate-800 bg-[#111A2E] p-6 text-xs text-slate-400">
        Loading AI Explanation Center...
      </div>
    );
  }

  const maxAbsContrib = Math.max(
    0.05,
    ...(explanation?.increasedRiskFactors.map((f) => Math.abs(f.contribution)) ?? [0.1]),
  );

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-100">
              Explainable AI Engine — Grounded Prediction Dossier
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Every statement references actual computed feature values, tree-path attributions, and calibrated metrics
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Select strategy to explain"
              value={strategy.strategy.id}
              onChange={(e) => onSelectStrategyId(e.target.value)}
              className="rounded border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-100 cursor-pointer"
            >
              {overview.strategies.map((s) => (
                <option key={s.strategy.id} value={s.strategy.id}>
                  {s.strategy.name} ({s.strategy.symbol})
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => void loadExplanation(true)}
              disabled={geminiLoading || !explanation?.geminiAvailable}
              title={
                explanation?.geminiAvailable
                  ? 'Synthesize concise risk-officer summary via server-side Gemini API'
                  : 'Server GEMINI_API_KEY not configured — deterministic feature-grounded dossier active'
              }
              className="inline-flex items-center gap-1.5 rounded border border-sky-500/40 bg-sky-950/30 px-3 py-1.5 text-xs font-medium text-sky-200 hover:bg-sky-900/40 disabled:opacity-45 cursor-pointer"
            >
              {geminiLoading ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              <span>
                {explanation?.geminiAvailable ? 'Synthesize Gemini Summary' : 'Gemini Key Not Set (Deterministic XAI)'}
              </span>
            </button>
          </div>
        </div>

        {loading && !explanation && (
          <div className="py-6 text-xs text-slate-400">Computing feature attributions...</div>
        )}
        {error && (
          <div className="rounded border border-rose-500/35 bg-rose-950/20 p-3 text-xs text-rose-200">
            {error}
          </div>
        )}

        {explanation && (
          <div className="space-y-4">
            {explanation.geminiNarrative && (
              <div className="rounded-md border border-sky-500/35 bg-sky-950/20 p-3.5 text-xs text-sky-100">
                <div className="font-semibold text-sky-300 mb-1">
                  Server-Side Gemini Risk Officer Synthesis (Grounded in Computed Telemetry)
                </div>
                <p className="leading-relaxed">{explanation.geminiNarrative}</p>
              </div>
            )}

            {/* 8-Part Structured Explanation Grid */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ExplainBlock title="1. What Happened?" body={explanation.whatHappened} />
              <ExplainBlock
                title="2. Which Indicators Changed?"
                content={
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {explanation.indicatorsChanged.map((ind) => (
                      <div key={ind.name} className="rounded border border-slate-800 bg-[#111A2E] p-2">
                        <div className="text-[11px] text-slate-400">{ind.name}</div>
                        <div className="font-mono text-xs font-semibold text-slate-100 tabular-nums">
                          {ind.value}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">{ind.baselineDelta}</div>
                      </div>
                    ))}
                  </div>
                }
              />

              <ExplainBlock
                title="3. What Is the Detected Regime?"
                content={
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`rounded border px-2.5 py-1 text-xs font-semibold ${regimeBadgeClass(explanation.detectedRegime)}`}>
                      {explanation.detectedRegime}
                    </span>
                    <span className="font-mono text-xs text-slate-200 tabular-nums">
                      {explanation.regimeConfidencePct}% calibrated regime confidence
                    </span>
                  </div>
                }
              />

              <ExplainBlock title="4. Why Is the Strategy Affected?" body={explanation.whyStrategyAffected} />

              <ExplainBlock
                title="5. Which Risk Factors Increased? (Tree-Path SHAP Attribution)"
                content={
                  <div className="space-y-2">
                    {explanation.increasedRiskFactors.map((f) => {
                      const pct = Math.min(100, (Math.abs(f.contribution) / maxAbsContrib) * 100);
                      const isPos = f.contribution >= 0;
                      return (
                        <div key={f.feature} className="space-y-1 text-xs">
                          <div className="flex items-center justify-between font-mono text-[11px]">
                            <span className="font-sans text-slate-200">
                              {f.label} <span className="text-slate-500">({f.value.toFixed(3)})</span>
                            </span>
                            <span className={isPos ? 'text-rose-300' : 'text-emerald-300'}>
                              {isPos ? '+' : ''}
                              {f.contribution.toFixed(3)} log-odds
                            </span>
                          </div>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                            <div
                              className={`h-full ${isPos ? 'bg-rose-500' : 'bg-emerald-500'}`}
                              style={{ width: `${Math.max(4, pct)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                }
              />

              <ExplainBlock
                title="6. What Action Should the Trader Consider?"
                content={
                  <div className="space-y-2">
                    <span className={`inline-block rounded border px-2.5 py-1 text-xs font-semibold ${actionToneClass(explanation.recommendedAction)}`}>
                      {explanation.recommendedAction}
                    </span>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {explanation.actionJustification}
                    </p>
                  </div>
                }
              />

              <ExplainBlock
                title="7. Model Calibrated Confidence & Reliability"
                content={
                  <div className="grid grid-cols-3 gap-2 font-mono text-xs tabular-nums">
                    <div>
                      <div className="text-[11px] font-sans text-slate-400">Regime Conf</div>
                      <div className="text-slate-100">{explanation.calibratedConfidence.regimeConfidencePct}%</div>
                    </div>
                    <div>
                      <div className="text-[11px] font-sans text-slate-400">Risk Brier Score</div>
                      <div className="text-slate-100">
                        {explanation.calibratedConfidence.riskCalibrationBrier !== null
                          ? explanation.calibratedConfidence.riskCalibrationBrier.toFixed(4)
                          : 'N/A'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-sans text-slate-400">Data Quality</div>
                      <div className="text-slate-100">{explanation.calibratedConfidence.dataQualityScore}/100</div>
                    </div>
                  </div>
                }
              />

              <ExplainBlock
                title="8. Model Limitations & Uncertainty Disclosure"
                content={
                  <ul className="list-disc pl-4 space-y-1 text-xs text-slate-300">
                    {explanation.limitations.map((lim, i) => (
                      <li key={i}>{lim}</li>
                    ))}
                  </ul>
                }
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ExplainBlock({
  title,
  body,
  content,
}: {
  title: string;
  body?: string;
  content?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-slate-800 bg-[#0B1120] p-4 space-y-2">
      <h3 className="font-display text-xs font-semibold text-sky-300">{title}</h3>
      {body && <p className="text-xs text-slate-200 leading-relaxed">{body}</p>}
      {content}
    </div>
  );
}
