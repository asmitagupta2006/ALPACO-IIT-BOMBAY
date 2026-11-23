import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  ALLOWED_RESOLUTIONS,
  type CandleResolution,
} from '../../src/contracts/delta.ts';
import {
  MARKET_REGIMES,
  type AlertSeverity,
  type GuardrailConfig,
  type MarketRegime,
  type PaperSimulationRequest,
} from '../../src/contracts/sentinel.ts';
import { getDatabaseStats, listGuardrails } from '../db.ts';
import {
  ackAlert,
  executeGuardrailUpdate,
  executeKillSwitch,
  executeModelDeployment,
  executePaperSimulation,
  executeResumeStrategies,
  getAlertsHistory,
  getAuditTrail,
  getPaperRunHistory,
  getSentinelOverview,
  getStrategyExplanation,
  getTrainingCenterStatus,
  loadCleanedMarketCandles,
  triggerModelTraining,
} from '../sentinelEngine.ts';

const SYMBOL_REGEX = /^[A-Za-z0-9._-]{1,32}$/;

function parseResolution(raw: unknown, fallback: CandleResolution = '15m'): CandleResolution {
  if (typeof raw === 'string' && (ALLOWED_RESOLUTIONS as readonly string[]).includes(raw.trim())) {
    return raw.trim() as CandleResolution;
  }
  return fallback;
}

function parseMode(raw: unknown): 'live' | 'demo' {
  return raw === 'demo' ? 'demo' : 'live';
}

