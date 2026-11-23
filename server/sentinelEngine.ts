import type { CandleResolution, DeltaCandle } from '../src/contracts/delta.ts';
import type {
  DatasetQualityReport,
  MultiAssetRegimeCell,
  SentinelOverviewResponse,
} from '../src/contracts/sentinel.ts';
import { cleanAndAuditCandles, resolutionToSeconds } from '../src/quant/dataCleaner.ts';
import { TtlCache } from './cache.ts';
import { insertAuditLog, listAuditLogs, saveDatasetAudit } from './db.ts';
import { DeltaApiError, fetchCandlesHistory, fetchTickerSnapshot } from './deltaClient.ts';
import { detectMarketRegime } from './regime/classifier.ts';

const analysisCache = new TtlCache<SentinelOverviewResponse>(18_000, 32);
const heatmapCache = new TtlCache<MultiAssetRegimeCell[]>(30_000, 10);

export async function loadCleanedMarketCandles(params: {
  symbol: string;
  resolution: CandleResolution;
  lookbackBars?: number;
  recordAuditLog?: boolean;
}): Promise<{
  candles: DeltaCandle[];
  report: DatasetQualityReport;
  fetchedAt: string;
}> {
  const stepSec = resolutionToSeconds(params.resolution);
  const barsWanted = params.lookbackBars ?? 480;
  const end = Math.floor(Date.now() / 1000);
  const start = end - barsWanted * stepSec;

  const candlesRes = await fetchCandlesHistory({
    symbol: params.symbol,
    resolution: params.resolution,
    start,
    end,
    basis: 'trade',
  });

  if (candlesRes.payload.candles.length === 0) {
    throw new DeltaApiError(
      `Delta Exchange India returned 0 candles for ${params.symbol} (${params.resolution}).`,
      502,
      'DELTA_EMPTY_CANDLES',
    );
  }

  const cleaned = cleanAndAuditCandles({
    rawCandles: candlesRes.payload.candles,
    symbol: params.symbol,
    resolution: params.resolution,
    sourceMode: 'live',
  });

  saveDatasetAudit(cleaned.report);

  if (params.recordAuditLog) {
    insertAuditLog({
      eventType: 'data_audit',
      actor: 'Delta Market Pipeline',
      strategyId: null,
      symbol: params.symbol,
      action: `Audited ${cleaned.report.validBars} ${params.resolution} candles (quality ${cleaned.report.qualityScore}/100)`,
      details: {
        totalRawBars: cleaned.report.totalRawBars,
        validBars: cleaned.report.validBars,
        missingBarsDetected: cleaned.report.missingBarsDetected,
        duplicatesRemoved: cleaned.report.duplicatesRemoved,
        anomaliesRepaired: cleaned.report.anomaliesRepaired,
      },
      humanApproved: false,
    });
  }

  return {
    candles: cleaned.candles,
    report: cleaned.report,
    fetchedAt: candlesRes.fetchedAt,
  };
}

async function computeHeatmap(): Promise<MultiAssetRegimeCell[]> {
  const cached = heatmapCache.get('heatmap:live');
  if (cached) return cached.value;

  const pairs: Array<{ symbol: string; resolution: CandleResolution }> = [
    { symbol: 'BTCUSD', resolution: '5m' },
    { symbol: 'BTCUSD', resolution: '15m' },
    { symbol: 'BTCUSD', resolution: '1h' },
    { symbol: 'ETHUSD', resolution: '5m' },
    { symbol: 'ETHUSD', resolution: '15m' },
    { symbol: 'ETHUSD', resolution: '1h' },
  ];

  const cells = await Promise.all(
    pairs.map(async (p) => {
      const [{ candles }, tickerRes] = await Promise.all([
        loadCleanedMarketCandles({
          symbol: p.symbol,
          resolution: p.resolution,
          lookbackBars: 240,
        }),
        fetchTickerSnapshot(p.symbol).catch((err) => err),
      ]);

      const ticker = tickerRes instanceof Error ? null : tickerRes.ticker;
      const tickerError = tickerRes instanceof Error ? tickerRes.message : null;

      const regime = detectMarketRegime({
        symbol: p.symbol,
        resolution: p.resolution,
        basis: 'trade',
        candles,
        ticker,
        tickerError,
      });

      const shortVolItem = regime.inputs.find((i) => i.id === 'shortVol');
      const volZItem = regime.inputs.find((i) => i.id === 'volZScore');
      const trendItem = regime.inputs.find((i) => i.id === 'trendStrength');
      const lastCandle = candles[candles.length - 1] ?? null;

      return {
        symbol: p.symbol,
        resolution: p.resolution,
        currentRegime: regime.sufficientData ? regime.currentRegime : null,
        sufficientData: regime.sufficientData,
        riskScore: regime.sufficientData ? regime.score : null,
        shortVolPct:
          shortVolItem?.available && shortVolItem.value !== null
            ? shortVolItem.value * 100
            : null,
        volZScore: volZItem?.available ? volZItem.value : null,
        trendStrength: trendItem?.available ? trendItem.value : null,
        lastClose: lastCandle ? lastCandle.close : null,
        lastCandleIso: regime.lastCandleIso,
      } satisfies MultiAssetRegimeCell;
    }),
  );

  heatmapCache.set('heatmap:live', cells);
  return cells;
}

export async function getSentinelOverview(params: {
  symbol: string;
  resolution: CandleResolution;
}): Promise<SentinelOverviewResponse> {
  const cacheKey = `${params.symbol}:${params.resolution}:live`;
  const cached = analysisCache.get(cacheKey);
  if (cached) {
    return cached.value;
  }

  const [{ candles, report }, tickerRes, heatmap] = await Promise.all([
    loadCleanedMarketCandles({
      symbol: params.symbol,
      resolution: params.resolution,
      lookbackBars: 480,
      recordAuditLog: true,
    }),
    fetchTickerSnapshot(params.symbol).catch((err) => err),
    computeHeatmap(),
  ]);

  const ticker = tickerRes instanceof Error ? null : tickerRes.ticker;
  const tickerError = tickerRes instanceof Error ? tickerRes.message : null;

  const regime = detectMarketRegime({
    symbol: params.symbol,
    resolution: params.resolution,
    basis: 'trade',
    candles,
    ticker,
    tickerError,
  });

  const response: SentinelOverviewResponse = {
    selectedSymbol: params.symbol,
    resolution: params.resolution,
    dataMode: 'live',
    dataQuality: report,
    regime,
    heatmap,
    recentCandles: candles.slice(-140),
    generatedAt: new Date().toISOString(),
  };

  analysisCache.set(cacheKey, response);
  return response;
}

export function getAuditTrail(eventType?: string) {
  return listAuditLogs({ eventType, limit: 120 });
}
