import { useMemo, useState } from 'react';
import { Check, Filter } from 'lucide-react';
import type {
  AlertSeverity,
  RegimeTransitionAlert,
  SentinelOverviewResponse,
} from '../../contracts/sentinel';
import { formatPrice, formatTimestamp } from '../../utils/format';
import {
  actionToneClass,
  formatTimeShortUtc,
  regimeBadgeClass,
  regimeHexColor,
  severityToneClass,
} from './uiHelpers';

interface RegimeEnginePanelProps {
  overview: SentinelOverviewResponse | null;
  alerts: RegimeTransitionAlert[];
  onAcknowledgeAlert: (id: string) => void;
  onSelectSymbolResolution: (symbol: string, resolution: '5m' | '15m' | '1h') => void;
}

export function RegimeEnginePanel({
  overview,
  alerts,
  onAcknowledgeAlert,
  onSelectSymbolResolution,
}: RegimeEnginePanelProps) {
  const [severityFilter, setSeverityFilter] = useState<'ALL' | AlertSeverity>('ALL');

  const filteredAlerts = useMemo(() => {
    if (severityFilter === 'ALL') return alerts;
    return alerts.filter((a) => a.severity === severityFilter);
  }, [alerts, severityFilter]);

  if (!overview) {
    return (
      <div className="rounded-lg border border-slate-800 bg-[#111A2E] p-6 text-xs text-slate-400">
        Loading AI Regime Detection Engine...
      </div>
    );
  }

  const timeline = overview.timeline;
  const minClose = Math.min(...timeline.map((t) => t.close));
  const maxClose = Math.max(...timeline.map((t) => t.close));
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

  const f = overview.regime.features;

  return (
    <div className="space-y-5">
      {/* Regime Summary & Timeline */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-100">
                Regime Transition Timeline — {overview.selectedSymbol} ({overview.resolution})
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {overview.regime.modelAlgorithm} ({overview.regime.modelVersion}) · Causal features computed strictly up to bar timestamp
              </p>
            </div>
            <span
              className={`rounded border px-2.5 py-1 text-xs font-semibold ${regimeBadgeClass(overview.regime.regime)}`}
            >
              {overview.regime.regime} · {Math.round(overview.regime.confidence * 100)}%
            </span>
          </div>

          <div className="rounded-md border border-slate-800 bg-[#0B1120] p-3">
            <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-48 overflow-visible" role="img" aria-label="Price and regime classification timeline">
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
                    opacity={0.14}
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
                {timeline[0] ? formatTimeShortUtc(timeline[0].time) : '—'} · Low {formatPrice(minClose)}
              </span>
              <div className="flex flex-wrap items-center gap-3 font-sans">
                {(['Trending', 'Ranging', 'High Volatility', 'Low Volatility', 'Transition / Unstable'] as const).map((reg) => (
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

          {/* Local Feature Attributions */}
          <div>
            <h3 className="text-xs font-semibold text-slate-200 mb-2">
              Top Model 1 Drivers for Current Classification
            </h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
              {overview.regime.topDrivers.map((d) => (
                <div
                  key={d.feature}
                  className="rounded border border-slate-800/80 bg-[#0B1120] p-2.5 text-xs"
                >
                  <div className="text-[11px] text-slate-400 truncate" title={d.label}>
                    {d.label}
                  </div>
                  <div className="mt-1 font-mono text-xs font-semibold text-slate-100 tabular-nums">
                    {d.value.toFixed(4)}
                  </div>
                  <div
                    className={`mt-0.5 font-mono text-[11px] tabular-nums ${
                      d.contribution >= 0 ? 'text-sky-300' : 'text-amber-300'
                    }`}
                  >
                    {d.contribution >= 0 ? '+' : ''}
                    {d.contribution.toFixed(3)} log-odds
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Multi-Asset Multi-Timeframe Regime Heatmap */}
        <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5 space-y-4">
          <div className="border-b border-slate-800/80 pb-3">
            <h2 className="font-display text-sm font-semibold text-slate-100">
              Multi-Contract Regime Heatmap
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              BTC & ETH perpetual regimes across 5m, 15m, and 1h timeframes (click to switch)
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {overview.heatmap.map((cell) => (
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
                    ${cell.lastClose.toLocaleString()}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span
                    className={`rounded border px-2 py-0.5 text-[11px] font-medium ${regimeBadgeClass(cell.regime)}`}
                  >
                    {cell.regime}
                  </span>
                  <span className="font-mono text-[11px] text-slate-300 tabular-nums">
                    {Math.round(cell.confidence * 100)}%
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-slate-400 tabular-nums">
                  <span>ATR {(cell.atrPct * 100).toFixed(2)}%</span>
                  <span>RSI {cell.rsi14.toFixed(1)}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* Causal Engineered Feature Readout */}
      <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
          <h2 className="font-display text-sm font-semibold text-slate-100">
            Causal Feature Engineering Snapshot ({overview.selectedSymbol} · {overview.resolution})
          </h2>
          <span className="text-[11px] text-slate-400">
            Computed strictly from bars &le; prediction timestamp
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          <FeatureStat label="RSI (14)" value={f.rsi14.toFixed(2)} />
          <FeatureStat label="MACD Hist" value={f.macdHist.toFixed(2)} />
          <FeatureStat label="ATR (14)" value={f.atr14.toFixed(2)} />
          <FeatureStat label="ATR %" value={`${(f.atrPct * 100).toFixed(3)}%`} />
          <FeatureStat label="EMA 20" value={formatPrice(f.ema20)} />
          <FeatureStat label="EMA 50" value={formatPrice(f.ema50)} />
          <FeatureStat label="EMA 200" value={formatPrice(f.ema200)} />
          <FeatureStat label="1-Bar Return" value={`${(f.ret1 * 100).toFixed(3)}%`} />
          <FeatureStat label="Realized Vol (20)" value={`${(f.realizedVol20 * 100).toFixed(3)}%`} />
          <FeatureStat label="Vol Clustering" value={`${f.volClustering.toFixed(2)}x`} />
          <FeatureStat label="Trend Strength" value={`${(f.trendStrength * 100).toFixed(1)}%`} />
          <FeatureStat label="Range Expansion" value={`${f.rangeExpansion.toFixed(2)}x`} />
          <FeatureStat label="Volume Surge" value={`${(f.volumeChange * 100).toFixed(1)}%`} />
          <FeatureStat label="Funding / OI Δ" value={`${f.fundingRate.toFixed(3)}% / ${f.oiChangePct.toFixed(1)}%`} />
        </div>
      </section>

      {/* Regime Transition Alert History */}
      <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-100">
              Regime Transition Alert Engine History
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Automatically identifies affected strategies, evaluates exposure, and recommends protective action
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-md border border-slate-800 bg-[#0B1120] p-1">
            <Filter className="ml-1.5 mr-1 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            {(['ALL', 'Information', 'Warning', 'Critical'] as const).map((sev) => (
              <button
                key={sev}
                type="button"
                onClick={() => setSeverityFilter(sev)}
                className={`rounded px-2.5 py-1 text-xs font-medium cursor-pointer ${
                  severityFilter === sev
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {sev}
              </button>
            ))}
          </div>
        </div>

        {filteredAlerts.length === 0 ? (
          <p className="py-4 text-xs text-slate-400">
            No alerts match the selected severity filter.
          </p>
        ) : (
          <div className="space-y-2.5">
            {filteredAlerts.slice(0, 12).map((alert) => (
              <div
                key={alert.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-slate-800/80 bg-[#0B1120] p-3 text-xs"
              >
                <div className="space-y-1 flex-1 min-w-[240px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${severityToneClass(alert.severity)}`}>
                      {alert.severity}
                    </span>
                    <span className="font-mono font-semibold text-slate-100">{alert.symbol}</span>
                    <span className="text-slate-200">
                      {alert.fromRegime} → {alert.toRegime}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                      {formatTimestamp(alert.timestamp)}
                    </span>
                  </div>
                  <p className="text-slate-300">{alert.reason}</p>
                  <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
                    {alert.affectedStrategies.map((st) => (
                      <span key={st.strategyId} className="font-mono">
                        {st.strategyName}: Health {st.healthScore} · Risk {(st.riskProb30m * 100).toFixed(0)}%
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${actionToneClass(alert.recommendedAction)}`}>
                    {alert.recommendedAction}
                  </span>
                  {!alert.acknowledged ? (
                    <button
                      type="button"
                      onClick={() => onAcknowledgeAlert(alert.id)}
                      className="inline-flex items-center gap-1 rounded border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-800 cursor-pointer"
                    >
                      <Check className="h-3 w-3" />
                      <span>Acknowledge</span>
                    </button>
                  ) : (
                    <span className="text-[11px] text-slate-500">Acknowledged</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function FeatureStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-800/70 bg-[#0B1120] p-2.5">
      <div className="text-[11px] text-slate-400 truncate">{label}</div>
      <div className="mt-1 font-mono text-xs font-semibold text-slate-100 tabular-nums truncate">
        {value}
      </div>
    </div>
  );
}
