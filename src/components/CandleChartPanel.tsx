import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { AlertCircle, KeyRound, RefreshCw } from 'lucide-react';
import type {
  AlpacaFeedInfo,
  AlpacaStockFeed,
  MarketDataSource,
} from '../contracts/alpaca';
import type {
  CandlePriceBasis,
  CandleResolution,
  DeltaCandle,
} from '../contracts/delta';
import type {
  Phase2RegimeLabel,
  RegimeTransitionMarker,
} from '../contracts/regime';
import type { MarketRegime } from '../contracts/sentinel';
import { engineerFeatures } from '../quant/indicators';
import { formatNumber, formatPrice, formatTimestamp, getTickDecimals } from '../utils/format';

export type LookbackOption = {
  id: string;
  label: string;
  seconds: number;
};

export const LOOKBACK_OPTIONS: readonly LookbackOption[] = [
  { id: '6h', label: '6H', seconds: 6 * 3600 },
  { id: '24h', label: '24H', seconds: 24 * 3600 },
  { id: '3d', label: '3D', seconds: 3 * 86_400 },
  { id: '7d', label: '7D', seconds: 7 * 86_400 },
  { id: '30d', label: '30D', seconds: 30 * 86_400 },
] as const;

export const CHART_RESOLUTIONS: readonly CandleResolution[] = [
  '1m',
  '5m',
  '15m',
  '1h',
  '4h',
  '1d',
] as const;

const ALPACA_FEED_OPTIONS: ReadonlyArray<{ id: AlpacaStockFeed; label: string }> = [
  { id: 'iex', label: 'IEX Live' },
  { id: 'delayed_sip', label: 'Delayed SIP (15m)' },
  { id: 'sip', label: 'SIP Live' },
];

interface CandleChartPanelProps {
  dataSource?: MarketDataSource;
  symbol: string | null;
  tickSize: string | number | null;
  resolution: CandleResolution;
  onChangeResolution: (res: CandleResolution) => void;
  lookbackId: string;
  onChangeLookback: (id: string) => void;
  basis: CandlePriceBasis;
  onChangeBasis: (basis: CandlePriceBasis) => void;
  candles: DeltaCandle[];
  liveCandle: DeltaCandle | null;
  isLoading: boolean;
  error: { message: string; timestamp: string } | null;
  source: string | null;
  fetchedAt: string | null;
  querySymbol: string | null;
  onRetry: () => void;
  detectedRegime?: MarketRegime | null;
  regimeConfidence?: number | null;
  phase2Regime?: Phase2RegimeLabel | null;
  phase2Score?: number | null;
  phase2Insufficient?: boolean;
  regimeTransitions?: RegimeTransitionMarker[];
  alpacaConfigured?: boolean;
  alpacaFeed?: AlpacaStockFeed;
  onChangeAlpacaFeed?: (feed: AlpacaStockFeed) => void;
  alpacaFeedInfo?: AlpacaFeedInfo | null;
}

