import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CandleResolution, DeltaCandle } from '../src/contracts/delta.ts';
import type {
  AlertSeverity,
  AuditLogEntry,
  DatasetQualityReport,
  GuardrailConfig,
  ModelEvaluationMetrics,
  ModelVersionRecord,
  PaperSimulationResult,
  RegimeTransitionAlert,
} from '../src/contracts/sentinel.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'regime-sentinel.db');

let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS historical_candles (
      symbol TEXT NOT NULL,
      resolution TEXT NOT NULL,
      basis TEXT NOT NULL,
      time INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL,
      source TEXT NOT NULL,
      ingested_at TEXT NOT NULL,
      PRIMARY KEY (symbol, resolution, basis, time)
    );

    CREATE TABLE IF NOT EXISTS dataset_audits (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      resolution TEXT NOT NULL,
      quality_score REAL NOT NULL,
      report_json TEXT NOT NULL,
      checked_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_versions (
      id TEXT PRIMARY KEY,
      model_kind TEXT NOT NULL,
      version TEXT NOT NULL,
      algorithm TEXT NOT NULL,
      symbol_scope TEXT NOT NULL,
      resolution TEXT NOT NULL,
      created_at TEXT NOT NULL,
      deployed INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      artifact_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS regime_alerts (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      symbol TEXT NOT NULL,
      from_regime TEXT NOT NULL,
      to_regime TEXT NOT NULL,
      severity TEXT NOT NULL,
      affected_strategies_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      recommended_action TEXT NOT NULL,
      acknowledged INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS guardrail_configs (
      strategy_id TEXT PRIMARY KEY,
      strategy_name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      max_daily_loss_pct REAL NOT NULL,
      max_drawdown_pct REAL NOT NULL,
      max_exposure_usd REAL NOT NULL,
      max_leverage REAL NOT NULL,
      max_slippage_bps REAL NOT NULL,
      max_consecutive_losses INTEGER NOT NULL,
      max_risk_prob_pct REAL NOT NULL,
      trading_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      strategy_id TEXT,
      symbol TEXT,
      action TEXT NOT NULL,
      details_json TEXT NOT NULL,
      human_approved INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS paper_runs (
      id TEXT PRIMARY KEY,
      strategy_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      scenario TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  seedDefaultGuardrails(db);
  dbInstance = db;
  return db;
}

function seedDefaultGuardrails(db: DatabaseSync): void {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM guardrail_configs').get() as { cnt: number };
  if (row.cnt > 0) return;

  const now = new Date().toISOString();
  const defaults: GuardrailConfig[] = [
    {
      strategyId: 'strat-btc-momentum',
      strategyName: 'BTC Momentum Trend',
      symbol: 'BTCUSD',
      maxDailyLossPct: 3.5,
      maxDrawdownPct: 7.5,
      maxExposureUsd: 75000,
      maxLeverage: 6.0,
      maxSlippageBps: 8.5,
      maxConsecutiveLosses: 4,
      maxRiskProbPct: 68,
      tradingMode: 'paper',
      status: 'active',
      updatedAt: now,
    },
    {
      strategyId: 'strat-eth-grid',
      strategyName: 'ETH Mean-Reversion Grid',
      symbol: 'ETHUSD',
      maxDailyLossPct: 3.0,
      maxDrawdownPct: 6.5,
      maxExposureUsd: 60000,
      maxLeverage: 5.0,
      maxSlippageBps: 9.0,
      maxConsecutiveLosses: 5,
      maxRiskProbPct: 65,
      tradingMode: 'paper',
      status: 'active',
      updatedAt: now,
    },
    {
      strategyId: 'strat-btc-breakout',
      strategyName: 'BTC Volatility Breakout',
      symbol: 'BTCUSD',
      maxDailyLossPct: 4.0,
      maxDrawdownPct: 8.5,
      maxExposureUsd: 80000,
      maxLeverage: 7.0,
      maxSlippageBps: 11.0,
      maxConsecutiveLosses: 4,
      maxRiskProbPct: 72,
      tradingMode: 'paper',
      status: 'active',
      updatedAt: now,
    },
    {
      strategyId: 'strat-eth-basis',
      strategyName: 'ETH Funding Basis Arb',
      symbol: 'ETHUSD',
      maxDailyLossPct: 2.0,
      maxDrawdownPct: 4.0,
      maxExposureUsd: 90000,
      maxLeverage: 4.0,
      maxSlippageBps: 6.0,
      maxConsecutiveLosses: 3,
      maxRiskProbPct: 60,
      tradingMode: 'paper',
      status: 'active',
      updatedAt: now,
    },
  ];

  const stmt = db.prepare(`
    INSERT INTO guardrail_configs (
      strategy_id, strategy_name, symbol, max_daily_loss_pct, max_drawdown_pct,
      max_exposure_usd, max_leverage, max_slippage_bps, max_consecutive_losses,
      max_risk_prob_pct, trading_mode, status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const g of defaults) {
    stmt.run(
      g.strategyId,
      g.strategyName,
      g.symbol,
      g.maxDailyLossPct,
      g.maxDrawdownPct,
      g.maxExposureUsd,
      g.maxLeverage,
      g.maxSlippageBps,
      g.maxConsecutiveLosses,
      g.maxRiskProbPct,
      g.tradingMode,
      g.status,
      g.updatedAt,
    );
  }
}

export function upsertHistoricalCandles(params: {
  symbol: string;
  resolution: CandleResolution;
  basis?: 'trade' | 'mark';
  candles: DeltaCandle[];
  source: string;
}): void {
  if (params.candles.length === 0) return;
  const db = getDb();
  const basis = params.basis ?? 'trade';
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO historical_candles (symbol, resolution, basis, time, open, high, low, close, volume, source, ingested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol, resolution, basis, time) DO UPDATE SET
      open = excluded.open,
      high = excluded.high,
      low = excluded.low,
      close = excluded.close,
      volume = excluded.volume,
      source = excluded.source,
      ingested_at = excluded.ingested_at
  `);

  db.exec('BEGIN;');
  try {
    for (const c of params.candles) {
      stmt.run(
        params.symbol,
        params.resolution,
        basis,
        c.time,
        c.open,
        c.high,
        c.low,
        c.close,
        c.volume,
        params.source,
        now,
      );
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

export function loadHistoricalCandles(params: {
  symbol: string;
  resolution: CandleResolution;
  basis?: 'trade' | 'mark';
  limit?: number;
}): DeltaCandle[] {
  const db = getDb();
  const basis = params.basis ?? 'trade';
  const limit = params.limit ?? 3000;
  const rows = db
    .prepare(
      `SELECT time, open, high, low, close, volume FROM (
        SELECT time, open, high, low, close, volume
        FROM historical_candles
        WHERE symbol = ? AND resolution = ? AND basis = ?
        ORDER BY time DESC
        LIMIT ?
      ) ORDER BY time ASC`,
    )
    .all(params.symbol, params.resolution, basis, limit) as Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;

  return rows;
}

export function saveDatasetAudit(report: DatasetQualityReport): void {
  const db = getDb();
  const id = `audit-${report.symbol}-${report.resolution}-${Date.now()}`;
  db.prepare(`
    INSERT INTO dataset_audits (id, symbol, resolution, quality_score, report_json, checked_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    report.symbol,
    report.resolution,
    report.qualityScore,
    JSON.stringify(report),
    new Date().toISOString(),
  );
}

export function saveModelVersion(params: {
  id: string;
  modelKind: 'regime' | 'risk';
  version: string;
  algorithm: string;
  symbolScope: string;
  resolution: CandleResolution;
  deployed: boolean;
  status: 'deployed' | 'candidate' | 'archived';
  metrics: ModelEvaluationMetrics;
  artifact: unknown;
}): ModelVersionRecord {
  const db = getDb();
  const createdAt = new Date().toISOString();
  if (params.deployed) {
    db.prepare(
      `UPDATE model_versions SET deployed = 0, status = 'archived' WHERE model_kind = ? AND deployed = 1`,
    ).run(params.modelKind);
  }
  db.prepare(`
    INSERT INTO model_versions (
      id, model_kind, version, algorithm, symbol_scope, resolution,
      created_at, deployed, status, metrics_json, artifact_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.id,
    params.modelKind,
    params.version,
    params.algorithm,
    params.symbolScope,
    params.resolution,
    createdAt,
    params.deployed ? 1 : 0,
    params.status,
    JSON.stringify(params.metrics),
    JSON.stringify(params.artifact),
  );

  return {
    id: params.id,
    modelKind: params.modelKind,
    version: params.version,
    algorithm: params.algorithm,
    symbolScope: params.symbolScope,
    resolution: params.resolution,
    createdAt,
    deployed: params.deployed,
    status: params.status,
    metrics: params.metrics,
  };
}

export function listModelVersions(modelKind?: 'regime' | 'risk'): ModelVersionRecord[] {
  const db = getDb();
  const sql = modelKind
    ? `SELECT id, model_kind, version, algorithm, symbol_scope, resolution, created_at, deployed, status, metrics_json
       FROM model_versions WHERE model_kind = ? ORDER BY created_at DESC LIMIT 30`
    : `SELECT id, model_kind, version, algorithm, symbol_scope, resolution, created_at, deployed, status, metrics_json
       FROM model_versions ORDER BY created_at DESC LIMIT 40`;
  const rows = (modelKind ? db.prepare(sql).all(modelKind) : db.prepare(sql).all()) as Array<{
    id: string;
    model_kind: 'regime' | 'risk';
    version: string;
    algorithm: string;
    symbol_scope: string;
    resolution: CandleResolution;
    created_at: string;
    deployed: number;
    status: 'deployed' | 'candidate' | 'archived';
    metrics_json: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    modelKind: r.model_kind,
    version: r.version,
    algorithm: r.algorithm,
    symbolScope: r.symbol_scope,
    resolution: r.resolution,
    createdAt: r.created_at,
    deployed: r.deployed === 1,
    status: r.status,
    metrics: JSON.parse(r.metrics_json) as ModelEvaluationMetrics,
  }));
}

export function getDeployedModelWithArtifact<T>(
  modelKind: 'regime' | 'risk',
): { record: ModelVersionRecord; artifact: T } | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, model_kind, version, algorithm, symbol_scope, resolution, created_at, deployed, status, metrics_json, artifact_json
       FROM model_versions WHERE model_kind = ? AND deployed = 1 ORDER BY created_at DESC LIMIT 1`,
    )
    .get(modelKind) as
    | {
        id: string;
        model_kind: 'regime' | 'risk';
        version: string;
        algorithm: string;
        symbol_scope: string;
        resolution: CandleResolution;
        created_at: string;
        deployed: number;
        status: 'deployed' | 'candidate' | 'archived';
        metrics_json: string;
        artifact_json: string;
      }
    | undefined;

  if (!row) return null;
  return {
    record: {
      id: row.id,
      modelKind: row.model_kind,
      version: row.version,
      algorithm: row.algorithm,
      symbolScope: row.symbol_scope,
      resolution: row.resolution,
      createdAt: row.created_at,
      deployed: true,
      status: row.status,
      metrics: JSON.parse(row.metrics_json) as ModelEvaluationMetrics,
    },
    artifact: JSON.parse(row.artifact_json) as T,
  };
}

export function promoteModelVersion(modelId: string): ModelVersionRecord | null {
  const db = getDb();
  const target = db
    .prepare(
      `SELECT id, model_kind, version, algorithm, symbol_scope, resolution, created_at, metrics_json
       FROM model_versions WHERE id = ?`,
    )
    .get(modelId) as
    | {
        id: string;
        model_kind: 'regime' | 'risk';
        version: string;
        algorithm: string;
        symbol_scope: string;
        resolution: CandleResolution;
        created_at: string;
        metrics_json: string;
      }
    | undefined;

  if (!target) return null;

  db.exec('BEGIN;');
  try {
    db.prepare(
      `UPDATE model_versions SET deployed = 0, status = 'archived' WHERE model_kind = ? AND deployed = 1`,
    ).run(target.model_kind);
    db.prepare(
      `UPDATE model_versions SET deployed = 1, status = 'deployed' WHERE id = ?`,
    ).run(target.id);
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  return {
    id: target.id,
    modelKind: target.model_kind,
    version: target.version,
    algorithm: target.algorithm,
    symbolScope: target.symbol_scope,
    resolution: target.resolution,
    createdAt: target.created_at,
    deployed: true,
    status: 'deployed',
    metrics: JSON.parse(target.metrics_json) as ModelEvaluationMetrics,
  };
}

export function listGuardrails(): GuardrailConfig[] {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM guardrail_configs ORDER BY strategy_id ASC`).all() as Array<{
    strategy_id: string;
    strategy_name: string;
    symbol: string;
    max_daily_loss_pct: number;
    max_drawdown_pct: number;
    max_exposure_usd: number;
    max_leverage: number;
    max_slippage_bps: number;
    max_consecutive_losses: number;
    max_risk_prob_pct: number;
    trading_mode: 'paper' | 'live_gated';
    status: 'active' | 'reduced' | 'paused' | 'killed';
    updated_at: string;
  }>;

  return rows.map((r) => ({
    strategyId: r.strategy_id,
    strategyName: r.strategy_name,
    symbol: r.symbol,
    maxDailyLossPct: r.max_daily_loss_pct,
    maxDrawdownPct: r.max_drawdown_pct,
    maxExposureUsd: r.max_exposure_usd,
    maxLeverage: r.max_leverage,
    maxSlippageBps: r.max_slippage_bps,
    maxConsecutiveLosses: r.max_consecutive_losses,
    maxRiskProbPct: r.max_risk_prob_pct,
    tradingMode: r.trading_mode,
    status: r.status,
    updatedAt: r.updated_at,
  }));
}

export function updateGuardrail(config: GuardrailConfig): GuardrailConfig {
  const db = getDb();
  const updatedAt = new Date().toISOString();
  db.prepare(`
    UPDATE guardrail_configs SET
      max_daily_loss_pct = ?,
      max_drawdown_pct = ?,
      max_exposure_usd = ?,
      max_leverage = ?,
      max_slippage_bps = ?,
      max_consecutive_losses = ?,
      max_risk_prob_pct = ?,
      trading_mode = ?,
      status = ?,
      updated_at = ?
    WHERE strategy_id = ?
  `).run(
    config.maxDailyLossPct,
    config.maxDrawdownPct,
    config.maxExposureUsd,
    config.maxLeverage,
    config.maxSlippageBps,
    config.maxConsecutiveLosses,
    config.maxRiskProbPct,
    config.tradingMode,
    config.status,
    updatedAt,
    config.strategyId,
  );
  return { ...config, updatedAt };
}

export function setAllGuardrailStatuses(status: 'active' | 'reduced' | 'paused' | 'killed'): void {
  const db = getDb();
  db.prepare(`UPDATE guardrail_configs SET status = ?, updated_at = ?`).run(
    status,
    new Date().toISOString(),
  );
}

export function insertRegimeAlert(alert: RegimeTransitionAlert): void {
  if (alert.fromRegime === alert.toRegime) return;
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO regime_alerts (
      id, timestamp, symbol, from_regime, to_regime, severity,
      affected_strategies_json, reason, recommended_action, acknowledged, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    alert.id,
    alert.timestamp,
    alert.symbol,
    alert.fromRegime,
    alert.toRegime,
    alert.severity,
    JSON.stringify(alert.affectedStrategies),
    alert.reason,
    alert.recommendedAction,
    alert.acknowledged ? 1 : 0,
    alert.timestamp,
  );
}

export function listRegimeAlerts(params?: {
  severity?: AlertSeverity;
  symbol?: string;
  limit?: number;
}): RegimeTransitionAlert[] {
  const db = getDb();
  const clauses: string[] = ['from_regime != to_regime'];
  const args: Array<string | number> = [];

  if (params?.severity) {
    clauses.push('severity = ?');
    args.push(params.severity);
  }
  if (params?.symbol) {
    clauses.push('symbol = ?');
    args.push(params.symbol);
  }

  const where = `WHERE ${clauses.join(' AND ')}`;
  const limit = params?.limit ?? 60;
  args.push(limit);

  const rows = db
    .prepare(
      `SELECT id, timestamp, symbol, from_regime, to_regime, severity, affected_strategies_json, reason, recommended_action, acknowledged
       FROM regime_alerts ${where} ORDER BY timestamp DESC LIMIT ?`,
    )
    .all(...args) as Array<{
    id: string;
    timestamp: string;
    symbol: string;
    from_regime: RegimeTransitionAlert['fromRegime'];
    to_regime: RegimeTransitionAlert['toRegime'];
    severity: AlertSeverity;
    affected_strategies_json: string;
    reason: string;
    recommended_action: RegimeTransitionAlert['recommendedAction'];
    acknowledged: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    symbol: r.symbol,
    fromRegime: r.from_regime,
    toRegime: r.to_regime,
    severity: r.severity,
    affectedStrategies: JSON.parse(r.affected_strategies_json),
    reason: r.reason,
    recommendedAction: r.recommended_action,
    acknowledged: r.acknowledged === 1,
  }));
}

export function acknowledgeRegimeAlert(id: string): boolean {
  const db = getDb();
  const res = db.prepare(`UPDATE regime_alerts SET acknowledged = 1 WHERE id = ?`).run(id);
  return Number(res.changes) > 0;
}

export function insertAuditLog(entry: Omit<AuditLogEntry, 'id' | 'timestamp'> & { id?: string; timestamp?: string }): AuditLogEntry {
  const db = getDb();
  const record: AuditLogEntry = {
    id: entry.id ?? `aud-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: entry.timestamp ?? new Date().toISOString(),
    eventType: entry.eventType,
    actor: entry.actor,
    strategyId: entry.strategyId,
    symbol: entry.symbol,
    action: entry.action,
    details: entry.details,
    humanApproved: entry.humanApproved,
  };

  db.prepare(`
    INSERT INTO audit_logs (id, timestamp, event_type, actor, strategy_id, symbol, action, details_json, human_approved)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.timestamp,
    record.eventType,
    record.actor,
    record.strategyId,
    record.symbol,
    record.action,
    JSON.stringify(record.details),
    record.humanApproved ? 1 : 0,
  );
  return record;
}

export function listAuditLogs(params?: { eventType?: string; limit?: number }): AuditLogEntry[] {
  const db = getDb();
  const limit = params?.limit ?? 100;
  const rows = (
    params?.eventType
      ? db
          .prepare(
            `SELECT * FROM audit_logs WHERE event_type = ? ORDER BY timestamp DESC LIMIT ?`,
          )
          .all(params.eventType, limit)
      : db.prepare(`SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?`).all(limit)
  ) as Array<{
    id: string;
    timestamp: string;
    event_type: AuditLogEntry['eventType'];
    actor: string;
    strategy_id: string | null;
    symbol: string | null;
    action: string;
    details_json: string;
    human_approved: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    eventType: r.event_type,
    actor: r.actor,
    strategyId: r.strategy_id,
    symbol: r.symbol,
    action: r.action,
    details: JSON.parse(r.details_json),
    humanApproved: r.human_approved === 1,
  }));
}

