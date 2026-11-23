import type {
  AlpacaBarsPayload,
  AlpacaHealthResponse,
  AlpacaLatestPayload,
  AlpacaStockFeed,
  AlpacaSymbolsPayload,
} from '../contracts/alpaca';
import type {
  ApiEnvelope,
  ApiErrorResponse,
  CandleResolution,
} from '../contracts/delta';

export class AlpacaClientRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly timestamp: string;

  constructor(message: string, code: string, status: number, timestamp: string) {
    super(message);
    this.name = 'AlpacaClientRequestError';
    this.code = code;
    this.status = status;
    this.timestamp = timestamp;
  }
}

async function requestAlpacaJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    if (!response.ok) {
      throw new AlpacaClientRequestError(
        `HTTP ${response.status} from ${url}`,
        'ALPACA_HTTP_ERROR',
        response.status,
        new Date().toISOString(),
      );
    }
    throw new AlpacaClientRequestError(
      `Invalid JSON response from ${url}`,
      'ALPACA_INVALID_JSON',
      response.status,
      new Date().toISOString(),
    );
  }

  if (!response.ok) {
    const errPayload = parsed as Partial<ApiErrorResponse>;
    throw new AlpacaClientRequestError(
      errPayload.error || `Alpaca request failed with HTTP ${response.status}`,
      errPayload.code || 'ALPACA_REQUEST_FAILED',
      errPayload.status || response.status,
      errPayload.timestamp || new Date().toISOString(),
    );
  }

  return parsed as T;
}

export function fetchAlpacaHealth(signal?: AbortSignal): Promise<AlpacaHealthResponse> {
  return requestAlpacaJson<AlpacaHealthResponse>('/api/alpaca/health', signal);
}

export function fetchAlpacaSymbols(
  params?: { q?: string; assetClass?: 'all' | 'us_equity' | 'crypto' },
  signal?: AbortSignal,
): Promise<ApiEnvelope<AlpacaSymbolsPayload>> {
  const qs = new URLSearchParams();
  if (params?.q) qs.set('q', params.q);
  if (params?.assetClass) qs.set('assetClass', params.assetClass);
  const query = qs.toString();
  return requestAlpacaJson<ApiEnvelope<AlpacaSymbolsPayload>>(
    `/api/alpaca/symbols${query ? `?${query}` : ''}`,
    signal,
  );
}

export function fetchAlpacaBars(
  params: {
    symbol: string;
    resolution: CandleResolution;
    start: number;
    end: number;
    feed: AlpacaStockFeed;
  },
  signal?: AbortSignal,
): Promise<ApiEnvelope<AlpacaBarsPayload>> {
  const qs = new URLSearchParams({
    symbol: params.symbol,
    resolution: params.resolution,
    start: String(params.start),
    end: String(params.end),
    feed: params.feed,
  });
  return requestAlpacaJson<ApiEnvelope<AlpacaBarsPayload>>(
    `/api/alpaca/bars?${qs.toString()}`,
    signal,
  );
}

export function fetchAlpacaLatest(
  params: { symbol: string; feed: AlpacaStockFeed },
  signal?: AbortSignal,
): Promise<ApiEnvelope<AlpacaLatestPayload>> {
  const qs = new URLSearchParams({
    symbol: params.symbol,
    feed: params.feed,
  });
  return requestAlpacaJson<ApiEnvelope<AlpacaLatestPayload>>(
    `/api/alpaca/latest?${qs.toString()}`,
    signal,
  );
}
