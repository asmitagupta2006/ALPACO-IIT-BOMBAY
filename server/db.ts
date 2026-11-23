import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AuditLogEntry, DatasetQualityReport } from '../src/contracts/sentinel.ts';

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
    CREATE TABLE IF NOT EXISTS dataset_audits (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      resolution TEXT NOT NULL,
      quality_score REAL NOT NULL,
      report_json TEXT NOT NULL,
      checked_at TEXT NOT NULL
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
  `);

  dbInstance = db;
  return db;
}

export function saveDatasetAudit(report: DatasetQualityReport): void {
  const db = getDb();
  const id = `audit-${report.symbol}-${report.resolution}-${Date.now()}-${randomUUID().slice(0, 8)}`;
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

export function insertAuditLog(
  entry: Omit<AuditLogEntry, 'id' | 'timestamp'> & { id?: string; timestamp?: string },
): AuditLogEntry {
  const db = getDb();
  const record: AuditLogEntry = {
    id: entry.id ?? `aud-${Date.now()}-${randomUUID().slice(0, 8)}`,
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

export function getDatabaseStats() {
  const db = getDb();
  const datasetAudits = (
    db.prepare(`SELECT COUNT(*) as cnt FROM dataset_audits`).get() as { cnt: number }
  ).cnt;
  const auditLogs = (
    db.prepare(`SELECT COUNT(*) as cnt FROM audit_logs`).get() as { cnt: number }
  ).cnt;
  return {
    dbPath: 'data/regime-sentinel.db',
    datasetAudits,
    auditLogs,
  };
}
