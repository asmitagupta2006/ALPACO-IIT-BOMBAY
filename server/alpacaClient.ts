import { TtlCache } from './cache.ts';
import type {
  AlpacaAssetClass,
  AlpacaBarsPayload,
  AlpacaHealthResponse,
  AlpacaLatestPayload,
  AlpacaLatestQuote,
  AlpacaLatestTrade,
  AlpacaRawBar,
  AlpacaStockFeed,
  AlpacaSymbolSummary,
  AlpacaSymbolsPayload,
} from '../src/contracts/alpaca.ts';
import type { CandleResolution } from '../src/contracts/delta.ts';
import {
  describeAlpacaFeed,
  detectAlpacaAssetClass,
  mapResolutionToAlpacaTimeframe,
  normalizeAlpacaBars,
} from '../src/utils/alpacaNormalize.ts';

// Strictly Market Data API base URL — NEVER use trading base URLs (api.alpaca.markets / paper-api.alpaca.markets)
export const ALPACA_DATA_BASE = 'https://data.alpaca.markets';

const ALLOWED_ALPACA_MARKET_DATA_PATHS = new Set<string>([
  '/v2/stocks/bars',
  '/v2/stocks/quotes/latest',
  '/v2/stocks/trades/latest',
  '/v2/stocks/snapshots',
  '/v1beta1/screener/stocks/most-actives',
  '/v1beta1/screener/stocks/movers',
  '/v1beta1/screener/crypto/movers',
  '/v1beta3/crypto/us/bars',
  '/v1beta3/crypto/us/latest/quotes',
  '/v1beta3/crypto/us/latest/trades',
]);

const SYMBOLS_TTL_MS = 60_000;
const BARS_TTL_MS = 20_000;
const LATEST_TTL_MS = 5_000;
const MAX_RETRY_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_STOCK_FEED: AlpacaStockFeed = 'iex';

const symbolsCache = new TtlCache<AlpacaSymbolsPayload>(SYMBOLS_TTL_MS, 4);
const barsCache = new TtlCache<AlpacaBarsPayload>(BARS_TTL_MS, 150);
const latestCache = new TtlCache<AlpacaLatestPayload>(LATEST_TTL_MS, 100);

const loggedShapes = new Set<string>();

let lastSuccessAt: string | null = null;
let lastError: string | null = null;

export class AlpacaApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 502, code = 'ALPACA_UPSTREAM_ERROR') {
    super(message);
    this.name = 'AlpacaApiError';
    this.status = status;
    this.code = code;
  }
}

export function isAlpacaConfigured(): boolean {
  const keyId = process.env.ALPACA_API_KEY_ID?.trim();
  const secretKey = process.env.ALPACA_API_SECRET_KEY?.trim();
  return Boolean(keyId && secretKey);
}

function getAlpacaCredentials(): { keyId: string; secretKey: string } {
  const keyId = process.env.ALPACA_API_KEY_ID?.trim() || '';
  const secretKey = process.env.ALPACA_API_SECRET_KEY?.trim() || '';
  if (!keyId || !secretKey) {
    throw new AlpacaApiError(
      'Alpaca not configured: set ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY in server environment secrets.',
      503,
      'ALPACA_NOT_CONFIGURED',
    );
  }
  return { keyId, secretKey };
}

function assertAllowedMarketDataPath(pathAndQuery: string): string {
  const parsed = new URL(pathAndQuery, ALPACA_DATA_BASE);
  if (parsed.origin !== ALPACA_DATA_BASE) {
    throw new AlpacaApiError(
      'Blocked non-market-data Alpaca origin.',
      403,
      'ALPACA_DISALLOWED_ORIGIN',
    );
  }
  if (!ALLOWED_ALPACA_MARKET_DATA_PATHS.has(parsed.pathname)) {
    throw new AlpacaApiError(
      `Disallowed Alpaca path "${parsed.pathname}". Only read-only market-data paths are permitted.`,
      403,
      'ALPACA_DISALLOWED_PATH',
    );
  }
  return parsed.toString();
}