export function CandleChartPanel({
  dataSource = 'delta',
  symbol,
  tickSize,
  resolution,
  onChangeResolution,
  lookbackId,
  onChangeLookback,
  basis,
  onChangeBasis,
  candles,
  liveCandle,
  isLoading,
  error,
  source,
  fetchedAt,
  querySymbol,
  onRetry,
  detectedRegime,
  regimeConfidence,
  phase2Regime,
  phase2Score,
  phase2Insufficient = false,
  regimeTransitions = [],
  alpacaConfigured = false,
  alpacaFeed = 'iex',
  onChangeAlpacaFeed,
  alpacaFeedInfo,
}: CandleChartPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const ema20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema50SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const lastBarTimeRef = useRef<number>(0);
  const transitionMapRef = useRef<Map<number, RegimeTransitionMarker>>(new Map());

  const [hoveredCandle, setHoveredCandle] = useState<DeltaCandle | null>(null);
  const [hoveredTransition, setHoveredTransition] = useState<RegimeTransitionMarker | null>(null);
  const [hoveredChipTransition, setHoveredChipTransition] = useState<RegimeTransitionMarker | null>(null);
  const [selectedTransition, setSelectedTransition] = useState<RegimeTransitionMarker | null>(null);
  const [showEmas, setShowEmas] = useState<boolean>(true);

  const decimals = getTickDecimals(tickSize);
  const minMove = decimals > 0 ? Number((1 / Math.pow(10, decimals)).toFixed(decimals)) : 1;
  const isAlpaca = dataSource === 'alpaca';
  const isAlpacaCrypto = isAlpaca && Boolean(symbol?.includes('/'));

  const transitionByTime = useMemo(() => {
    const map = new Map<number, RegimeTransitionMarker>();
    for (const t of regimeTransitions) {
      map.set(t.time, t);
    }
    return map;
  }, [regimeTransitions]);

  useEffect(() => {
    transitionMapRef.current = transitionByTime;
    setHoveredChipTransition(null);
    setSelectedTransition(null);
  }, [transitionByTime]);

  // Initialize TradingView Lightweight Charts instance once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight || 440,
      layout: {
        background: { type: ColorType.Solid, color: '#0B1120' },
        textColor: '#94A3B8',
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(148, 163, 184, 0.08)' },
        horzLines: { color: 'rgba(148, 163, 184, 0.08)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(56, 189, 248, 0.45)', labelBackgroundColor: '#1E293B' },
        horzLine: { color: 'rgba(56, 189, 248, 0.45)', labelBackgroundColor: '#1E293B' },
      },
      rightPriceScale: {
        borderColor: 'rgba(148, 163, 184, 0.16)',
      },
      timeScale: {
        borderColor: 'rgba(148, 163, 184, 0.16)',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#16A34A',
      downColor: '#DC2626',
      borderVisible: false,
      wickUpColor: '#22C55E',
      wickDownColor: '#EF4444',
    });

    const markersPlugin = createSeriesMarkers(candleSeries, []);

    const ema20Series = chart.addSeries(LineSeries, {
      color: '#38BDF8',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const ema50Series = chart.addSeries(LineSeries, {
      color: '#F59E0B',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData) {
        setHoveredCandle(null);
        setHoveredTransition(null);
        return;
      }
      const ohlc = param.seriesData.get(candleSeries) as CandlestickData<UTCTimestamp> | undefined;
      const vol = param.seriesData.get(volumeSeries) as HistogramData<UTCTimestamp> | undefined;
      if (ohlc && typeof param.time === 'number') {
        setHoveredCandle({
          time: param.time,
          open: ohlc.open,
          high: ohlc.high,
          low: ohlc.low,
          close: ohlc.close,
          volume: vol?.value ?? 0,
        });
        setHoveredTransition(transitionMapRef.current.get(param.time) ?? null);
      } else {
        setHoveredTransition(null);
      }
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    markersPluginRef.current = markersPlugin;
    volumeSeriesRef.current = volumeSeries;
    ema20SeriesRef.current = ema20Series;
    ema50SeriesRef.current = ema50Series;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          chart.applyOptions({ width: Math.floor(width), height: Math.floor(height) });
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      markersPlugin.detach();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      markersPluginRef.current = null;
      volumeSeriesRef.current = null;
      ema20SeriesRef.current = null;
      ema50SeriesRef.current = null;
    };
  }, []);

  // Sync tick precision when instrument changes
  useEffect(() => {
    if (!candleSeriesRef.current) return;
    candleSeriesRef.current.applyOptions({
      priceFormat: {
        type: 'price',
        precision: decimals,
        minMove,
      },
    });
  }, [decimals, minMove]);

  // Populate historical candle series + causal EMA 20/50 overlays
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || !chartRef.current) {
      return;
    }

    const ohlcData: CandlestickData<UTCTimestamp>[] = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const volData: HistogramData<UTCTimestamp>[] = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(22, 163, 74, 0.35)' : 'rgba(220, 38, 38, 0.35)',
    }));

    candleSeriesRef.current.setData(ohlcData);
    volumeSeriesRef.current.setData(volData);

    if (ema20SeriesRef.current && ema50SeriesRef.current) {
      if (showEmas && candles.length > 0) {
        const feats = engineerFeatures(candles);
        const ema20Data: LineData<UTCTimestamp>[] = feats.map((f) => ({
          time: f.time as UTCTimestamp,
          value: f.ema20,
        }));
        const ema50Data: LineData<UTCTimestamp>[] = feats.map((f) => ({
          time: f.time as UTCTimestamp,
          value: f.ema50,
        }));
        ema20SeriesRef.current.setData(ema20Data);
        ema50SeriesRef.current.setData(ema50Data);
      } else {
        ema20SeriesRef.current.setData([]);
        ema50SeriesRef.current.setData([]);
      }
    }

    lastBarTimeRef.current = candles.length > 0 ? candles[candles.length - 1].time : 0;

    if (candles.length > 0) {
      chartRef.current.timeScale().fitContent();
    }
  }, [candles, showEmas]);

  // Draw regime change markers on the candle chart
  useEffect(() => {
    if (!markersPluginRef.current) return;
    if (isAlpaca || candles.length === 0 || regimeTransitions.length === 0) {
      markersPluginRef.current.setMarkers([]);
      return;
    }

    const candleTimes = new Set(candles.map((c) => c.time));
    const markers: SeriesMarker<UTCTimestamp>[] = regimeTransitions
      .filter((t) => candleTimes.has(t.time))
      .sort((a, b) => a.time - b.time)
      .map((t) => {
        if (t.toRegime === 'High-Volatility/Shock') {
          return {
            time: t.time as UTCTimestamp,
            position: 'aboveBar',
            color: '#F43F5E',
            shape: 'arrowDown',
            text: 'SHOCK',
          };
        }
        if (t.toRegime === 'Trending') {
          return {
            time: t.time as UTCTimestamp,
            position: 'aboveBar',
            color: '#38BDF8',
            shape: 'arrowUp',
            text: 'TREND',
          };
        }
        return {
          time: t.time as UTCTimestamp,
          position: 'belowBar',
          color: '#10B981',
          shape: 'circle',
          text: 'CALM',
        };
      });

    markersPluginRef.current.setMarkers(markers);
  }, [candles, regimeTransitions, isAlpaca]);

  // Merge streaming WebSocket candle ticks
  useEffect(() => {
    if (!liveCandle || !candleSeriesRef.current || !volumeSeriesRef.current) {
      return;
    }
    if (liveCandle.time < lastBarTimeRef.current) {
      return;
    }
    lastBarTimeRef.current = liveCandle.time;

    candleSeriesRef.current.update({
      time: liveCandle.time as UTCTimestamp,
      open: liveCandle.open,
      high: liveCandle.high,
      low: liveCandle.low,
      close: liveCandle.close,
    });

    volumeSeriesRef.current.update({
      time: liveCandle.time as UTCTimestamp,
      value: liveCandle.volume,
      color:
        liveCandle.close >= liveCandle.open
          ? 'rgba(22, 163, 74, 0.35)'
          : 'rgba(220, 38, 38, 0.35)',
    });
  }, [liveCandle]);

  const activeBar = hoveredCandle || liveCandle || candles[candles.length - 1] || null;
  const activeBarTimeLabel = activeBar
    ? new Date(activeBar.time * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
    : '—';

  return (
    <section
      aria-label="Real Candle Chart"
      className="flex flex-col rounded-lg border border-slate-800/90 bg-[#111A2E]"
    >
      {/* Chart Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 px-5 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Resolution Segmented Buttons */}
          <div className="flex items-center gap-0.5 rounded-md border border-slate-800 bg-[#0B1120] p-0.5">
            {CHART_RESOLUTIONS.map((res) => (
              <button
                key={res}
                type="button"
                disabled={isAlpaca && !alpacaConfigured}
                onClick={() => onChangeResolution(res)}
                className={`rounded px-2.5 py-1 font-mono text-xs font-medium transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  resolution === res
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {res}
              </button>
            ))}
          </div>

          {/* Lookback Window Buttons */}
          <div className="flex items-center gap-0.5 rounded-md border border-slate-800 bg-[#0B1120] p-0.5">
            {LOOKBACK_OPTIONS.map((lb) => (
              <button
                key={lb.id}
                type="button"
                disabled={isAlpaca && !alpacaConfigured}
                onClick={() => onChangeLookback(lb.id)}
                className={`rounded px-2 py-1 font-mono text-xs font-medium transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  lookbackId === lb.id
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {lb.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={isAlpaca && !alpacaConfigured}
            onClick={() => setShowEmas((prev) => !prev)}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
              showEmas
                ? 'border-sky-500/40 bg-sky-950/30 text-sky-300'
                : 'border-slate-800 bg-[#0B1120] text-slate-400 hover:text-slate-200'
            }`}
          >
            EMA 20/50
          </button>

          {isAlpaca ? (
            isAlpacaCrypto ? (
              <span className="rounded-md border border-slate-800 bg-[#0B1120] px-2.5 py-1 font-mono text-xs text-emerald-300">
                US Crypto Feed (Live)
              </span>
            ) : (
              <div
                role="group"
                aria-label="Alpaca stock data feed"
                className="flex items-center gap-0.5 rounded-md border border-slate-800 bg-[#0B1120] p-0.5"
              >
                {ALPACA_FEED_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={!alpacaConfigured}
                    onClick={() => onChangeAlpacaFeed?.(opt.id)}
                    className={`rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                      alpacaFeed === opt.id
                        ? 'bg-slate-800 text-slate-100'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )
          ) : (
            /* Delta Price Basis Toggle */
            <div className="flex items-center gap-0.5 rounded-md border border-slate-800 bg-[#0B1120] p-0.5">
              <button
                type="button"
                onClick={() => onChangeBasis('trade')}
                className={`rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors duration-150 cursor-pointer ${
                  basis === 'trade'
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Trade OHLC
              </button>
              <button
                type="button"
                onClick={() => onChangeBasis('mark')}
                className={`rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors duration-150 cursor-pointer ${
                  basis === 'mark'
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Mark OHLC
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={onRetry}
            disabled={isLoading || (isAlpaca && !alpacaConfigured)}
            title="Reload historical candles"
            aria-label="Reload historical candles"
            className="rounded-md border border-slate-800 bg-[#0B1120] p-1.5 text-slate-400 hover:border-slate-700 hover:text-slate-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* OHLCV Readout Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/60 bg-[#0B1120]/60 px-5 py-2 font-mono text-xs tabular-nums">
        <div className="flex flex-wrap items-center gap-4 text-slate-300">
          <span className="text-slate-400">{activeBarTimeLabel}</span>
          <span>
            O <span className="text-slate-100">{formatPrice(activeBar?.open, tickSize)}</span>
          </span>
          <span>
            H <span className="text-slate-100">{formatPrice(activeBar?.high, tickSize)}</span>
          </span>
          <span>
            L <span className="text-slate-100">{formatPrice(activeBar?.low, tickSize)}</span>
          </span>
          <span>
            C <span className="text-slate-100">{formatPrice(activeBar?.close, tickSize)}</span>
          </span>
          <span>
            V <span className="text-slate-100">{formatNumber(activeBar?.volume, 2)}</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
          {!isAlpaca && phase2Insufficient ? (
            <span className="text-amber-300">Regime: Insufficient data</span>
          ) : !isAlpaca && phase2Regime ? (
            <span className="text-sky-300">
              Regime: {phase2Regime}
              {phase2Score !== null && phase2Score !== undefined
                ? ` (${phase2Score.toFixed(1)}/100)`
                : ''}
            </span>
          ) : (
            !isAlpaca &&
            detectedRegime && (
              <span className="text-sky-300">
                Regime: {detectedRegime}
                {regimeConfidence !== null && regimeConfidence !== undefined
                  ? ` (${Math.round(regimeConfidence * 100)}%)`
                  : ''}
              </span>
            )
          )}
          {isAlpaca && alpacaFeedInfo && (
            <span
              title={alpacaFeedInfo.note}
              className={`rounded border px-2 py-0.5 font-mono text-[10px] ${
                alpacaFeedInfo.isDelayed
                  ? 'border-amber-500/35 bg-amber-950/25 text-amber-300'
                  : 'border-emerald-500/35 bg-emerald-950/25 text-emerald-300'
              }`}
            >
              Feed: {alpacaFeedInfo.label}
              {alpacaFeedInfo.isDelayed ? ` · ${alpacaFeedInfo.delayMinutes}m delay` : ' · Real-time'}
            </span>
          )}
          <span>
            {candles.length} bars · {querySymbol || symbol || '—'}
          </span>
        </div>
      </div>

      {/* Regime Transition Markers Quick Strip (hover or click to inspect exact values) */}
      {!isAlpaca && regimeTransitions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-800/60 bg-[#0B1120]/40 px-5 py-1.5 text-[11px]">
          <span className="text-slate-400 mr-1">
            Regime shifts ({regimeTransitions.length}):
          </span>
          {regimeTransitions.slice(-6).map((tr) => {
            const active =
              (hoveredTransition?.time ??
                hoveredChipTransition?.time ??
                selectedTransition?.time) === tr.time;
            const tLabel = new Date(tr.time * 1000).toISOString().slice(11, 16);
            return (
              <button
                key={tr.time}
                type="button"
                aria-pressed={selectedTransition?.time === tr.time}
                onMouseEnter={() => setHoveredChipTransition(tr)}
                onMouseLeave={() => setHoveredChipTransition(null)}
                onClick={() =>
                  setSelectedTransition((prev) => (prev?.time === tr.time ? null : tr))
                }
                className={`rounded border px-2 py-0.5 font-mono text-[10px] tabular-nums transition-colors cursor-pointer ${
                  active
                    ? 'border-sky-500/60 bg-sky-950/50 text-sky-200'
                    : 'border-slate-800 bg-[#0B1120] text-slate-300 hover:border-slate-700'
                }`}
              >
                {tLabel} {tr.fromRegime} → {tr.toRegime}
              </button>
            );
          })}
        </div>
      )}

      {/* Chart Canvas Area */}
      <div className="relative h-[440px] w-full bg-[#0B1120]">
        <div ref={containerRef} className="h-full w-full" />

        {/* Hover / Inspected Regime Transition Tooltip */}
        {!isAlpaca && (hoveredTransition || hoveredChipTransition || selectedTransition) && (() => {
          const activeTr = (hoveredTransition ?? hoveredChipTransition ?? selectedTransition)!;
          const trTimeLabel =
            new Date(activeTr.time * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
          return (
            <div
              role="status"
              aria-label="Regime Transition Details"
              className="pointer-events-none absolute left-3 top-3 z-20 w-72 rounded-md border border-sky-500/40 bg-[#0F172A]/95 p-3 text-xs shadow-lg backdrop-blur-sm"
            >
              <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5">
                <span className="font-semibold text-slate-100">Regime Change Marker</span>
                <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                  {trTimeLabel}
                </span>
              </div>
              <div className="mt-2 font-mono text-[11px] font-medium text-sky-200">
                {activeTr.fromRegime} → {activeTr.toRegime}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-slate-300">
                <div>
                  Score: <span className="text-slate-100">{activeTr.riskScore.toFixed(1)}/100</span>
                </div>
                <div>
                  Vol Z:{' '}
                  <span className="text-slate-100">
                    {activeTr.volZScore !== null
                      ? `${activeTr.volZScore >= 0 ? '+' : ''}${activeTr.volZScore.toFixed(2)}σ`
                      : '—'}
                  </span>
                </div>
                <div>
                  Short Vol:{' '}
                  <span className="text-slate-100">
                    {activeTr.shortVol !== null
                      ? `${(activeTr.shortVol * 100).toFixed(3)}%`
                      : '—'}
                  </span>
                </div>
                <div>
                  Trend:{' '}
                  <span className="text-slate-100">
                    {activeTr.trendStrength !== null
                      ? `${activeTr.trendStrength >= 0 ? '+' : ''}${activeTr.trendStrength.toFixed(2)}σ`
                      : '—'}
                  </span>
                </div>
                <div>
                  CUSUM:{' '}
                  <span className="text-slate-100">
                    {activeTr.cusumMax !== null ? `${activeTr.cusumMax.toFixed(2)}σ` : '—'}
                    {activeTr.changePointTriggered ? ' *' : ''}
                  </span>
                </div>
                <div>
                  Log Ret:{' '}
                  <span className="text-slate-100">
                    {activeTr.logReturn !== null
                      ? `${activeTr.logReturn >= 0 ? '+' : ''}${(activeTr.logReturn * 100).toFixed(3)}%`
                      : '—'}
                  </span>
                </div>
              </div>
            </div>
          );
        })()}

        {isAlpaca && !alpacaConfigured && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0B1120]/95 p-6">
            <div className="max-w-md rounded-md border border-amber-500/35 bg-amber-950/20 p-5 text-xs text-amber-200 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-amber-100">
                <KeyRound className="h-4 w-4 shrink-0 text-amber-300" />
                <span>Alpaca not configured</span>
              </div>
              <p className="text-amber-200/90 leading-relaxed">
                Alpaca bars chart is disabled because{' '}
                <code className="font-mono text-amber-100">ALPACA_API_KEY_ID</code> and{' '}
                <code className="font-mono text-amber-100">ALPACA_API_SECRET_KEY</code> are not
                set on the server.
              </p>
              <p className="text-[11px] text-amber-300/80">
                Add both secrets to your server environment and restart/refresh to load live
                read-only Alpaca Market Data bars.
              </p>
            </div>
          </div>
        )}

        {(!isAlpaca || alpacaConfigured) && isLoading && candles.length === 0 && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0B1120]/85 text-xs text-slate-300">
            <div className="flex items-center gap-2 font-mono">
              <RefreshCw className="h-4 w-4 animate-spin text-sky-400" />
              <span>
                {isAlpaca
                  ? 'Fetching historical bars from Alpaca Market Data...'
                  : 'Fetching real historical candles from Delta Exchange India...'}
              </span>
            </div>
          </div>
        )}

        {(!isAlpaca || alpacaConfigured) && !isLoading && error && candles.length === 0 && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0B1120]/95 p-6">
            <div className="max-w-md rounded-md border border-rose-500/30 bg-rose-950/20 p-4 text-xs text-rose-200">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                <div className="space-y-1.5">
                  <p className="font-medium text-rose-100">
                    {isAlpaca ? 'Alpaca bars unavailable' : 'Candle data unavailable'}
                  </p>
                  <p className="text-rose-300/90 break-words">{error.message}</p>
                  <p className="font-mono text-[11px] text-rose-400/80 tabular-nums">
                    At {formatTimestamp(error.timestamp)}
                  </p>
                  <button
                    type="button"
                    onClick={onRetry}
                    className="mt-1 rounded border border-rose-500/40 px-3 py-1 text-xs font-medium text-rose-100 hover:bg-rose-900/40 cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {(!isAlpaca || alpacaConfigured) && !isLoading && !error && candles.length === 0 && isAlpaca && !symbol && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0B1120]/90 p-6 text-center">
            <div className="max-w-md space-y-2 text-xs text-slate-300">
              <p className="font-medium text-slate-100">Select an Alpaca symbol to plot bars</p>
              <p className="text-slate-400">
                Choose a symbol from the Alpaca list on the left or enter any stock/crypto ticker
                (such as <span className="font-mono text-slate-200">AAPL</span> or{' '}
                <span className="font-mono text-slate-200">BTC/USD</span>) and click{' '}
                <span className="font-mono text-slate-200">Load</span>.
              </p>
            </div>
          </div>
        )}

        {(!isAlpaca || alpacaConfigured) && !isLoading && !error && candles.length === 0 && symbol && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0B1120]/90 p-6 text-center">
            <div className="max-w-md space-y-2 text-xs text-slate-300">
              <p className="font-medium text-slate-100">
                {isAlpaca
                  ? 'No bars returned by Alpaca Market Data'
                  : `No ${basis === 'trade' ? 'traded' : 'mark'} candles returned by Delta Exchange India`}
              </p>
              <p className="text-slate-400">
                {isAlpaca ? (
                  <>
                    Symbol <span className="font-mono text-slate-200">{querySymbol || symbol}</span>{' '}
                    returned 0 bars for {resolution} ({alpacaFeedInfo?.label || alpacaFeed}) over
                    the selected lookback. Try a wider window (3D–30D) for US equities outside
                    regular market hours.
                  </>
                ) : (
                  <>
                    Contract{' '}
                    <span className="font-mono text-slate-200">{querySymbol || symbol}</span>{' '}
                    returned 0 bars for {resolution} over the selected window.
                  </>
                )}
              </p>
              {!isAlpaca && basis === 'trade' && (
                <button
                  type="button"
                  onClick={() => onChangeBasis('mark')}
                  className="mt-2 rounded border border-sky-500/40 bg-sky-950/30 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-900/40 cursor-pointer"
                >
                  Switch to Mark OHLC (MARK:{symbol})
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Provenance Footer Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 px-5 py-2.5 text-[11px] text-slate-400">
        {isAlpaca ? (
          <>
            <span className="font-mono tabular-nums">
              Source: Alpaca, last updated: {formatTimestamp(fetchedAt)}
            </span>
            <span className="font-mono text-slate-400">
              {alpacaFeedInfo
                ? `${alpacaFeedInfo.label}${
                    alpacaFeedInfo.isDelayed
                      ? ` (${alpacaFeedInfo.delayMinutes}-min delay)`
                      : ' (Real-time)'
                  }`
                : 'Alpaca Market Data v2 (Read-only)'}
            </span>
          </>
        ) : (
          <>
            <span>{source || 'Delta Exchange India REST /v2/history/candles'}</span>
            <span className="font-mono tabular-nums">
              Last updated: {formatTimestamp(fetchedAt)}
            </span>
          </>
        )}
      </div>
    </section>
  );
}
