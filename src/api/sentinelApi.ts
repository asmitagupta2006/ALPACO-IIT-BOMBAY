import type { ApiErrorResponse, CandleResolution } from '../contracts/delta';
import type {
  AuditLogEntry,
  DatasetQualityReport,
  SentinelOverviewResponse,
} from '../contracts/sentinel';

export interface SentinelDbStats {
  dbPath: string;
  datasetAudits: number;
  auditLogs: number;
}

export class SentinelRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly source: string;
  readonly timestamp: string;

  constructor(payload: ApiErrorResponse) {
    super(payload.error);
    this.name = 'SentinelRequestError';
    this.status = payload.status;
    this.code = payload.code;
    this.source = payload.source;
    this.timestamp = payload.timestamp;
  }
}

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SentinelRequestError({
      error: `Invalid JSON response (${res.status}) from ${url}`,
      code: 'INVALID_JSON',
      status: res.status,
      source: 'Regime Sentinel API',
      timestamp: new Date().toISOString(),
    });
  }
  if (!res.ok) {
    const err = parsed as Partial<ApiErrorResponse>;
    throw new SentinelRequestError({
      error: err.error || `Request failed with HTTP ${res.status}`,
      code: err.code || `HTTP_${res.status}`,
      status: res.status,
      source: err.source || 'Regime Sentinel API',
      timestamp: err.timestamp || new Date().toISOString(),
    });
  }
  return parsed as T;
}

export function fetchSentinelOverview(params: {
  symbol: string;
  resolution: CandleResolution;
  signal?: AbortSignal;
}): Promise<SentinelOverviewResponse> {
  const qs = new URLSearchParams({
    symbol: params.symbol,
    resolution: params.resolution,
  });
  return apiRequest<SentinelOverviewResponse>(`/api/sentinel/overview?${qs.toString()}`, {
    signal: params.signal,
  });
}

export function fetchDataAudit(params: {
  symbol: string;
  resolution: CandleResolution;
  signal?: AbortSignal;
}): Promise<{ report: DatasetQualityReport; dbStats: SentinelDbStats }> {
  const qs = new URLSearchParams({
    symbol: params.symbol,
    resolution: params.resolution,
  });
  return apiRequest(`/api/sentinel/data/audit?${qs.toString()}`, {
    signal: params.signal,
  });
}

export function fetchAuditLogs(
  eventType = 'all',
  signal?: AbortSignal,
): Promise<{
  logs: AuditLogEntry[];
  dbStats: SentinelDbStats;
}> {
  const qs = new URLSearchParams({ eventType });
  return apiRequest(`/api/sentinel/audit?${qs.toString()}`, { signal });
}
