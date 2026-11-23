import { AlertCircle } from 'lucide-react';
import type { SentinelOverviewResponse } from '../../contracts/sentinel';
import { formatPrice, formatTimestamp } from '../../utils/format';
import type { SentinelErrorInfo } from './OverviewDashboard';
import {
  formatTimeShortUtc,
  regimeBadgeClass,
  regimeHexColor,
} from './uiHelpers';

interface RegimeEnginePanelProps {
  overview: SentinelOverviewResponse | null;
  error: SentinelErrorInfo | null;
  onRetry: () => void;
  onSelectSymbolResolution: (symbol: string, resolution: '5m' | '15m' | '1h') => void;
}

export function RegimeEnginePanel({
  overview,
  error,
  onRetry,
  onSelectSymbolResolution,
}: RegimeEnginePanelProps) {
  if (error) {
    return (
      <section className="rounded-lg border border-rose-500/40 bg-rose-950/20 p-5 text-xs text-rose-200 space-y-2">
        <div className="flex items-start gap-2.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <div className="space-y-1.5">
            <p className="font-medium text-rose-100">
              Regime Engine unavailable — Delta Exchange India request failed
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

  if (!overview) {
    return (
      <div className="rounded-lg border border-slate-800 bg-[#111A2E] p-6 text-xs text-slate-400">
        Loading live Delta Exchange India candles for deterministic regime detection...
      </div>
    );
  }

  const { regime, heatmap } = overview;
  const timeline = regime.series.filter((pt) => pt.regime !== null).slice(-120);
  const minClose =
    timeline.length > 0 ? Math.min(...timeline.map((t) => t.close)) : 0;
  const maxClose =
    timeline.length > 0 ? Math.max(...timeline.map((t) => t.close)) : 0;
  const priceSpan = Math.max(1e-6, maxClose - minClose);

  const svgW = 760;
  const svgH = 190;
  const padX = 14;
  const padY = 18;
  const plotW = svgW - padX * 2;
  const plotH = svgH - padY * 2;

  const polylinePoints = timeline
    .map((pt, idx) => {
      const x = padX + (idx / Math.max(1, timeline.length - 1)) * plotW;
      const y = padY + plotH - ((pt.close - minClose) / priceSpan) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-100">
                Regime Classification Timeline — {overview.selectedSymbol} ({overview.resolution})
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Deterministic causal thresholds: {regime.parameters.shortVolWindow}-bar vol vs{' '}
                {regime.parameters.baselineVolWindow}-bar baseline, EMA({regime.parameters.emaWindow}) slope, CUSUM (k={regime.parameters.cusumDriftK}σ, H={regime.parameters.cusumThresholdH}σ)
              </p>
            </div>
            <span
              className={`rounded border px-2.5 py-1 text-xs font-semibold ${regimeBadgeClass(
                regime.sufficientData ? regime.currentRegime : null,
              )}`}
            >
              {regime.sufficientData && regime.currentRegime
                ? `${regime.currentRegime} · ${regime.score?.toFixed(1) ?? '—'}/100`
                : 'Insufficient data'}
            </span>
          </div>

          {!regime.sufficientData ? (
            <div className="rounded-md border border-amber-500/35 bg-amber-950/20 p-4 text-xs text-amber-200">
              {regime.insufficientReason}
            </div>
          ) : (
            <div className="rounded-md border border-slate-800 bg-[#0B1120] p-3">
              <svg
                viewBox={`0 0 ${svgW} ${svgH}`}
                className="w-full h-48 overflow-visible"
                role="img"
                aria-label="Price and deterministic regime classification timeline"
              >
                {timeline.map((pt, idx) => {
                  const bandW = plotW / Math.max(1, timeline.length);
                  const x = padX + idx * bandW;
                  return (
                    <rect
                      key={pt.time}
                      x={x}
                      y={padY}
                      width={Math.max(1.5, bandW + 0.5)}
                      height={plotH}
                      fill={regimeHexColor(pt.regime)}
                      opacity={0.16}
                    />
                  );
                })}
                <polyline
                  fill="none"
                  stroke="#E2E8F0"
                  strokeWidth="1.75"
                  points={polylinePoints}
                />
              </svg>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 font-mono tabular-nums">
                <span>
                  {timeline[0] ? formatTimeShortUtc(timeline[0].time) : '—'} · Low{' '}
                  {formatPrice(minClose)}
                </span>
                <div className="flex flex-wrap items-center gap-3 font-sans">
                  {(
                    ['Calm/Range', 'Trending', 'High-Volatility/Shock'] as const
                  ).map((reg) => (
                    <span key={reg} className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-sm"
                        style={{ backgroundColor: regimeHexColor(reg) }}
                      />
                      <span>{reg}</span>
                    </span>
                  ))}
                </div>
                <span>
                  {timeline[timeline.length - 1]
                    ? formatTimeShortUtc(timeline[timeline.length - 1].time)
                    : '—'}{' '}
                  · High {formatPrice(maxClose)}
                </span>
              </div>
            </div>
          )}

          {regime.inputs.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-slate-200 mb-2">
                Active Regime Inputs &amp; Re-Normalized Weights
              </h3>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                {regime.inputs.map((item) => (
                  <div
                    key={item.id}
                    className="rounded border border-slate-800/80 bg-[#0B1120] p-2.5 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-400 truncate" title={item.label}>
                        {item.label}
                      </span>
                      {item.weight > 0 && (
                        <span className="font-mono text-[10px] text-sky-300 shrink-0">
                          {(item.weight * 100).toFixed(1)}%
                        </span>
                      )}
                    </div>
                    <div
                      className={`font-mono text-xs font-semibold tabular-nums ${
                        item.available ? 'text-slate-100' : 'text-slate-500'
                      }`}
                    >
                      {item.formattedValue}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate" title={item.reasonIfExcluded || item.formulaNote}>
                      {item.reasonIfExcluded || item.formulaNote}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Multi-Contract Regime Heatmap */}
        <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5 space-y-4">
          <div className="border-b border-slate-800/80 pb-3">
            <h2 className="font-display text-sm font-semibold text-slate-100">
              Multi-Contract Regime Matrix
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              BTCUSD &amp; ETHUSD perpetuals across 5m, 15m, and 1h (click to switch)
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums">
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
                    Trend {cell.trendStrength !== null ? `${cell.trendStrength.toFixed(2)}σ` : '—'}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* Measured Regime Transitions from Real Candles */}
      <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-100">
              Measured Regime Transitions ({overview.selectedSymbol} · {overview.resolution})
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Chronological bar-level regime transitions detected in the fetched Delta Exchange candle window
            </p>
          </div>
          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
            {regime.transitions.length} transitions · {regime.classifiedBarCount} classified bars
          </span>
        </div>

        {regime.transitions.length === 0 ? (
          <p className="py-4 text-xs text-slate-400">
            No regime transitions detected inside this candle window.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                  <th className="py-2 pr-3 font-medium">Candle Time (UTC)</th>
                  <th className="py-2 px-3 font-medium">Transition</th>
                  <th className="py-2 px-3 font-medium text-right">Risk Score</th>
                  <th className="py-2 px-3 font-medium text-right">Vol Z</th>
                  <th className="py-2 px-3 font-medium text-right">Short Vol</th>
                  <th className="py-2 px-3 font-medium text-right">Trend Str</th>
                  <th className="py-2 pl-3 font-medium text-right">CUSUM Max</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-[11px] tabular-nums">
                {regime.transitions
                  .slice()
                  .reverse()
                  .slice(0, 15)
                  .map((tr) => (
                    <tr key={tr.time} className="hover:bg-slate-900/40">
                      <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">
                        {formatTimeShortUtc(tr.time)}
                      </td>
                      <td className="py-2 px-3 font-sans text-slate-200 whitespace-nowrap">
                        {tr.fromRegime} → {tr.toRegime}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-100">
                        {tr.riskScore.toFixed(1)}/100
                      </td>
                      <td className="py-2 px-3 text-right text-slate-300">
                        {tr.volZScore !== null ? `${tr.volZScore.toFixed(2)}σ` : '—'}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-300">
                        {tr.shortVol !== null ? `${(tr.shortVol * 100).toFixed(3)}%` : '—'}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-300">
                        {tr.trendStrength !== null ? `${tr.trendStrength.toFixed(2)}σ` : '—'}
                      </td>
                      <td className="py-2 pl-3 text-right text-slate-300">
                        {tr.cusumMax !== null ? `${tr.cusumMax.toFixed(2)}σ` : '—'}
                        {tr.changePointTriggered ? ' *' : ''}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