export function savePaperRun(result: PaperSimulationResult): void {
  const db = getDb();
  const scenario = result.request.simulateTransition
    ? `${result.request.targetRegime} → ${result.request.transitionToRegime}`
    : result.request.targetRegime;
  db.prepare(`
    INSERT INTO paper_runs (id, strategy_id, symbol, scenario, result_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    result.id,
    result.request.strategyId,
    result.request.symbol,
    scenario,
    JSON.stringify(result),
    new Date().toISOString(),
  );
}

export function listPaperRuns(limit = 10): PaperSimulationResult[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT result_json FROM paper_runs ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as Array<{ result_json: string }>;
  return rows.map((r) => JSON.parse(r.result_json) as PaperSimulationResult);
}

export function getDatabaseStats() {
  const db = getDb();
  const candles = (db.prepare(`SELECT COUNT(*) as cnt FROM historical_candles`).get() as { cnt: number }).cnt;
  const models = (db.prepare(`SELECT COUNT(*) as cnt FROM model_versions`).get() as { cnt: number }).cnt;
  const alerts = (db.prepare(`SELECT COUNT(*) as cnt FROM regime_alerts`).get() as { cnt: number }).cnt;
  const audits = (db.prepare(`SELECT COUNT(*) as cnt FROM audit_logs`).get() as { cnt: number }).cnt;
  const paperRuns = (db.prepare(`SELECT COUNT(*) as cnt FROM paper_runs`).get() as { cnt: number }).cnt;
  return {
    dbPath: 'data/regime-sentinel.db',
    storedCandles: candles,
    modelVersions: models,
    regimeAlerts: alerts,
    auditLogs: audits,
    paperRuns,
  };
}
