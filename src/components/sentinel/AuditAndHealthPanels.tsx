import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Download, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  fetchAuditLogs,
  fetchDataAudit,
  SentinelRequestError,
  type SentinelDbStats,
} from '../../api/sentinelApi';
import type { CandleResolution, HealthStatusResponse } from '../../contracts/delta';
import type { AuditLogEntry, DatasetQualityReport } from '../../contracts/sentinel';
import { formatDateTimeUtc, formatTimestamp } from '../../utils/format';

interface PanelError {
  message: string;
  code: string;
  timestamp: string;
}

function toPanelError(err: unknown): PanelError {
  if (err instanceof SentinelRequestError) {
    return { message: err.message, code: err.code, timestamp: err.timestamp };
  }
  return {
    message: err instanceof Error ? err.message : 'Request failed',
    code: 'REQUEST_FAILED',
    timestamp: new Date().toISOString(),
  };
}

export function AuditHistoryPanel() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [filterType, setFilterType] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<PanelError | null>(null);

  const load = useCallback(async (type: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAuditLogs(type);
      setLogs(res.logs);
    } catch (err) {
      setLogs([]);
      setError(toPanelError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filterType);
  }, [filterType, load]);

  const exportCsv = () => {
    const header = 'id,timestamp,eventType,actor,strategyId,symbol,action,humanApproved\n';
    const rows = logs
      .map((l) =>
        [
          l.id,
          l.timestamp,
          l.eventType,
          l.actor,
          l.strategyId ?? '',
          l.symbol ?? '',
          `"${l.action.replace(/"/g, '""')}"`,
          l.humanApproved,
        ].join(','),
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `regime-sentinel-audit-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div>
          <h2 className="font-display text-sm font-semibold text-slate-100">
            Audit &amp; Data Validation History (SQLite Persisted)
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Trail of Delta Exchange candle quality audits and system events
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter audit event type"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="rounded border border-slate-700 bg-[#0B1120] px-2.5 py-1.5 text-xs text-slate-100"
          >
            <option value="all">All Event Types</option>
            <option value="data_audit">Data Audits</option>
            <option value="guardrail_decision">Guardrail Decisions</option>
            <option value="system">System Events</option>
          </select>

          <button
            type="button"
            onClick={() => void load(filterType)}
            className="rounded border border-slate-700 bg-[#0B1120] p-1.5 text-slate-300 hover:bg-slate-800 cursor-pointer"
            title="Refresh audit logs"
            aria-label="Refresh audit logs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={exportCsv}
            disabled={logs.length === 0}
            className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-500/40 bg-rose-950/20 p-4 text-xs text-rose-200 space-y-1">
          <p className="font-medium text-rose-100">{error.message}</p>
          <p className="font-mono text-[11px] text-rose-300/85 tabular-nums">
            Reason: {error.code} · Timestamp: {formatTimestamp(error.timestamp)}
          </p>
        </div>
      ) : logs.length === 0 ? (
        <p className="py-6 text-xs text-slate-400">
          No audit events recorded for the active filter.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                <th className="py-2 pr-3 font-medium">Timestamp (UTC)</th>
                <th className="py-2 px-3 font-medium">Event</th>
                <th className="py-2 px-3 font-medium">Actor</th>
                <th className="py-2 px-3 font-medium">Scope</th>
                <th className="py-2 px-3 font-medium">Action &amp; Details</th>
                <th className="py-2 pl-3 font-medium text-right">Human Approved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-slate-900/40">
                  <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-400 whitespace-nowrap tabular-nums">
                    {formatDateTimeUtc(l.timestamp)}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[11px] text-sky-300 whitespace-nowrap">
                    {l.eventType}
                  </td>
                  <td className="py-2.5 px-3 text-slate-200 whitespace-nowrap">{l.actor}</td>
                  <td className="py-2.5 px-3 font-mono text-slate-300 whitespace-nowrap">
                    {l.symbol || l.strategyId || 'SYSTEM'}
                  </td>
                  <td className="py-2.5 px-3 text-slate-200">
                    <div>{l.action}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-slate-500 truncate max-w-md">
                      {JSON.stringify(l.details)}
                    </div>
                  </td>
                  <td className="py-2.5 pl-3 text-right font-mono text-[11px]">
                    {l.humanApproved ? (
                      <span className="text-emerald-300">YES</span>
                    ) : (
                      <span className="text-slate-500">AUTO-LOG</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

interface SystemHealthPanelProps {
  health: HealthStatusResponse | null;
  symbol: string;
  resolution: CandleResolution;
  onRefreshHealth: () => void;
}

export function SystemHealthPanel({
  health,
  symbol,
  resolution,
  onRefreshHealth,
}: SystemHealthPanelProps) {
  const [audit, setAudit] = useState<{
    report: DatasetQualityReport;
    dbStats: SentinelDbStats;
  } | null>(null);
  const [auditError, setAuditError] = useState<PanelError | null>(null);

  const loadAudit = useCallback(
    (signal?: AbortSignal) => {
      setAuditError(null);
      void fetchDataAudit({ symbol, resolution, signal })
        .then((res) => {
          setAudit(res);
          setAuditError(null);
        })
        .catch((err) => {
          if (signal?.aborted) return;
          setAudit(null);
          setAuditError(toPanelError(err));
        });
    },
    [symbol, resolution],
  );

  useEffect(() => {
    const controller = new AbortController();
    loadAudit(controller.signal);
    return () => controller.abort();
  }, [loadAudit]);

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-800/90 bg-[#111A2E] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div>
            <h2 className="font-display text-sm font-semibold text-slate-100">
              System, Exchange API &amp; Pipeline Health
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Delta Exchange India REST/WebSocket telemetry, cache stats, SQLite audit log, and security controls
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              onRefreshHealth();
              loadAudit();
            }}
            className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-[#0B1120] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Run Health Check</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 font-mono text-xs tabular-nums">
          <HealthCard
            label="Delta REST API"
            value={health?.deltaRestOk ? `OK (${health.deltaRestLatencyMs ?? '—'} ms)` : 'DISCONNECTED'}
            ok={health?.deltaRestOk ?? false}
          />
          <HealthCard
            label="Delta WebSocket"
            value={(health?.deltaWsState ?? 'disconnected').toUpperCase()}
            ok={health?.deltaWsState === 'connected'}
          />
          <HealthCard
            label="Last REST Success"
            value={formatTimestamp(health?.lastRestSuccessAt)}
            ok={Boolean(health?.lastRestSuccessAt)}
          />
          <HealthCard
            label="Candle / Product Cache"
            value={`${health?.cacheStats.candleCacheEntries ?? 0} candles · ${health?.cacheStats.productsCached ? 'HIT' : 'COLD'}`}
            ok={true}
          />
        </div>

        {auditError && (
          <div className="rounded-md border border-rose-500/40 bg-rose-950/20 p-4 text-xs text-rose-200 space-y-1">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              <div className="space-y-1">
                <p className="font-medium text-rose-100">
                  Live Delta dataset audit failed ({symbol} · {resolution})
                </p>
                <p className="text-rose-200/90 break-words">{auditError.message}</p>
                <p className="font-mono text-[11px] text-rose-300/85 tabular-nums">
                  Reason: {auditError.code} · Timestamp: {formatTimestamp(auditError.timestamp)}
                </p>
              </div>
            </div>
          </div>
        )}

        {audit && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 pt-2">
            <div className="rounded-md border border-slate-800 bg-[#0B1120] p-4 space-y-2 text-xs">
              <h3 className="font-semibold text-slate-200">
                Active Dataset Pipeline Audit ({audit.report.symbol} · {audit.report.resolution})
              </h3>
              <div className="grid grid-cols-2 gap-2 font-mono text-[11px] text-slate-300 tabular-nums">
                <div>Quality Score: {audit.report.qualityScore}/100</div>
                <div>Freshness Lag: {audit.report.freshnessSeconds ?? '—'}s</div>
                <div>Valid Bars: {audit.report.validBars}</div>
                <div>Missing Intervals: {audit.report.missingBarsDetected}</div>
                <div>Duplicates Cleaned: {audit.report.duplicatesRemoved}</div>
                <div>Anomalies Repaired: {audit.report.anomaliesRepaired}</div>
              </div>
            </div>

            <div className="rounded-md border border-slate-800 bg-[#0B1120] p-4 space-y-2 text-xs">
              <h3 className="font-semibold text-slate-200">
                SQLite Audit Store &amp; Security Posture
              </h3>
              <div className="grid grid-cols-2 gap-2 font-mono text-[11px] text-slate-300 tabular-nums">
                <div>Dataset Audits: {audit.dbStats.datasetAudits}</div>
                <div>Audit Log Entries: {audit.dbStats.auditLogs}</div>
              </div>
              <div className="pt-1 flex items-center gap-2 text-[11px] text-emerald-300">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Read-only public Delta proxy · Zero frontend secrets · No order execution APIs
                </span>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function HealthCard({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded-md border border-slate-800 bg-[#0B1120] p-3">
      <div className="font-sans text-[11px] text-slate-400">{label}</div>
      <div className={`mt-1 text-xs font-semibold ${ok ? 'text-emerald-300' : 'text-amber-300'}`}>
        {value}
      </div>
    </div>
  );
}