function logShapeOnce(label: string, sample: unknown): void {
  if (loggedShapes.has(label) || sample === undefined || sample === null) {
    return;
  }
  loggedShapes.add(label);
  const keys =
    typeof sample === 'object' && !Array.isArray(sample)
      ? Object.keys(sample as Record<string, unknown>)
      : [];
  console.log(`[AlpacaClient] Inspected ${label} keys:`, keys);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function sanitizeUpstreamMessage(rawText: string, keyId: string, secretKey: string): string {
  let clean = rawText;
  if (keyId) clean = clean.split(keyId).join('[REDACTED]');
  if (secretKey) clean = clean.split(secretKey).join('[REDACTED]');
  return clean.slice(0, 260);
}

async function fetchAlpacaMarketDataJson<T>(pathAndQuery: string): Promise<T> {
  const { keyId, secretKey } = getAlpacaCredentials();
  const fullUrl = assertAllowedMarketDataPath(pathAndQuery);
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(fullUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'APCA-API-KEY-ID': keyId,
          'APCA-API-SECRET-KEY': secretKey,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.status === 429) {
        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
        const waitMs =
          Number.isFinite(retryAfterSec) && retryAfterSec > 0
            ? Math.min(retryAfterSec * 1000, 10_000)
            : 600 * Math.pow(2, attempt - 1);
        if (attempt < MAX_RETRY_ATTEMPTS) {
          await sleep(waitMs);
          continue;
        }
        throw new AlpacaApiError(
          `Alpaca Market Data rate limit reached (HTTP 429) for ${new URL(fullUrl).pathname}`,
          429,
          'ALPACA_RATE_LIMITED',
        );
      }

      if (response.status >= 500 && attempt < MAX_RETRY_ATTEMPTS) {
        await sleep(350 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 120));
        continue;
      }

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        const cleanBody = sanitizeUpstreamMessage(bodyText, keyId, secretKey);
        let parsedMsg = cleanBody;
        try {
          const parsedJson = JSON.parse(cleanBody) as { message?: string; code?: number };
          if (parsedJson.message) parsedMsg = parsedJson.message;
        } catch {
          // keep cleanBody
        }

        const code =
          response.status === 401 || response.status === 403
            ? 'ALPACA_AUTH_OR_PLAN_ERROR'
            : response.status === 404
              ? 'ALPACA_SYMBOL_NOT_FOUND'
              : 'ALPACA_HTTP_ERROR';

        throw new AlpacaApiError(
          `Alpaca Market Data HTTP ${response.status}: ${parsedMsg || response.statusText}`,
          response.status >= 400 && response.status < 500 ? response.status : 502,
          code,
        );
      }

      const json = (await response.json()) as T;
      lastSuccessAt = new Date().toISOString();
      lastError = null;
      return json;
    } catch (err) {
      lastErr = err;
      if (err instanceof AlpacaApiError && err.status >= 400 && err.status < 500 && err.status !== 429) {
        lastError = err.message;
        throw err;
      }
      if (attempt < MAX_RETRY_ATTEMPTS) {
        await sleep(300 * Math.pow(2, attempt - 1));
      }
    }
  }

  const finalError =
    lastErr instanceof AlpacaApiError
      ? lastErr
      : new AlpacaApiError(
          lastErr instanceof Error ? lastErr.message : 'Alpaca Market Data request failed',
          502,
          'ALPACA_NETWORK_ERROR',
        );
  lastError = finalError.message;
  throw finalError;
}

