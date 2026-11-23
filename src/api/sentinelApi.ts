import type { CandleResolution } from '../contracts/delta';
import type {
  AlertSeverity,
  AuditLogEntry,
  DatasetQualityReport,
  ExplainablePrediction,
  GuardrailConfig,
  ModelVersionRecord,
  PaperSimulationRequest,
  PaperSimulationResult,
  RegimeTransitionAlert,
  SentinelOverviewResponse,
} from '../contracts/sentinel';

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
    throw new Error(`Invalid JSON response (${res.status}) from ${url}`);
  }
  if (!res.ok) {
    const err = parsed as { error?: string };
    throw new Error(err.error || `Request failed with HTTP ${res.status}`);
  }
  return parsed as T;
}

export function fetchSentinelOverview(params: {
  symbol: string;
  resolution: CandleResolution;
  mode: 'live' | 'demo';
  signal?: AbortSignal;
}): Promise<SentinelOverviewResponse> {
  const qs = new URLSearchParams({
    symbol: params.symbol,
    resolution: params.resolution,
    mode: params.mode,
  });
  return apiRequest<SentinelOverviewResponse>(`/api/sentinel/overview?${qs.toString()}`, {
    signal: params.signal,
  });
}

export function fetchDataAudit(params: {
  symbol: string;
  resolution: CandleResolution;
  mode: 'live' | 'demo';
}): Promise<{ report: DatasetQualityReport; dbStats: Record<string, unknown> }> {
  const qs = new URLSearchParams({
    symbol: params.symbol,
    resolution: params.resolution,
    mode: params.mode,
  });
  return apiRequest(`/api/sentinel/data/audit?${qs.toString()}`);
}

export function fetchAlerts(params?: {
  severity?: AlertSeverity;
  symbol?: string;
}): Promise<{ alerts: RegimeTransitionAlert[] }> {
  const qs = new URLSearchParams();
  if (params?.severity) qs.set('severity', params.severity);
  if (params?.symbol) qs.set('symbol', params.symbol);
  return apiRequest(`/api/sentinel/alerts?${qs.toString()}`);
}

export function acknowledgeAlert(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`/api/sentinel/alerts/${encodeURIComponent(id)}/ack`, {
    method: 'POST',
  });
}

export function fetchExplanation(params: {
  symbol: string;
  resolution: CandleResolution;
  strategyId: string;
  mode: 'live' | 'demo';
  gemini?: boolean;
}): Promise<ExplainablePrediction> {
  const qs = new URLSearchParams({
    symbol: params.symbol,
    resolution: params.resolution,
    strategyId: params.strategyId,
    mode: params.mode,
    gemini: params.gemini ? '1' : '0',
  });
  return apiRequest<ExplainablePrediction>(`/api/sentinel/explain?${qs.toString()}`);
}

export function updateGuardrailConfig(config: GuardrailConfig): Promise<{ guardrail: GuardrailConfig }> {
  return apiRequest(`/api/sentinel/guardrails/${encodeURIComponent(config.strategyId)}`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

export function triggerKillSwitch(params: {
  confirmed: boolean;
  reason: string;
}): Promise<{ guardrails: GuardrailConfig[]; auditLog: AuditLogEntry }> {
  return apiRequest('/api/sentinel/guardrails/kill-switch', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export function resumeStrategies(confirmed: boolean): Promise<{
  guardrails: GuardrailConfig[];
  auditLog: AuditLogEntry;
}> {
  return apiRequest('/api/sentinel/guardrails/resume', {
    method: 'POST',
    body: JSON.stringify({ confirmed }),
  });
}

export function runPaperSimulationApi(
  req: PaperSimulationRequest,
): Promise<PaperSimulationResult> {
  return apiRequest<PaperSimulationResult>('/api/sentinel/paper/simulate', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export function fetchPaperHistory(): Promise<{ runs: PaperSimulationResult[] }> {
  return apiRequest('/api/sentinel/paper/history');
}

export interface TrainingStatusResponse {
  trainingInProgress: boolean;
  datasetReport: DatasetQualityReport;
  liveDriftPsi: number;
  liveDriftStatus: 'Nominal' | 'Moderate Shift' | 'Drift Alert';
  regimeModels: ModelVersionRecord[];
  riskModels: ModelVersionRecord[];
  dbStats: {
    dbPath: string;
    storedCandles: number;
    modelVersions: number;
    regimeAlerts: number;
    auditLogs: number;
    paperRuns: number;
  };
}

export function fetchTrainingStatus(
  symbol: string,
  resolution: CandleResolution,
): Promise<TrainingStatusResponse> {
  const qs = new URLSearchParams({ symbol, resolution });
  return apiRequest(`/api/sentinel/training/status?${qs.toString()}`);
}

export function runTrainingJob(params: {
  modelKind: 'regime' | 'risk';
  algorithm: 'gbdt' | 'random_forest';
  symbol: string;
  resolution: CandleResolution;
  horizonMinutes: 30 | 60;
}): Promise<{
  candidate: ModelVersionRecord;
  deployedComparison: {
    currentDeployedId: string | null;
    currentTestAccuracy: number | null;
    candidateTestAccuracy: number;
    deltaAccuracy: number | null;
    recommendation: string;
  };
}> {
  return apiRequest('/api/sentinel/training/run', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export function deployTrainedModel(params: {
  modelId: string;
  confirmed: boolean;
}): Promise<{ deployed: ModelVersionRecord }> {
  return apiRequest('/api/sentinel/training/deploy', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export function fetchAuditLogs(eventType = 'all'): Promise<{
  logs: AuditLogEntry[];
  dbStats: TrainingStatusResponse['dbStats'];
}> {
  const qs = new URLSearchParams({ eventType });
  return apiRequest(`/api/sentinel/audit?${qs.toString()}`);
}
