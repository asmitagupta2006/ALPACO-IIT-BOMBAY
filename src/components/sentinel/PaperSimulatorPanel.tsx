import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { fetchPaperHistory, runPaperSimulationApi } from '../../api/sentinelApi';
import {
  MARKET_REGIMES,
  type MarketRegime,
  type PaperSimulationResult,
} from '../../contracts/sentinel';
import { actionToneClass, severityToneClass } from './uiHelpers';

export function PaperSimulatorPanel() {
  const [strategyId, setStrategyId] = useState('strat-btc-momentum');
  const [symbol, setSymbol] = useState<'BTCUSD' | 'ETHUSD'>('BTCUSD');
  const [targetRegime, setTargetRegime] = useState<MarketRegime>('Trending');
  const [simulateTransition, setSimulateTransition] = useState(true);
  const [transitionToRegime, setTransitionToRegime] = useState<MarketRegime>('High Volatility');
  const [leverage, setLeverage] = useState(5);
  const [capitalUsd, setCapitalUsd] = useState(25000);
  const [takerFeeBps, setTakerFeeBps] = useState(5);
  const [baseSlippageBps, setBaseSlippageBps] = useState(2.5);

  const [result, setResult] = useState<PaperSimulationResult | null>(null);
  const [history, setHistory] = useState<PaperSimulationResult[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSim = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await runPaperSimulationApi({
        strategyId,
        symbol,
        targetRegime,
        simulateTransition,
        transitionToRegime,
        leverage,
        capitalUsd,
        barsCount: 64,
        takerFeeBps,
        baseSlippageBps,
      });
      setResult(res);
      const hist = await fetchPaperHistory();
      setHistory(hist.runs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation failed');
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    void runSim();
  }, []);

  const steps = result?.steps ?? [];
  const allEq = steps.flatMap((s) => [s.unguardedEquity, s.protectedEquity]);
  const minEq = allEq.length ? Math.min(...allEq) * 0.995 : capitalUsd * 0.9;
  const maxEq = allEq.length ? Math.max(...allEq) * 1.005 : capitalUsd * 1.1;
  const span = Math.max(1, maxEq - minEq);

  const svgW = 760;
  const svgH = 200;
  const pad = 16;

  const toLine = (getter: (s: (typeof steps)[number]) => number) =>
    steps
      .map((s, idx) => {
        const x = pad + (idx / Math.max(1, steps.length - 1)) * (svgW - pad * 2);
        const y = pad + (svgH - pad * 2) - ((getter(s) - minEq) / span) * (svgH - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  return (
    <div className="space-y-5">
      {/* Clear Simulation Disclaimer */}
      <div className="rounded-lg border border-amber-500/35 bg-amber-950/20 px-4 py-3 text-xs text-amber-200">
        <strong>SIMULATED PAPER TRADING ENVIRONMENT:</strong> Results below model hypothetical strategy execution with realistic fees ({takerFeeBps} bps) and dynamic volatility slippage. Simulated outputs are NOT actual live exchange trading profits.
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        {/* Simulation Controls */}
        <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5 space-y-3.5">
          <h2 className="font-display text-sm font-semibold text-slate-100 border-b border-slate-800/80 pb-2.5">
            Scenario Configuration
          </h2>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Strategy</label>
            <select
              aria-label="Paper simulation strategy"
              value={strategyId}
              onChange={(e) => setStrategyId(e.target.value)}
              className="w-full rounded border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-100"
            >
              <option value="strat-btc-momentum">BTC Momentum Trend</option>
              <option value="strat-eth-grid">ETH Mean-Reversion Grid</option>
              <option value="strat-btc-breakout">BTC Volatility Breakout</option>
              <option value="strat-eth-basis">ETH Funding Basis Arb</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Contract</label>
            <div className="grid grid-cols-2 gap-2">
              {(['BTCUSD', 'ETHUSD'] as const).map((sym) => (
                <button
                  key={sym}
                  type="button"
                  onClick={() => setSymbol(sym)}
                  className={`rounded border py-1.5 font-mono text-xs font-medium cursor-pointer ${
                    symbol === sym
                      ? 'border-sky-500/50 bg-sky-950/35 text-sky-200'
                      : 'border-slate-700 bg-[#0B1120] text-slate-400'
                  }`}
                >
                  {sym}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Initial Market Regime</label>
            <select
              aria-label="Initial market regime"
              value={targetRegime}
              onChange={(e) => setTargetRegime(e.target.value as MarketRegime)}
              className="w-full rounded border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-100"
            >
              {MARKET_REGIMES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={simulateTransition}
              onChange={(e) => setSimulateTransition(e.target.checked)}
            />
            <span>Inject Mid-Session Regime Transition</span>
          </label>

          {simulateTransition && (
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Transition Target Regime</label>
              <select
                aria-label="Transition target regime"
                value={transitionToRegime}
                onChange={(e) => setTransitionToRegime(e.target.value as MarketRegime)}
                className="w-full rounded border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-100"
              >
                {MARKET_REGIMES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Capital ($)</label>
              <input
                type="number"
                value={capitalUsd}
                min={1000}
                step={1000}
                onChange={(e) => setCapitalUsd(Number(e.target.value))}
                className="w-full rounded border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 font-mono text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Leverage (x)</label>
              <input
                type="number"
                value={leverage}
                min={1}
                max={20}
                step={1}
                onChange={(e) => setLeverage(Number(e.target.value))}
                className="w-full rounded border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 font-mono text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Taker Fee (bps)</label>
              <input
                type="number"
                value={takerFeeBps}
                min={0}
                max={25}
                step={0.5}
                onChange={(e) => setTakerFeeBps(Number(e.target.value))}
                className="w-full rounded border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 font-mono text-xs text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Base Slippage (bps)</label>
              <input
                type="number"
                value={baseSlippageBps}
                min={0}
                max={30}
                step={0.5}
                onChange={(e) => setBaseSlippageBps(Number(e.target.value))}
                className="w-full rounded border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 font-mono text-xs text-slate-100"
              />
            </div>
          </div>

          {error && <p className="text-xs text-rose-300">{error}</p>}

          <button
            type="button"
            onClick={() => void runSim()}
            disabled={running}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-sky-500/45 bg-sky-950/40 px-4 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-900/50 cursor-pointer disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" />
            <span>{running ? 'Running Simulation...' : 'Run Paper Simulation'}</span>
          </button>
        </section>

        {/* Results & Equity Curve Comparison */}
        <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
            <h2 className="font-display text-sm font-semibold text-slate-100">
              Simulated Equity Curve: Unguarded vs. Sentinel-Protected
            </h2>
            <span className="font-mono text-[11px] text-slate-400">
              64 bars (15m step) · Simulated Paper Mode
            </span>
          </div>

          {result && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <SimStat
                  label="Protected Sim PnL"
                  value={`${result.summary.protectedPnlUsd >= 0 ? '+' : ''}$${result.summary.protectedPnlUsd.toLocaleString()}`}
                  tone={result.summary.protectedPnlUsd >= 0 ? 'text-emerald-300' : 'text-rose-300'}
                />
                <SimStat
                  label="Unguarded Sim PnL"
                  value={`${result.summary.unguardedPnlUsd >= 0 ? '+' : ''}$${result.summary.unguardedPnlUsd.toLocaleString()}`}
                  tone={result.summary.unguardedPnlUsd >= 0 ? 'text-slate-200' : 'text-rose-300'}
                />
                <SimStat
                  label="Max DD (Prot vs Unguarded)"
                  value={`${result.summary.protectedMaxDrawdownPct}% vs ${result.summary.unguardedMaxDrawdownPct}%`}
                />
                <SimStat
                  label="Min Health / Exec Costs"
                  value={`${result.summary.minHealthScore}/100 · $${result.summary.totalExecutionCostsUsd.toFixed(0)}`}
                />
              </div>

              <div className="rounded-md border border-slate-800 bg-[#0B1120] p-3">
                <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-52" role="img" aria-label="Simulated equity comparison">
                  <polyline
                    fill="none"
                    stroke="#64748B"
                    strokeDasharray="4 4"
                    strokeWidth="1.5"
                    points={toLine((s) => s.unguardedEquity)}
                  />
                  <polyline
                    fill="none"
                    stroke="#38BDF8"
                    strokeWidth="2"
                    points={toLine((s) => s.protectedEquity)}
                  />
                </svg>
                <div className="mt-2 flex flex-wrap items-center justify-between text-[11px] text-slate-400">
                  <div className="flex items-center gap-4">
                    <span className="inline-flex items-center gap-1.5 text-sky-300">
                      <span className="inline-block h-0.5 w-4 bg-sky-400" />
                      Sentinel-Protected Equity
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-slate-400">
                      <span className="inline-block h-0.5 w-4 border-t border-dashed border-slate-400" />
                      Unguarded Strategy Baseline
                    </span>
                  </div>
                  <span className="font-mono tabular-nums">
                    {result.summary.exposureReductions} protective scale-downs ·{' '}
                    {result.summary.guardrailBreachesCount} breaches
                  </span>
                </div>
              </div>

              {/* Event Log */}
              <div>
                <h3 className="text-xs font-semibold text-slate-200 mb-2">
                  Simulated Transition &amp; Guardrail Event Log
                </h3>
                {result.events.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    No regime transitions or guardrail breaches occurred in this scenario.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-56 overflow-y-auto">
                    {result.events.map((ev, i) => (
                      <div
                        key={i}
                        className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800/80 bg-[#0B1120] px-3 py-2 text-xs"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${severityToneClass(ev.severity)}`}>
                              {ev.severity}
                            </span>
                            <span className="font-medium text-slate-100">{ev.title}</span>
                          </div>
                          <div className="text-[11px] text-slate-400">{ev.detail}</div>
                        </div>
                        <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${actionToneClass(ev.action)}`}>
                          {ev.action}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {history.length > 0 && (
        <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5">
          <h3 className="font-display text-sm font-semibold text-slate-100 mb-3">
            Recent Persisted Paper Simulation Runs
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                  <th className="py-2 pr-3 font-medium">Contract / Scenario</th>
                  <th className="py-2 px-3 font-medium text-right">Protected PnL</th>
                  <th className="py-2 px-3 font-medium text-right">Unguarded PnL</th>
                  <th className="py-2 px-3 font-medium text-right">Prot Max DD</th>
                  <th className="py-2 pl-3 font-medium text-right">Breaches</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono tabular-nums">
                {history.slice(0, 5).map((run) => (
                  <tr key={run.id}>
                    <td className="py-2 pr-3 font-sans text-slate-200">
                      {run.request.symbol} ·{' '}
                      {run.request.simulateTransition
                        ? `${run.request.targetRegime} → ${run.request.transitionToRegime}`
                        : run.request.targetRegime}
                    </td>
                    <td className={`py-2 px-3 text-right ${run.summary.protectedPnlUsd >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                      ${run.summary.protectedPnlUsd.toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-300">
                      ${run.summary.unguardedPnlUsd.toLocaleString()}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-200">
                      {run.summary.protectedMaxDrawdownPct}%
                    </td>
                    <td className="py-2 pl-3 text-right text-slate-300">
                      {run.summary.guardrailBreachesCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function SimStat({
  label,
  value,
  tone = 'text-slate-100',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded border border-slate-800/80 bg-[#0B1120] p-3">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className={`mt-1 font-mono text-sm font-semibold tabular-nums ${tone}`}>
        {value}
      </div>
    </div>
  );
}