export async function checkAlpacaHealth(): Promise<AlpacaHealthResponse> {
  const checkedAt = new Date().toISOString();
  if (!isAlpacaConfigured()) {
    return {
      configured: false,
      ok: false,
      status: 'not_configured',
      latencyMs: null,
      defaultStockFeed: DEFAULT_STOCK_FEED,
      lastSuccessAt,
      lastError: null,
      cacheStats: {
        symbolsCached: symbolsCache.get('all') !== null,
        barsCacheEntries: barsCache.size,
        latestCacheEntries: latestCache.size,
      },
      checkedAt,
    };
  }

  const started = Date.now();
  try {
    await fetchAlpacaMarketDataJson<unknown>(
      `/v2/stocks/bars?symbols=SPY&timeframe=1Day&limit=1&feed=${DEFAULT_STOCK_FEED}`,
    );
    return {
      configured: true,
      ok: true,
      status: 'connected',
      latencyMs: Date.now() - started,
      defaultStockFeed: DEFAULT_STOCK_FEED,
      lastSuccessAt,
      lastError: null,
      cacheStats: {
        symbolsCached: symbolsCache.get('all') !== null,
        barsCacheEntries: barsCache.size,
        latestCacheEntries: latestCache.size,
      },
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Alpaca health probe failed';
    lastError = message;
    return {
      configured: true,
      ok: false,
      status: 'error',
      latencyMs: Date.now() - started,
      defaultStockFeed: DEFAULT_STOCK_FEED,
      lastSuccessAt,
      lastError: message,
      cacheStats: {
        symbolsCached: symbolsCache.get('all') !== null,
        barsCacheEntries: barsCache.size,
        latestCacheEntries: latestCache.size,
      },
      checkedAt: new Date().toISOString(),
    };
  }
}

interface RawMostActivesResponse {
  last_updated?: string;
  most_actives?: Array<{
    symbol?: string;
    volume?: number;
    trade_count?: number;
  }>;
}

interface RawMoversResponse {
  market_type?: string;
  last_updated?: string;
  gainers?: Array<{
    symbol?: string;
    price?: number;
    change?: number;
    percent_change?: number;
  }>;
  losers?: Array<{
    symbol?: string;
    price?: number;
    change?: number;
    percent_change?: number;
  }>;
}

export async function fetchAlpacaSymbols(): Promise<{
  payload: AlpacaSymbolsPayload;
  cached: boolean;
  fetchedAt: string;
}> {
  if (!isAlpacaConfigured()) {
    throw new AlpacaApiError(
      'Alpaca not configured: set ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY in server environment secrets.',
      503,
      'ALPACA_NOT_CONFIGURED',
    );
  }

  const cached = symbolsCache.get('all');
  if (cached) {
    return {
      payload: cached.value,
      cached: true,
      fetchedAt: new Date(Date.now() - cached.ageMs).toISOString(),
    };
  }

  const [mostActivesRes, stockMoversRes, cryptoMoversRes] = await Promise.allSettled([
    fetchAlpacaMarketDataJson<RawMostActivesResponse>(
      '/v1beta1/screener/stocks/most-actives?by=volume&top=50',
    ),
    fetchAlpacaMarketDataJson<RawMoversResponse>('/v1beta1/screener/stocks/movers?top=25'),
    fetchAlpacaMarketDataJson<RawMoversResponse>('/v1beta1/screener/crypto/movers?top=25'),
  ]);

  const allFailed =
    mostActivesRes.status === 'rejected' &&
    stockMoversRes.status === 'rejected' &&
    cryptoMoversRes.status === 'rejected';

  if (allFailed) {
    const firstErr = mostActivesRes.reason;
    if (firstErr instanceof AlpacaApiError) throw firstErr;
    throw new AlpacaApiError(
      firstErr instanceof Error ? firstErr.message : 'Failed to load Alpaca screener symbols',
      502,
      'ALPACA_SYMBOLS_FAILED',
    );
  }

  const map = new Map<string, AlpacaSymbolSummary>();
  const discoveryNotes: string[] = [];
  let latestUpdated: string | null = null;

  if (mostActivesRes.status === 'fulfilled') {
    const data = mostActivesRes.value;
    logShapeOnce('screener/stocks/most-actives', data);
    if (data.most_actives?.[0]) {
      logShapeOnce('screener/stocks/most-actives.item', data.most_actives[0]);
    }
    if (data.last_updated) latestUpdated = data.last_updated;
    discoveryNotes.push('US Stocks: /v1beta1/screener/stocks/most-actives');
    for (const item of data.most_actives ?? []) {
      if (!item.symbol) continue;
      map.set(item.symbol, {
        symbol: item.symbol,
        assetClass: 'us_equity',
        discoverySource: 'most-actives',
        lastPrice: null,
        volume: toNullableNumber(item.volume),
        percentChange: null,
        tradeCount: toNullableNumber(item.trade_count),
      });
    }
  } else {
    discoveryNotes.push(
      `US most-actives unavailable: ${mostActivesRes.reason instanceof Error ? mostActivesRes.reason.message : 'error'}`,
    );
  }

  if (stockMoversRes.status === 'fulfilled') {
    const data = stockMoversRes.value;
    logShapeOnce('screener/stocks/movers', data);
    if (data.last_updated && (!latestUpdated || data.last_updated > latestUpdated)) {
      latestUpdated = data.last_updated;
    }
    discoveryNotes.push('US Movers: /v1beta1/screener/stocks/movers');
    for (const item of [...(data.gainers ?? []), ...(data.losers ?? [])]) {
      if (!item.symbol) continue;
      const existing = map.get(item.symbol);
      map.set(item.symbol, {
        symbol: item.symbol,
        assetClass: 'us_equity',
        discoverySource: existing ? `${existing.discoverySource}, movers` : 'movers',
        lastPrice: toNullableNumber(item.price),
        volume: existing?.volume ?? null,
        percentChange: toNullableNumber(item.percent_change),
        tradeCount: existing?.tradeCount ?? null,
      });
    }
  }

  if (cryptoMoversRes.status === 'fulfilled') {
    const data = cryptoMoversRes.value;
    logShapeOnce('screener/crypto/movers', data);
    if (data.gainers?.[0]) {
      logShapeOnce('screener/crypto/movers.item', data.gainers[0]);
    }
    if (data.last_updated && (!latestUpdated || data.last_updated > latestUpdated)) {
      latestUpdated = data.last_updated;
    }
    discoveryNotes.push('Crypto Movers: /v1beta1/screener/crypto/movers');
    for (const item of [...(data.gainers ?? []), ...(data.losers ?? [])]) {
      if (!item.symbol) continue;
      map.set(item.symbol, {
        symbol: item.symbol,
        assetClass: 'crypto',
        discoverySource: 'crypto-movers',
        lastPrice: toNullableNumber(item.price),
        volume: null,
        percentChange: toNullableNumber(item.percent_change),
        tradeCount: null,
      });
    }
  }

  const symbols = Array.from(map.values());
  const payload: AlpacaSymbolsPayload = {
    symbols,
    totalCount: symbols.length,
    lastUpdated: latestUpdated,
    discoveryNotes,
  };

  symbolsCache.set('all', payload);
  return {
    payload,
    cached: false,
    fetchedAt: new Date().toISOString(),
  };
}

interface RawAlpacaBarsResponse {
  bars?: Record<string, AlpacaRawBar[]>;
  next_page_token?: string | null;
}

export async function fetchAlpacaBars(params: {
  symbol: string;
  resolution: CandleResolution;
  start: number;
  end: number;
  feed?: AlpacaStockFeed;
}): Promise<{
  payload: AlpacaBarsPayload;
  cached: boolean;
  fetchedAt: string;
}> {
  if (!isAlpacaConfigured()) {
    throw new AlpacaApiError(
      'Alpaca not configured: set ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY in server environment secrets.',
      503,
      'ALPACA_NOT_CONFIGURED',
    );
  }

  const cleanSymbol = params.symbol.trim().toUpperCase();
  const assetClass: AlpacaAssetClass = detectAlpacaAssetClass(cleanSymbol);
  const stockFeed: AlpacaStockFeed = params.feed ?? DEFAULT_STOCK_FEED;
  const feedInfo = describeAlpacaFeed(assetClass, stockFeed);
  const alpacaTimeframe = mapResolutionToAlpacaTimeframe(params.resolution);

  // Respect Alpaca's 15-minute SIP restriction when delayed_sip is chosen
  const nowSec = Math.floor(Date.now() / 1000);
  const effectiveEndSec =
    assetClass === 'us_equity' && stockFeed === 'delayed_sip'
      ? Math.min(params.end, nowSec - 16 * 60)
      : params.end;
  const effectiveStartSec = Math.min(params.start, effectiveEndSec - 60);

  const endBucket = Math.floor(effectiveEndSec / 60) * 60;
  const startBucket = Math.floor(effectiveStartSec / 60) * 60;
  const cacheKey = `${cleanSymbol}:${assetClass}:${params.resolution}:${feedInfo.feed}:${startBucket}:${endBucket}`;
  const cached = barsCache.get(cacheKey);
  if (cached) {
    return {
      payload: cached.value,
      cached: true,
      fetchedAt: new Date(Date.now() - cached.ageMs).toISOString(),
    };
  }

  const startIso = new Date(effectiveStartSec * 1000).toISOString();
  const endIso = new Date(effectiveEndSec * 1000).toISOString();
  const baseEndpoint =
    assetClass === 'crypto' ? '/v1beta3/crypto/us/bars' : '/v2/stocks/bars';

  const rawBars: AlpacaRawBar[] = [];
  let pageToken: string | null = null;
  let hasMorePages = false;
  const maxPages = 4;

  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({
      symbols: cleanSymbol,
      timeframe: alpacaTimeframe,
      start: startIso,
      end: endIso,
      limit: '1000',
      sort: 'asc',
    });
    if (assetClass === 'us_equity') {
      qs.set('feed', stockFeed);
      qs.set('adjustment', 'raw');
    }
    if (pageToken) {
      qs.set('page_token', pageToken);
    }

    const res = await fetchAlpacaMarketDataJson<RawAlpacaBarsResponse>(
      `${baseEndpoint}?${qs.toString()}`,
    );

    logShapeOnce(`${baseEndpoint}.root`, res);
    const symbolBars = res.bars?.[cleanSymbol] ?? [];
    if (symbolBars[0]) {
      logShapeOnce(`${baseEndpoint}.bar`, symbolBars[0]);
    }
    rawBars.push(...symbolBars);

    if (res.next_page_token) {
      pageToken = res.next_page_token;
      hasMorePages = page === maxPages - 1;
    } else {
      hasMorePages = false;
      break;
    }
  }

  const candles = normalizeAlpacaBars(rawBars);
  const payload: AlpacaBarsPayload = {
    symbol: cleanSymbol,
    assetClass,
    resolution: params.resolution,
    alpacaTimeframe,
    feedInfo,
    start: effectiveStartSec,
    end: effectiveEndSec,
    candles,
    nextPageTokenPresent: hasMorePages,
  };

  barsCache.set(cacheKey, payload);
  return {
    payload,
    cached: false,
    fetchedAt: new Date().toISOString(),
  };
}

