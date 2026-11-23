import type { CandleResolution, DeltaCandle } from './delta';

export type MarketDataSource = 'delta' | 'alpaca';

export type AlpacaAssetClass = 'us_equity' | 'crypto';

export type AlpacaStockFeed = 'iex' | 'delayed_sip' | 'sip';

export interface AlpacaFeedInfo {
  feed: AlpacaStockFeed | 'us';
  label: string;
  isDelayed: boolean;
  delayMinutes: number;
  note: string;
}

export interface AlpacaRawBar {
  t: string;
  o: number | string;
  h: number | string;
  l: number | string;
  c: number | string;
  v: number | string;
  vw?: number | string;
  n?: number | string;
}

export interface AlpacaSymbolSummary {
  symbol: string;
  assetClass: AlpacaAssetClass;
  discoverySource: string; // e.g., 'screener/stocks/most-actives', 'screener/stocks/movers', 'screener/crypto/movers'
  lastPrice: number | null;
  volume: number | null;
  percentChange: number | null;
  tradeCount: number | null;
}

export interface AlpacaSymbolsPayload {
  symbols: AlpacaSymbolSummary[];
  totalCount: number;
  lastUpdated: string | null;
  discoveryNotes: string[];
}

export interface AlpacaBarsPayload {
  symbol: string;
  assetClass: AlpacaAssetClass;
  resolution: CandleResolution;
  alpacaTimeframe: string;
  feedInfo: AlpacaFeedInfo;
  start: number;
  end: number;
  candles: DeltaCandle[];
  nextPageTokenPresent: boolean;
}

export interface AlpacaLatestQuote {
  timestamp: string | null;
  askPrice: number | null;
  askSize: number | null;
  askExchange: string | null;
  bidPrice: number | null;
  bidSize: number | null;
  bidExchange: string | null;
}

export interface AlpacaLatestTrade {
  timestamp: string | null;
  price: number | null;
  size: number | null;
  exchange: string | null;
  takerSide: string | null;
}

export interface AlpacaLatestPayload {
  symbol: string;
  assetClass: AlpacaAssetClass;
  feedInfo: AlpacaFeedInfo;
  quote: AlpacaLatestQuote | null;
  trade: AlpacaLatestTrade | null;
}

export interface AlpacaHealthResponse {
  configured: boolean;
  ok: boolean;
  status: 'not_configured' | 'connected' | 'error';
  latencyMs: number | null;
  defaultStockFeed: AlpacaStockFeed;
  lastSuccessAt: string | null;
  lastError: string | null;
  cacheStats: {
    symbolsCached: boolean;
    barsCacheEntries: number;
    latestCacheEntries: number;
  };
  checkedAt: string;
}
