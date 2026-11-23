import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { SentinelOverviewResponse } from '../../contracts/sentinel';

interface CompetitionDeckPanelProps {
  overview: SentinelOverviewResponse | null;
}

export function CompetitionDeckPanel({ overview }: CompetitionDeckPanelProps) {
  const [slideIdx, setSlideIdx] = useState(0);

  const regimeModel = overview?.activeModels.regime;
  const riskModel = overview?.activeModels.risk;
  const btcStrategy = overview?.strategies.find((s) => s.strategy.symbol === 'BTCUSD');

  const slides = [
    {
      number: 'Slide 1 of 6',
      title: 'Selected Delta AlgoHub Features & Product Understanding',
      tag: 'Delta Exchange × Techfest 2026–27',
      bullets: [
        'Selected AlgoHub Pillars: (1) Trading Bot execution automation and (2) Public/Private REST & WebSocket APIs on Delta Exchange India.',
        'Current Ecosystem Strength: Traders can connect bots to perpetuals & options via low-latency APIs, execute rule-based entries/exits, and monitor live ticker/candle streams.',
        'Existing Product Scope Preserved: Regime Sentinel builds directly atop Delta REST (/v2/products, /v2/tickers, /v2/history/candles) and WebSocket (v2/ticker, candlestick_<res>) telemetry.',
      ],
      provenance: 'Measured Infrastructure: Live Delta Exchange India REST & WebSocket proxy active.',
    },
    {
      number: 'Slide 2 of 6',
      title: 'Problem Identification & Critical Product Gap',
      tag: 'Why Algorithmic Strategies Fail Silently',
      bullets: [
        'Core Gap: Trading bots execute static logic even when the underlying market regime flips (e.g., Trending → High Volatility or Trending → Ranging).',
        'Failure Mode: A trend-following BTC perpetual bot suffers whipsaw consecutive losses and elevated slippage during Transition / Unstable phases, while grid bots suffer directional blowouts during breakouts.',
        'Missing Layer: Exchanges expose raw price/order APIs, NOT runtime regime diagnostics, predictive deterioration risk, or explainable safety guardrails.',
      ],
      provenance: 'Domain Problem Statement: Validated through simulated regime-transition stress runs.',
    },
    {
      number: 'Slide 3 of 6',
      title: 'Proposed Innovation: Regime Sentinel',
      tag: 'Runtime AI Safety & Regime Intelligence (Not a Strategy Generator)',
      bullets: [
        'Model 1 (Market Regime Classifier): Chronologically trained Gradient Boosted Trees / Random Forest classifying Trending, Ranging, High Vol, Low Vol, and Transition / Unstable.',
        'Model 2 (Strategy Deterioration Predictor): Binary XGBoost-style classifier estimating 30m/60m risk-breach probability with Platt calibration.',
        'Model 3 (Hybrid Decision + Guardrail Gate): Deterministic CONTINUE / MONITOR / REDUCE EXPOSURE / CONSIDER PAUSING / CRITICAL RISK WARNING with mandatory human approval for live actions.',
      ],
      provenance: `Measured ML Artifacts: Model 1 ${regimeModel ? `${regimeModel.version} (${(regimeModel.metrics.testAccuracy * 100).toFixed(1)}% untouched test acc)` : 'Active'} · Model 2 ${riskModel ? `${riskModel.version} (Brier ${riskModel.metrics.brierScore.toFixed(3)})` : 'Active'}.`,
    },
    {
      number: 'Slide 4 of 6',
      title: 'Real-World BTC Perpetual Trading Use Case',
      tag: 'Live Transition Safety Workflow',
      bullets: [
        `Current Live State (${overview?.selectedSymbol ?? 'BTCUSD'}): Detected regime is ${overview?.regime.regime ?? '—'} (${overview ? Math.round(overview.regime.confidence * 100) : '—'}% confidence) with ATR ${(overview ? overview.regime.features.atrPct * 100 : 0).toFixed(3)}%.`,
        `Strategy Impact (${btcStrategy?.strategy.name ?? 'BTC Momentum Trend'}): Documented Health Score = ${btcStrategy?.health.totalScore ?? '—'}/100, 30m Risk = ${btcStrategy ? (btcStrategy.riskPrediction.probability30m * 100).toFixed(1) : '—'}%, Recommended Action = ${btcStrategy?.decision.action ?? '—'}.`,
        'Safety Loop: Transition Alert fires -> 8-part Explainable AI cites exact ATR/vol clustering drivers -> Guardrail engine recommends exposure cut -> Operator confirms or triggers Kill Switch with SQLite audit.',
      ],
      provenance: 'Measured Market Candles + Paper-Monitored Strategy Telemetry (never auto-executes live trades).',
    },
    {
      number: 'Slide 5 of 6',
      title: 'Technical Approach, ML Rigor & Architecture',
      tag: 'Zero Look-Ahead Leakage · Real Backend Execution',
      bullets: [
        'Data Pipeline: Chunked Delta REST ingestion, timestamp monotonicity checks, duplicate/OHLC integrity repair, and SQLite (node:sqlite) persistence.',
        'Strict Chronological Validation: 70% Train / 15% Validation / 15% Untouched Test with purge gaps + 4-fold expanding Walk-Forward CV (zero random shuffling).',
        'Explainability & Safety: Tree-path SHAP attributions + optional Gemini synthesis strictly grounded in computed features, plus conservative rule-based fallback if data quality < 70.',
      ],
      provenance: 'Verified Architecture: All training, walk-forward CV, and unit tests execute in backend.',
    },
    {
      number: 'Slide 6 of 6',
      title: 'Expected Impact, Honest Scope & Future Roadmap',
      tag: 'Measured vs Simulated vs Future Capabilities',
      bullets: [
        `Measured Today: Live Delta India market proxy, real out-of-sample Model 1 (${regimeModel ? `${(regimeModel.metrics.testAccuracy * 100).toFixed(1)}%` : '—'}) & Model 2 (${riskModel ? `${(riskModel.metrics.testAccuracy * 100).toFixed(1)}%` : '—'}) evaluations, PSI drift checks, and SQLite audit logging.`,
        'Simulated Today: Paper Trading Simulator compares unguarded vs Sentinel-protected drawdowns under realistic fees and volatility slippage (explicitly labeled as simulated).',
        'Proposed Future Extensions: Authenticated Delta AlgoHub webhook bridge (requiring user-signed API keys), multi-exchange order-book depth L2 features, and automated Slack/Telegram alert dispatch.',
      ],
      provenance: 'Transparent Competition Reporting: No fabricated profits or guaranteed trading returns.',
    },
  ];

  const active = slides[slideIdx];

  return (
    <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div>
          <div className="font-mono text-xs text-sky-400">{active.number} · {active.tag}</div>
          <h2 className="mt-1 font-display text-xl font-semibold text-slate-100">
            {active.title}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSlideIdx((i) => Math.max(0, i - 1))}
            disabled={slideIdx === 0}
            className="inline-flex items-center gap-1 rounded border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span>Prev</span>
          </button>
          <button
            type="button"
            onClick={() => setSlideIdx((i) => Math.min(slides.length - 1, i + 1))}
            disabled={slideIdx === slides.length - 1}
            className="inline-flex items-center gap-1 rounded border border-sky-500/40 bg-sky-950/35 px-3 py-1.5 text-xs font-medium text-sky-200 hover:bg-sky-900/45 disabled:opacity-40 cursor-pointer"
          >
            <span>Next</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-6 gap-1.5">
        {slides.map((s, idx) => (
          <button
            key={s.number}
            type="button"
            onClick={() => setSlideIdx(idx)}
            className={`rounded border px-2 py-1.5 text-left text-[11px] font-mono cursor-pointer transition-colors ${
              idx === slideIdx
                ? 'border-sky-500/60 bg-sky-950/35 text-sky-200'
                : 'border-slate-800 bg-[#0B1120] text-slate-400 hover:text-slate-200'
            }`}
          >
            Slide {idx + 1}
          </button>
        ))}
      </div>

      <div className="rounded-md border border-slate-800 bg-[#0B1120] p-5 space-y-3">
        {active.bullets.map((b, i) => (
          <div key={i} className="flex items-start gap-3 text-sm text-slate-200 leading-relaxed">
            <span className="mt-1 font-mono text-xs text-sky-400 shrink-0">0{i + 1}.</span>
            <p>{b}</p>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-800/80 pt-3 font-mono text-xs text-slate-400">
        {active.provenance}
      </div>
    </section>
  );
}
