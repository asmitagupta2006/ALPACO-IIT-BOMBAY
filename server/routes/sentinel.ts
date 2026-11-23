import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  ALLOWED_RESOLUTIONS,
  type ApiErrorResponse,
  type CandleResolution,
} from '../../src/contracts/delta.ts';
import { getDatabaseStats } from '../db.ts';
import { DeltaApiError } from '../deltaClient.ts';
import {
  getAuditTrail,
  getSentinelOverview,
  loadCleanedMarketCandles,
} from '../sentinelEngine.ts';

const SYMBOL_REGEX = /^[A-Za-z0-9._-]{1,32}$/;

function parseResolution(raw: unknown, fallback: CandleResolution = '15m'): CandleResolution {
  if (typeof raw === 'string' && (ALLOWED_RESOLUTIONS as readonly string[]).includes(raw.trim())) {
    return raw.trim() as CandleResolution;
  }
  return fallback;
}

function sendError(
  res: Response,
  status: number,
  code: string,
  error: string,
  source = 'Regime Sentinel API',
): void {
  const body: ApiErrorResponse = {
    error,
    code,
    status,
    source,
    timestamp: new Date().toISOString(),
  };
  res.status(status).json(body);
}

export function createSentinelRouter(): Router {
  const router = Router();

  router.get('/overview', async (req: Request, res: Response) => {
    const rawSym = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : 'BTCUSD';
    if (!SYMBOL_REGEX.test(rawSym)) {
      sendError(res, 400, 'INVALID_SYMBOL', 'Invalid symbol parameter', 'Server Validator');
      return;
    }
    const resolution = parseResolution(req.query.resolution, '15m');

    try {
      const overview = await getSentinelOverview({ symbol: rawSym, resolution });
      res.json(overview);
    } catch (err) {
      if (err instanceof DeltaApiError) {
        sendError(res, err.status, err.code, err.message, 'Delta Exchange India Proxy');
        return;
      }
      sendError(
        res,
        502,
        'SENTINEL_OVERVIEW_FAILED',
        err instanceof Error ? err.message : 'Failed to compute Sentinel overview',
      );
    }
  });

  router.get('/data/audit', async (req: Request, res: Response) => {
    const rawSym = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : 'BTCUSD';
    if (!SYMBOL_REGEX.test(rawSym)) {
      sendError(res, 400, 'INVALID_SYMBOL', 'Invalid symbol parameter', 'Server Validator');
      return;
    }
    const resolution = parseResolution(req.query.resolution, '15m');

    try {
      const result = await loadCleanedMarketCandles({
        symbol: rawSym,
        resolution,
        lookbackBars: 480,
        recordAuditLog: true,
      });
      res.json({
        report: result.report,
        dbStats: getDatabaseStats(),
      });
    } catch (err) {
      if (err instanceof DeltaApiError) {
        sendError(res, err.status, err.code, err.message, 'Delta Exchange India Proxy');
        return;
      }
      sendError(
        res,
        502,
        'DATA_AUDIT_FAILED',
        err instanceof Error ? err.message : 'Data audit failed',
      );
    }
  });

  router.get('/audit', (req: Request, res: Response) => {
    const eventType =
      typeof req.query.eventType === 'string' && req.query.eventType !== 'all'
        ? req.query.eventType.trim()
        : undefined;
    res.json({
      logs: getAuditTrail(eventType),
      dbStats: getDatabaseStats(),
    });
  });

  return router;
}