export function createSentinelRouter(): Router {
  const router = Router();

  router.get('/overview', async (req: Request, res: Response) => {
    const rawSym = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : 'BTCUSD';
    if (!SYMBOL_REGEX.test(rawSym)) {
      res.status(400).json({ error: 'Invalid symbol parameter' });
      return;
    }
    const resolution = parseResolution(req.query.resolution, '15m');
    const mode = parseMode(req.query.mode);

    try {
      const overview = await getSentinelOverview({ symbol: rawSym, resolution, mode });
      res.json(overview);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to compute Sentinel overview',
      });
    }
  });

  router.get('/data/audit', async (req: Request, res: Response) => {
    const rawSym = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : 'BTCUSD';
    if (!SYMBOL_REGEX.test(rawSym)) {
      res.status(400).json({ error: 'Invalid symbol parameter' });
      return;
    }
    const resolution = parseResolution(req.query.resolution, '15m');
    const mode = parseMode(req.query.mode);

    try {
      const result = await loadCleanedMarketCandles({
        symbol: rawSym,
        resolution,
        lookbackBars: 500,
        mode,
      });
      res.json({
        report: result.report,
        dbStats: getDatabaseStats(),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Data audit failed',
      });
    }
  });

  router.get('/alerts', (req: Request, res: Response) => {
    const severity =
      req.query.severity === 'Information' ||
      req.query.severity === 'Warning' ||
      req.query.severity === 'Critical'
        ? (req.query.severity as AlertSeverity)
        : undefined;
    const symbol =
      typeof req.query.symbol === 'string' && SYMBOL_REGEX.test(req.query.symbol.trim())
        ? req.query.symbol.trim()
        : undefined;

    res.json({ alerts: getAlertsHistory(severity, symbol) });
  });

  router.post('/alerts/:id/ack', (req: Request, res: Response) => {
    const id = typeof req.params.id === 'string' ? req.params.id.trim() : '';
    if (!id) {
      res.status(400).json({ error: 'Alert id required' });
      return;
    }
    const updated = ackAlert(id);
    res.json({ ok: updated });
  });

  router.get('/explain', async (req: Request, res: Response) => {
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : 'BTCUSD';
    const strategyId =
      typeof req.query.strategyId === 'string' ? req.query.strategyId.trim() : 'strat-btc-momentum';
    if (!SYMBOL_REGEX.test(symbol) || !SYMBOL_REGEX.test(strategyId)) {
      res.status(400).json({ error: 'Invalid symbol or strategyId' });
      return;
    }
    const resolution = parseResolution(req.query.resolution, '15m');
    const mode = parseMode(req.query.mode);
    const includeGemini = req.query.gemini === '1';

    try {
      const explanation = await getStrategyExplanation({
        symbol,
        resolution,
        strategyId,
        mode,
        includeGemini,
      });
      res.json(explanation);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to build explanation',
      });
    }
  });

  router.get('/guardrails', (_req: Request, res: Response) => {
    res.json({ guardrails: listGuardrails() });
  });

  router.put('/guardrails/:strategyId', (req: Request, res: Response) => {
    const strategyId =
      typeof req.params.strategyId === 'string' ? req.params.strategyId.trim() : '';
    const existing = listGuardrails().find((g) => g.strategyId === strategyId);
    if (!existing) {
      res.status(404).json({ error: `Strategy guardrail ${strategyId} not found` });
      return;
    }

    const body = (req.body || {}) as Partial<GuardrailConfig>;
    const num = (v: unknown, fallback: number, min: number, max: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
    };

    const next: GuardrailConfig = {
      ...existing,
      maxDailyLossPct: num(body.maxDailyLossPct, existing.maxDailyLossPct, 0.5, 25),
      maxDrawdownPct: num(body.maxDrawdownPct, existing.maxDrawdownPct, 1, 40),
      maxExposureUsd: num(body.maxExposureUsd, existing.maxExposureUsd, 1000, 1_000_000),
      maxLeverage: num(body.maxLeverage, existing.maxLeverage, 1, 25),
      maxSlippageBps: num(body.maxSlippageBps, existing.maxSlippageBps, 1, 100),
      maxConsecutiveLosses: Math.round(
        num(body.maxConsecutiveLosses, existing.maxConsecutiveLosses, 1, 20),
      ),
      maxRiskProbPct: num(body.maxRiskProbPct, existing.maxRiskProbPct, 20, 95),
      tradingMode: body.tradingMode === 'live_gated' ? 'live_gated' : 'paper',
      status:
        body.status === 'active' ||
        body.status === 'reduced' ||
        body.status === 'paused' ||
        body.status === 'killed'
          ? body.status
          : existing.status,
    };

    const updated = executeGuardrailUpdate(next);
    res.json({ guardrail: updated });
  });

  router.post('/guardrails/kill-switch', (req: Request, res: Response) => {
    const body = (req.body || {}) as { confirmed?: boolean; reason?: string };
    try {
      const result = executeKillSwitch({
        confirmed: body.confirmed === true,
        reason: typeof body.reason === 'string' && body.reason.trim()
          ? body.reason.trim().slice(0, 240)
          : 'Manual emergency risk halt by operator',
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Kill switch rejected' });
    }
  });

  router.post('/guardrails/resume', (req: Request, res: Response) => {
    const body = (req.body || {}) as { confirmed?: boolean };
    try {
      const result = executeResumeStrategies({ confirmed: body.confirmed === true });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Resume rejected' });
    }
  });

  router.get('/paper/history', (_req: Request, res: Response) => {
    res.json({ runs: getPaperRunHistory() });
  });

  router.post('/paper/simulate', async (req: Request, res: Response) => {
    const b = (req.body || {}) as Partial<PaperSimulationRequest>;
    const validRegime = (r: unknown, fb: MarketRegime): MarketRegime =>
      typeof r === 'string' && (MARKET_REGIMES as readonly string[]).includes(r)
        ? (r as MarketRegime)
        : fb;

    const payload: PaperSimulationRequest = {
      strategyId:
        typeof b.strategyId === 'string' && SYMBOL_REGEX.test(b.strategyId)
          ? b.strategyId
          : 'strat-btc-momentum',
      symbol: b.symbol === 'ETHUSD' ? 'ETHUSD' : 'BTCUSD',
      targetRegime: validRegime(b.targetRegime, 'Trending'),
      simulateTransition: b.simulateTransition !== false,
      transitionToRegime: validRegime(b.transitionToRegime, 'High Volatility'),
      leverage: Math.max(1, Math.min(20, Number(b.leverage) || 5)),
      capitalUsd: Math.max(1000, Math.min(1_000_000, Number(b.capitalUsd) || 25000)),
      barsCount: Math.max(30, Math.min(120, Math.round(Number(b.barsCount) || 64))),
      takerFeeBps: Math.max(0, Math.min(25, Number(b.takerFeeBps) || 5)),
      baseSlippageBps: Math.max(0, Math.min(30, Number(b.baseSlippageBps) || 2.5)),
    };

    try {
      const sim = await executePaperSimulation(payload);
      res.json(sim);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Simulation failed',
      });
    }
  });

  router.get('/training/status', async (req: Request, res: Response) => {
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : 'BTCUSD';
    const resolution = parseResolution(req.query.resolution, '15m');
    try {
      const status = await getTrainingCenterStatus(
        SYMBOL_REGEX.test(symbol) ? symbol : 'BTCUSD',
        resolution,
      );
      res.json(status);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to load training status',
      });
    }
  });

  router.post('/training/run', async (req: Request, res: Response) => {
    const b = (req.body || {}) as {
      modelKind?: 'regime' | 'risk';
      algorithm?: 'gbdt' | 'random_forest';
      symbol?: string;
      resolution?: CandleResolution;
      horizonMinutes?: 30 | 60;
    };
    const modelKind = b.modelKind === 'risk' ? 'risk' : 'regime';
    const symbol =
      typeof b.symbol === 'string' && SYMBOL_REGEX.test(b.symbol.trim())
        ? b.symbol.trim()
        : 'BTCUSD';
    const resolution = parseResolution(b.resolution, '15m');

    try {
      const out = await triggerModelTraining({
        modelKind,
        algorithm: b.algorithm === 'random_forest' ? 'random_forest' : 'gbdt',
        symbol,
        resolution,
        horizonMinutes: b.horizonMinutes === 60 ? 60 : 30,
      });
      res.json(out);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Training run failed',
      });
    }
  });

  router.post('/training/deploy', (req: Request, res: Response) => {
    const b = (req.body || {}) as { modelId?: string; confirmed?: boolean };
    if (typeof b.modelId !== 'string' || !b.modelId.trim()) {
      res.status(400).json({ error: 'modelId is required' });
      return;
    }
    try {
      const promoted = executeModelDeployment({
        modelId: b.modelId.trim(),
        confirmed: b.confirmed === true,
      });
      res.json({ deployed: promoted });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Deployment failed',
      });
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
