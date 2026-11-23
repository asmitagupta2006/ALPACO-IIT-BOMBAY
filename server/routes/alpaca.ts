import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  AlpacaApiError,
  checkAlpacaHealth,
  fetchAlpacaBars,
  fetchAlpacaLatest,
  fetchAlpacaSymbols,
} from '../alpacaClient.ts';
import type { AlpacaStockFeed } from '../../src/contracts/alpaca.ts';
import {
  ALLOWED_RESOLUTIONS,
  type ApiEnvelope,
  type ApiErrorResponse,
  type CandleResolution,
} from '../../src/contracts/delta.ts';

const ALPACA_SYMBOL_REGEX = /^[A-Za-z0-9./-]{1,24}$/;
const ALLOWED_FEEDS = new Set<AlpacaStockFeed>(['iex', 'delayed_sip', 'sip']);

function sendAlpacaError(
  res: Response,
  status: number,
  code: string,
  error: string,
  source = 'Alpaca Market Data Proxy',
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

function isAllowedResolution(value: string): value is CandleResolution {
  return (ALLOWED_RESOLUTIONS as readonly string[]).includes(value);
}

function parseFeed(raw: unknown): AlpacaStockFeed {
  if (typeof raw === 'string' && ALLOWED_FEEDS.has(raw as AlpacaStockFeed)) {
    return raw as AlpacaStockFeed;
  }
  return 'iex';
}

export function createAlpacaRouter(): Router {
  const router = Router();

  router.get('/health', async (_req: Request, res: Response) => {
    const health = await checkAlpacaHealth();
    res.status(200).json(health);
  });

  router.get('/symbols', async (req: Request, res: Response) => {
    try {
      const { payload, cached, fetchedAt } = await fetchAlpacaSymbols();
      const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
      const assetClass =
        typeof req.query.assetClass === 'string' ? req.query.assetClass.trim() : 'all';

      let filtered = payload.symbols;
      if (assetClass === 'us_equity' || assetClass === 'crypto') {
        filtered = filtered.filter((s) => s.assetClass === assetClass);
      }
      if (q) {
        filtered = filtered.filter((s) => s.symbol.toLowerCase().includes(q));
      }

      const envelope: ApiEnvelope<typeof payload> = {
        data: {
          ...payload,
          symbols: filtered,
          totalCount: filtered.length,
        },
        source: 'Alpaca',
        fetchedAt,
        cached,
      };
      res.json(envelope);
    } catch (err) {
      if (err instanceof AlpacaApiError) {
        sendAlpacaError(res, err.status, err.code, err.message);
        return;
      }
      sendAlpacaError(
        res,
        502,
        'ALPACA_SYMBOLS_FAILED',
        err instanceof Error ? err.message : 'Failed to load symbols from Alpaca Market Data API',
      );
    }
  });

  router.get('/bars', async (req: Request, res: Response) => {
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim().toUpperCase() : '';
    const resolutionRaw =
      typeof req.query.resolution === 'string' ? req.query.resolution.trim() : '15m';
    const feed = parseFeed(req.query.feed);
    const startRaw = typeof req.query.start === 'string' ? Number(req.query.start) : NaN;
    const endRaw = typeof req.query.end === 'string' ? Number(req.query.end) : NaN;

    if (!ALPACA_SYMBOL_REGEX.test(symbol)) {
      sendAlpacaError(
        res,
        400,
        'INVALID_SYMBOL',
        'Invalid or missing symbol parameter (examples: AAPL, SPY, BTC/USD)',
        'Server Validator',
      );
      return;
    }

    if (!isAllowedResolution(resolutionRaw)) {
      sendAlpacaError(
        res,
        400,
        'INVALID_RESOLUTION',
        `Unsupported resolution "${resolutionRaw}". Allowed: ${ALLOWED_RESOLUTIONS.join(', ')}`,
        'Server Validator',
      );
      return;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const end = Number.isFinite(endRaw) && endRaw > 0 ? Math.floor(endRaw) : nowSec;
    const start =
      Number.isFinite(startRaw) && startRaw > 0 ? Math.floor(startRaw) : end - 7 * 86_400;

    if (start >= end) {
      sendAlpacaError(
        res,
        400,
        'INVALID_TIME_RANGE',
        'start timestamp must be strictly earlier than end timestamp',
        'Server Validator',
      );
      return;
    }

    try {
      const { payload, cached, fetchedAt } = await fetchAlpacaBars({
        symbol,
        resolution: resolutionRaw,
        start,
        end,
        feed,
      });

      const envelope: ApiEnvelope<typeof payload> = {
        data: payload,
        source: 'Alpaca',
        fetchedAt,
        cached,
      };
      res.json(envelope);
    } catch (err) {
      if (err instanceof AlpacaApiError) {
        sendAlpacaError(res, err.status, err.code, err.message);
        return;
      }
      sendAlpacaError(
        res,
        502,
        'ALPACA_BARS_FAILED',
        err instanceof Error ? err.message : 'Failed to fetch historical bars from Alpaca',
      );
    }
  });

  router.get('/latest', async (req: Request, res: Response) => {
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim().toUpperCase() : '';
    const feed = parseFeed(req.query.feed);

    if (!ALPACA_SYMBOL_REGEX.test(symbol)) {
      sendAlpacaError(
        res,
        400,
        'INVALID_SYMBOL',
        'Invalid or missing symbol parameter',
        'Server Validator',
      );
      return;
    }

    try {
      const { payload, cached, fetchedAt } = await fetchAlpacaLatest({ symbol, feed });
      const envelope: ApiEnvelope<typeof payload> = {
        data: payload,
        source: 'Alpaca',
        fetchedAt,
        cached,
      };
      res.json(envelope);
    } catch (err) {
      if (err instanceof AlpacaApiError) {
        sendAlpacaError(res, err.status, err.code, err.message);
        return;
      }
      sendAlpacaError(
        res,
        502,
        'ALPACA_LATEST_FAILED',
        err instanceof Error ? err.message : 'Failed to fetch latest quote/trade from Alpaca',
      );
    }
  });

  return router;
}