interface RawQuotesResponse {
  quotes?: Record<
    string,
    {
      t?: string;
      ap?: number;
      as?: number;
      ax?: string;
      bp?: number;
      bs?: number;
      bx?: string;
    }
  >;
}

interface RawTradesResponse {
  trades?: Record<
    string,
    {
      t?: string;
      p?: number;
      s?: number;
      x?: string;
      tks?: string;
    }
  >;
}

export async function fetchAlpacaLatest(params: {
  symbol: string;
  feed?: AlpacaStockFeed;
}): Promise<{
  payload: AlpacaLatestPayload;
  cached: boolean;
  fetchedAt: string;
}> {
  if (!isAlpacaConfigured()) {
    throw new AlpacaApiError(
      'Alpaca not configured: set ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY in server environment secrets.',
      503,
      'ALPACA_NOT_CONFIGURED',
    );
  }

  const cleanSymbol = params.symbol.trim().toUpperCase();
  const assetClass = detectAlpacaAssetClass(cleanSymbol);
  const stockFeed: AlpacaStockFeed = params.feed ?? DEFAULT_STOCK_FEED;
  const feedInfo = describeAlpacaFeed(assetClass, stockFeed);

  const cacheKey = `${cleanSymbol}:${assetClass}:${feedInfo.feed}`;
  const cached = latestCache.get(cacheKey);
  if (cached) {
    return {
      payload: cached.value,
      cached: true,
      fetchedAt: new Date(Date.now() - cached.ageMs).toISOString(),
    };
  }

  const quotesEndpoint =
    assetClass === 'crypto'
      ? '/v1beta3/crypto/us/latest/quotes'
      : '/v2/stocks/quotes/latest';
  const tradesEndpoint =
    assetClass === 'crypto'
      ? '/v1beta3/crypto/us/latest/trades'
      : '/v2/stocks/trades/latest';

  const qs = new URLSearchParams({ symbols: cleanSymbol });
  if (assetClass === 'us_equity') {
    qs.set('feed', stockFeed);
  }

  const [quoteRes, tradeRes] = await Promise.all([
    fetchAlpacaMarketDataJson<RawQuotesResponse>(`${quotesEndpoint}?${qs.toString()}`),
    fetchAlpacaMarketDataJson<RawTradesResponse>(`${tradesEndpoint}?${qs.toString()}`),
  ]);

  logShapeOnce(`${quotesEndpoint}.root`, quoteRes);
  logShapeOnce(`${tradesEndpoint}.root`, tradeRes);

  const rawQuote = quoteRes.quotes?.[cleanSymbol] ?? null;
  const rawTrade = tradeRes.trades?.[cleanSymbol] ?? null;

  if (rawQuote) logShapeOnce(`${quotesEndpoint}.item`, rawQuote);
  if (rawTrade) logShapeOnce(`${tradesEndpoint}.item`, rawTrade);

  const quote: AlpacaLatestQuote | null = rawQuote
    ? {
        timestamp: rawQuote.t ?? null,
        askPrice: toNullableNumber(rawQuote.ap),
        askSize: toNullableNumber(rawQuote.as),
        askExchange: rawQuote.ax ?? null,
        bidPrice: toNullableNumber(rawQuote.bp),
        bidSize: toNullableNumber(rawQuote.bs),
        bidExchange: rawQuote.bx ?? null,
      }
    : null;

  const trade: AlpacaLatestTrade | null = rawTrade
    ? {
        timestamp: rawTrade.t ?? null,
        price: toNullableNumber(rawTrade.p),
        size: toNullableNumber(rawTrade.s),
        exchange: rawTrade.x ?? null,
        takerSide: rawTrade.tks ?? null,
      }
    : null;

  const payload: AlpacaLatestPayload = {
    symbol: cleanSymbol,
    assetClass,
    feedInfo,
    quote,
    trade,
  };

  latestCache.set(cacheKey, payload);
  return {
    payload,
    cached: false,
    fetchedAt: new Date().toISOString(),
  };
}
