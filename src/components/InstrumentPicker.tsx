import { useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  KeyRound,
  RefreshCw,
  Search,
  WifiOff,
} from 'lucide-react';
import type {
  AlpacaHealthResponse,
  AlpacaSymbolSummary,
  MarketDataSource,
} from '../contracts/alpaca';
import type { DeltaProductSummary } from '../contracts/delta';
import {
  formatContractTypeLabel,
  formatNumber,
  formatPercent,
  formatPrice,
  formatTimestamp,
} from '../utils/format';

interface InstrumentPickerProps {
  dataSource: MarketDataSource;
  onChangeDataSource: (source: MarketDataSource) => void;
  // Delta props
  products: DeltaProductSummary[];
  underlyings: string[];
  selectedSymbol: string | null;
  onSelectSymbol: (symbol: string) => void;
  isLoading: boolean;
  error: { message: string; timestamp: string } | null;
  source: string | null;
  fetchedAt: string | null;
  onRetry: () => void;
  // Alpaca props
  alpacaHealth: AlpacaHealthResponse | null;
  alpacaCheckingHealth: boolean;
  onRefreshAlpacaHealth: () => void;
  alpacaSymbols: AlpacaSymbolSummary[];
  alpacaSelectedSymbol: string | null;
  onSelectAlpacaSymbol: (symbol: string) => void;
  alpacaLoading: boolean;
  alpacaError: { message: string; timestamp: string } | null;
  alpacaFetchedAt: string | null;
  onRetryAlpacaSymbols: () => void;
}

type DeltaTypeFilter = 'all' | 'perpetual_futures' | 'call_options' | 'put_options';
type AlpacaClassFilter = 'all' | 'us_equity' | 'crypto';

const DELTA_TYPE_TABS: ReadonlyArray<{ id: DeltaTypeFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'perpetual_futures', label: 'Perpetuals' },
  { id: 'call_options', label: 'Calls' },
  { id: 'put_options', label: 'Puts' },
];

const ALPACA_CLASS_TABS: ReadonlyArray<{ id: AlpacaClassFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'us_equity', label: 'US Stocks' },
  { id: 'crypto', label: 'Crypto' },
];

const MAX_VISIBLE_ROWS = 200;

export function InstrumentPicker({
  dataSource,
  onChangeDataSource,
  products,
  underlyings,
  selectedSymbol,
  onSelectSymbol,
  isLoading,
  error,
  source,
  fetchedAt,
  onRetry,
  alpacaHealth,
  alpacaCheckingHealth,
  onRefreshAlpacaHealth,
  alpacaSymbols,
  alpacaSelectedSymbol,
  onSelectAlpacaSymbol,
  alpacaLoading,
  alpacaError,
  alpacaFetchedAt,
  onRetryAlpacaSymbols,
}: InstrumentPickerProps) {
  const [typeFilter, setTypeFilter] = useState<DeltaTypeFilter>('all');
  const [underlyingFilter, setUnderlyingFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [alpacaClassFilter, setAlpacaClassFilter] = useState<AlpacaClassFilter>('all');
  const [alpacaQuery, setAlpacaQuery] = useState<string>('');

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (typeFilter !== 'all' && p.contractType !== typeFilter) return false;
      if (underlyingFilter !== 'ALL' && p.underlyingSymbol !== underlyingFilter) return false;
      if (q) {
        const symMatch = p.symbol.toLowerCase().includes(q);
        const descMatch = p.description.toLowerCase().includes(q);
        if (!symMatch && !descMatch) return false;
      }
      return true;
    });
  }, [products, typeFilter, underlyingFilter, searchQuery]);

  const visibleProducts = useMemo(
    () => filteredProducts.slice(0, MAX_VISIBLE_ROWS),
    [filteredProducts],
  );

  const filteredAlpacaSymbols = useMemo(() => {
    const q = alpacaQuery.trim().toLowerCase();
    return alpacaSymbols.filter((item) => {
      if (alpacaClassFilter !== 'all' && item.assetClass !== alpacaClassFilter) return false;
      if (q && !item.symbol.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [alpacaSymbols, alpacaClassFilter, alpacaQuery]);

  const alpacaConfigured = alpacaHealth?.configured ?? false;

  // Alpaca connection-health indicator badge
  let alpacaHealthLabel = 'Checking';
  let alpacaHealthClass = 'border-slate-700 bg-[#0B1120] text-slate-300';
  let AlpacaHealthIcon = Activity;
  if (alpacaHealth) {
    if (!alpacaHealth.configured) {
      alpacaHealthLabel = 'Alpaca: Not Configured';
      alpacaHealthClass = 'border-amber-500/35 bg-amber-950/25 text-amber-300';
      AlpacaHealthIcon = KeyRound;
    } else if (alpacaHealth.ok) {
      alpacaHealthLabel = `Alpaca: Connected${alpacaHealth.latencyMs !== null ? ` · ${alpacaHealth.latencyMs}ms` : ''}`;
      alpacaHealthClass = 'border-emerald-500/35 bg-emerald-950/25 text-emerald-300';
      AlpacaHealthIcon = Activity;
    } else {
      alpacaHealthLabel = 'Alpaca: Error';
      alpacaHealthClass = 'border-rose-500/40 bg-rose-950/25 text-rose-300';
      AlpacaHealthIcon = WifiOff;
    }
  }

  const handleDirectAlpacaSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!alpacaConfigured) return;
    const trimmed = alpacaQuery.trim().toUpperCase();
    if (trimmed) {
      onSelectAlpacaSymbol(trimmed);
    }
  };

  return (
    <aside
      aria-label="Instrument Picker"
      className="flex flex-col rounded-lg border border-slate-800/90 bg-[#111A2E] lg:h-[calc(100vh-148px)] lg:min-h-[620px]"
    >
      <div className="border-b border-slate-800/80 px-4 py-3.5 space-y-3">
        {/* Header + Refresh */}
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-semibold text-slate-100">
            Instruments
          </h2>
          <button
            type="button"
            onClick={dataSource === 'delta' ? onRetry : onRetryAlpacaSymbols}
            disabled={dataSource === 'delta' ? isLoading : alpacaLoading || !alpacaConfigured}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-800/70 hover:text-slate-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw
              className={`h-3 w-3 ${
                (dataSource === 'delta' ? isLoading : alpacaLoading) ? 'animate-spin' : ''
              }`}
            />
            <span>Refresh</span>
          </button>
        </div>

        {/* Data Source Selector (Delta / Alpaca) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-slate-400">Market Source</span>
            <button
              type="button"
              onClick={onRefreshAlpacaHealth}
              disabled={alpacaCheckingHealth}
              title={
                alpacaHealth?.lastError
                  ? `Alpaca error: ${alpacaHealth.lastError}`
                  : `Checked: ${formatTimestamp(alpacaHealth?.checkedAt)}`
              }
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums cursor-pointer hover:brightness-110 ${alpacaHealthClass}`}
            >
              <AlpacaHealthIcon className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
              <span>{alpacaHealthLabel}</span>
            </button>
          </div>
          <div
            role="group"
            aria-label="Market data source selector"
            className="grid grid-cols-2 gap-1 rounded-md border border-slate-800/80 bg-[#0B1120] p-1"
          >
            <button
              type="button"
              onClick={() => onChangeDataSource('delta')}
              aria-pressed={dataSource === 'delta'}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                dataSource === 'delta'
                  ? 'bg-sky-500/20 text-sky-200 border border-sky-500/40'
                  : 'text-slate-400 border border-transparent hover:text-slate-200'
              }`}
            >
              Delta Exchange
            </button>
            <button
              type="button"
              onClick={() => onChangeDataSource('alpaca')}
              aria-pressed={dataSource === 'alpaca'}
              className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                dataSource === 'alpaca'
                  ? 'bg-sky-500/20 text-sky-200 border border-sky-500/40'
                  : 'text-slate-400 border border-transparent hover:text-slate-200'
              }`}
            >
              Alpaca
            </button>
          </div>
        </div>

        {/* Source-specific filters */}
        {dataSource === 'delta' ? (
          <>
            <div className="grid grid-cols-4 gap-1 rounded-md bg-[#0B1120] p-1 border border-slate-800/70">
              {DELTA_TYPE_TABS.map((tab) => {
                const active = typeFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setTypeFilter(tab.id)}
                    className={`rounded px-2 py-1.5 text-xs font-medium whitespace-nowrap transition-colors duration-150 cursor-pointer ${
                      active
                        ? 'bg-slate-800 text-slate-100'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search symbol..."
                  aria-label="Search instrument symbol"
                  className="w-full rounded-md border border-slate-800 bg-[#0B1120] py-1.5 pl-8 pr-2.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500/70 focus:outline-none"
                />
              </div>
              <select
                value={underlyingFilter}
                onChange={(e) => setUnderlyingFilter(e.target.value)}
                aria-label="Filter by underlying asset"
                className="rounded-md border border-slate-800 bg-[#0B1120] px-2.5 py-1.5 font-mono text-xs text-slate-200 focus:border-sky-500/70 focus:outline-none cursor-pointer"
              >
                <option value="ALL">All Assets</option>
                {underlyings.map((asset) => (
                  <option key={asset} value={asset}>
                    {asset}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono tabular-nums">
              <span>{filteredProducts.length.toLocaleString()} live contracts</span>
              {filteredProducts.length > MAX_VISIBLE_ROWS && (
                <span>Showing {MAX_VISIBLE_ROWS}</span>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-1 rounded-md bg-[#0B1120] p-1 border border-slate-800/70">
              {ALPACA_CLASS_TABS.map((tab) => {
                const active = alpacaClassFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    disabled={!alpacaConfigured}
                    onClick={() => setAlpacaClassFilter(tab.id)}
                    className={`rounded px-2 py-1.5 text-xs font-medium whitespace-nowrap transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                      active
                        ? 'bg-slate-800 text-slate-100'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <form onSubmit={handleDirectAlpacaSubmit} className="flex items-center gap-1.5">
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={alpacaQuery}
                  onChange={(e) => setAlpacaQuery(e.target.value)}
                  disabled={!alpacaConfigured}
                  placeholder="Filter or load (AAPL, BTC/USD)"
                  aria-label="Filter or enter Alpaca symbol"
                  className="w-full rounded-md border border-slate-800 bg-[#0B1120] py-1.5 pl-8 pr-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500/70 focus:outline-none disabled:opacity-50"
                />
              </div>
              <button
                type="submit"
                disabled={!alpacaConfigured || !alpacaQuery.trim()}
                className="rounded-md border border-sky-500/40 bg-sky-950/35 px-2.5 py-1.5 text-xs font-medium text-sky-200 hover:bg-sky-900/45 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed shrink-0"
              >
                Load
              </button>
            </form>

            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono tabular-nums">
              <span>
                {alpacaConfigured
                  ? `${filteredAlpacaSymbols.length} live Alpaca symbols`
                  : 'Alpaca features disabled'}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Scrollable Instrument List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
        {dataSource === 'delta' ? (
          isLoading && products.length === 0 ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, idx) => (
                <div
                  key={idx}
                  className="h-11 animate-pulse rounded border border-slate-800/60 bg-slate-900/50"
                />
              ))}
            </div>
          ) : error && products.length === 0 ? (
            <div className="p-4">
              <div className="rounded-md border border-rose-500/30 bg-rose-950/20 p-3 text-xs text-rose-300">
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                  <div className="space-y-1">
                    <p className="font-medium text-rose-200">Failed to load Delta products</p>
                    <p className="text-rose-300/90 break-words">{error.message}</p>
                    <p className="font-mono text-[11px] text-rose-400/80 tabular-nums">
                      At {formatTimestamp(error.timestamp)}
                    </p>
                    <button
                      type="button"
                      onClick={onRetry}
                      className="mt-2 rounded border border-rose-500/40 bg-rose-950/40 px-2.5 py-1 text-xs font-medium text-rose-200 hover:bg-rose-900/50 cursor-pointer"
                    >
                      Retry Request
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : visibleProducts.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">
              <p>No live contracts match your active filters.</p>
              <button
                type="button"
                onClick={() => {
                  setTypeFilter('all');
                  setUnderlyingFilter('ALL');
                  setSearchQuery('');
                }}
                className="mt-2.5 rounded border border-slate-700 px-3 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                Clear Filters
              </button>
            </div>
          ) : (
            visibleProducts.map((product) => {
              const isSelected = product.symbol === selectedSymbol;
              const isOption =
                product.contractType === 'call_options' ||
                product.contractType === 'put_options';

              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => onSelectSymbol(product.symbol)}
                  className={`w-full px-4 py-2.5 text-left transition-colors duration-100 cursor-pointer ${
                    isSelected
                      ? 'bg-sky-950/40 text-slate-100'
                      : 'hover:bg-slate-800/40 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold tracking-tight text-slate-100 truncate">
                      {product.symbol}
                    </span>
                    <span className="font-mono text-[11px] text-slate-400 shrink-0 tabular-nums">
                      {product.underlyingSymbol}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-400 truncate">
                    <span>{formatContractTypeLabel(product.contractType)}</span>
                    <span aria-hidden="true">·</span>
                    {isOption && product.strikePrice ? (
                      <span className="font-mono tabular-nums">
                        Strike {product.strikePrice}
                      </span>
                    ) : product.defaultLeverage ? (
                      <span className="font-mono tabular-nums">
                        {Number(product.defaultLeverage)}x max
                      </span>
                    ) : (
                      <span className="truncate">{product.description}</span>
                    )}
                    {product.tradingStatus !== 'operational' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-amber-400">{product.tradingStatus}</span>
                      </>
                    )}
                  </div>
                </button>
              );
            })
          )
        ) : !alpacaConfigured ? (
          <div className="p-4">
            <div className="rounded-md border border-amber-500/35 bg-amber-950/20 p-3.5 text-xs text-amber-200 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-amber-100">
                <KeyRound className="h-4 w-4 shrink-0 text-amber-300" />
                <span>Alpaca not configured</span>
              </div>
              <p className="text-amber-200/90 leading-relaxed">
                Set <code className="font-mono text-amber-100">ALPACA_API_KEY_ID</code> and{' '}
                <code className="font-mono text-amber-100">ALPACA_API_SECRET_KEY</code> in server
                environment variables/secrets to enable read-only Alpaca market data.
              </p>
              <p className="text-[11px] text-amber-300/80">
                Delta Exchange features remain fully active. Switch back to Delta Exchange at any
                time.
              </p>
            </div>
          </div>
        ) : alpacaLoading && alpacaSymbols.length === 0 ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, idx) => (
              <div
                key={idx}
                className="h-11 animate-pulse rounded border border-slate-800/60 bg-slate-900/50"
              />
            ))}
          </div>
        ) : alpacaError && alpacaSymbols.length === 0 ? (
          <div className="p-4">
            <div className="rounded-md border border-rose-500/30 bg-rose-950/20 p-3 text-xs text-rose-300">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                <div className="space-y-1">
                  <p className="font-medium text-rose-200">Failed to load Alpaca symbols</p>
                  <p className="text-rose-300/90 break-words">{alpacaError.message}</p>
                  <p className="font-mono text-[11px] text-rose-400/80 tabular-nums">
                    At {formatTimestamp(alpacaError.timestamp)}
                  </p>
                  <button
                    type="button"
                    onClick={onRetryAlpacaSymbols}
                    className="mt-2 rounded border border-rose-500/40 bg-rose-950/40 px-2.5 py-1 text-xs font-medium text-rose-200 hover:bg-rose-900/50 cursor-pointer"
                  >
                    Retry Request
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : filteredAlpacaSymbols.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400 space-y-2">
            <p>No discovered screener symbols match &ldquo;{alpacaQuery}&rdquo;.</p>
            {alpacaQuery.trim() && (
              <button
                type="button"
                onClick={() => onSelectAlpacaSymbol(alpacaQuery.trim().toUpperCase())}
                className="rounded border border-sky-500/40 bg-sky-950/30 px-3 py-1.5 text-xs font-medium text-sky-200 hover:bg-sky-900/40 cursor-pointer"
              >
                Query Bars for {alpacaQuery.trim().toUpperCase()}
              </button>
            )}
          </div>
        ) : (
          filteredAlpacaSymbols.map((item) => {
            const isSelected = item.symbol === alpacaSelectedSymbol;
            return (
              <button
                key={item.symbol}
                type="button"
                onClick={() => onSelectAlpacaSymbol(item.symbol)}
                className={`w-full px-4 py-2.5 text-left transition-colors duration-100 cursor-pointer ${
                  isSelected
                    ? 'bg-sky-950/40 text-slate-100'
                    : 'hover:bg-slate-800/40 text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold tracking-tight text-slate-100 truncate">
                    {item.symbol}
                  </span>
                  <span className="font-mono text-[11px] text-slate-400 shrink-0">
                    {item.assetClass === 'crypto' ? 'Crypto' : 'US Equity'}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-slate-400 font-mono tabular-nums">
                  <span className="font-sans truncate">{item.discoverySource}</span>
                  {item.percentChange !== null ? (
                    <span
                      className={
                        item.percentChange >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }
                    >
                      {formatPercent(item.percentChange, 2)}
                    </span>
                  ) : item.volume !== null ? (
                    <span>Vol {formatNumber(item.volume, 0)}</span>
                  ) : item.lastPrice !== null ? (
                    <span>{formatPrice(item.lastPrice, 2)}</span>
                  ) : null}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Source & Timestamp Provenance */}
      <div className="border-t border-slate-800/80 px-4 py-2.5 text-[11px] text-slate-400">
        {dataSource === 'delta' ? (
          <>
            <div className="truncate">{source || 'Source: Delta Exchange India /v2/products'}</div>
            <div className="mt-0.5 font-mono tabular-nums text-slate-500">
              Last updated: {formatTimestamp(fetchedAt)}
            </div>
          </>
        ) : (
          <div className="font-mono tabular-nums truncate">
            Source: Alpaca, last updated: {formatTimestamp(alpacaFetchedAt)}
          </div>
        )}
      </div>
    </aside>
  );
}
