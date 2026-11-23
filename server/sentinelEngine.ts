import { GoogleGenAI } from '@google/genai';
import type { CandleResolution, DeltaCandle } from '../src/contracts/delta.ts';
import {
  MARKET_REGIMES,
  type AlertSeverity,
  type DataSourceMode,
  type DatasetQualityReport,
  type ExplainablePrediction,
  type GuardrailConfig,
  type MarketRegime,
  type ModelVersionRecord,
  type MultiAssetRegimeCell,
  type PaperSimulationRequest,
  type PaperSimulationResult,
  type RegimeInference,
  type RegimeTimelinePoint,
  type RegimeTransitionAlert,
  type RiskAction,
  type SentinelOverviewResponse,
  type StrategyArchetype,
  type StrategyMonitorSnapshot,
  type StrategyProfile,
} from '../src/contracts/sentinel.ts';
import { createSeededRng } from '../src/ml/decisionTree.ts';
import { computePsi } from '../src/ml/metrics.ts';
import {
  inferRegimeWithModel,
  trainAndEvaluateRegimeModel,
  type RegimeAlgorithmChoice,
  type SerializedRegimeArtifact,
} from '../src/ml/regimeTrainer.ts';
import {
  predictStrategyDeterioration,
  trainAndEvaluateRiskModel,
  type SerializedRiskArtifact,
} from '../src/ml/riskTrainer.ts';
import { cleanAndAuditCandles, resolutionToSeconds } from '../src/quant/dataCleaner.ts';
import { evaluateDecisionEngine } from '../src/quant/decisionEngine.ts';
import { buildExplainablePrediction } from '../src/quant/explainEngine.ts';
import { engineerFeatures } from '../src/quant/indicators.ts';
import { runPaperSimulation } from '../src/quant/paperSimulator.ts';
import { calculateStrategyHealth } from '../src/quant/strategyHealth.ts';
import { TtlCache } from './cache.ts';
import {
  acknowledgeRegimeAlert,
  getDatabaseStats,
  getDeployedModelWithArtifact,
  insertAuditLog,
  insertRegimeAlert,
  listAuditLogs,
  listGuardrails,
  listModelVersions,
  listPaperRuns,
  listRegimeAlerts,
  loadHistoricalCandles,
  promoteModelVersion,
  saveDatasetAudit,
  saveModelVersion,
  savePaperRun,
  setAllGuardrailStatuses,
  updateGuardrail,
  upsertHistoricalCandles,
} from './db.ts';
import { fetchCandlesHistory, fetchTickerSnapshot } from './deltaClient.ts';

const analysisCache = new TtlCache<SentinelOverviewResponse>(18_000, 32);
const heatmapCache = new TtlCache<MultiAssetRegimeCell[]>(30_000, 10);

let initPromise: Promise<void> | null = null;
let trainingInProgress = false;

function generateDemoFallbackCandles(
  symbol: string,
  resolution: CandleResolution,
  count = 640,
): DeltaCandle[] {
  const stepSec = resolutionToSeconds(resolution);
  const nowSec = Math.floor(Date.now() / 1000);
  const alignedNow = Math.floor(nowSec / stepSec) * stepSec;
  const rng = createSeededRng(symbol === 'ETHUSD' ? 2048 : 1024);

  let price = symbol === 'ETHUSD' ? 3180 : 86400;
  const candles: DeltaCandle[] = [];

  for (let i = 0; i < count; i++) {
    const phase = Math.floor(i / 75) % 5;
    let drift = 0;
    let vol = 0.0028;
    if (phase === 0) {
      drift = 0.0017;
      vol = 0.0026;
    } else if (phase === 1) {
      drift = -0.0001 * Math.sin(i * 0.5);
      vol = 0.0014;
    } else if (phase === 2) {
      drift = 0.0002;
      vol = 0.0029;
    } else if (phase === 3) {
      drift = (i % 2 === 0 ? 1 : -1) * 0.0034;
      vol = 0.0115;
    } else {
      drift = -0.0008;
      vol = 0.0095;
    }

    const ret = drift + (rng() + rng() - 1) * vol;
    const open = price;
    const close = Math.max(open * 0.82, open * (1 + ret));
    const spread = Math.max(open * 0.0008, Math.abs(close - open) * 0.65 + open * vol * 0.45);
    candles.push({
      time: alignedNow - (count - 1 - i) * stepSec,
      open: Math.round(open * 100) / 100,
      high: Math.round((Math.max(open, close) + spread) * 100) / 100,
      low: Math.round((Math.min(open, close) - spread) * 100) / 100,
      close: Math.round(close * 100) / 100,
      volume: Math.round((110 + rng() * 260) * (vol > 0.006 ? 2.1 : 1)),
    });
    price = close;
  }

  return candles;
}

export async function loadCleanedMarketCandles(params: {
  symbol: string;
  resolution: CandleResolution;
  lookbackBars?: number;
  mode?: 'live' | 'demo';
}): Promise<{
  candles: DeltaCandle[];
  report: DatasetQualityReport;
  sourceMode: DataSourceMode;
  fundingRate: number;
  oiChangePct: number;
}> {
  const stepSec = resolutionToSeconds(params.resolution);
  const barsWanted = params.lookbackBars ?? 720;

  if (params.mode === 'demo') {
    const raw = generateDemoFallbackCandles(params.symbol, params.resolution, Math.max(480, barsWanted));
    const cleaned = cleanAndAuditCandles({
      rawCandles: raw,
      symbol: params.symbol,
      resolution: params.resolution,
      sourceMode: 'demo_fallback',
    });
    return {
      candles: cleaned.candles,
      report: cleaned.report,
      sourceMode: 'demo_fallback',
      fundingRate: 0.012,
      oiChangePct: 1.8,
    };
  }

  const end = Math.floor(Date.now() / 1000);
  const start = end - barsWanted * stepSec;

  let rawCandles: DeltaCandle[] = [];
  let sourceMode: DataSourceMode = 'live';
  let fundingRate = 0.01;
  let oiChangePct = 0;

  try {
    const [candlesRes, tickerRes] = await Promise.all([
      fetchCandlesHistory({
        symbol: params.symbol,
        resolution: params.resolution,
        start,
        end,
        basis: 'trade',
      }),
      fetchTickerSnapshot(params.symbol).catch(() => null),
    ]);

    rawCandles = candlesRes.payload.candles;
    if (tickerRes) {
      fundingRate = tickerRes.ticker.fundingRate ?? 0.01;
      const oiVal = tickerRes.ticker.oiValueUsd ?? 0;
      const oiChg = tickerRes.ticker.oiChangeUsd6h ?? 0;
      oiChangePct = oiVal > 0 ? Math.round((oiChg / oiVal) * 10000) / 100 : 0;
    }

    if (rawCandles.length > 0) {
      upsertHistoricalCandles({
        symbol: params.symbol,
        resolution: params.resolution,
        candles: rawCandles,
        source: 'Delta Exchange India REST /v2/history/candles',
      });
    }
  } catch (err) {
    console.warn(
      `[SentinelEngine] Live REST candle fetch failed for ${params.symbol} ${params.resolution}, checking SQLite cache:`,
      err instanceof Error ? err.message : err,
    );
  }

  if (rawCandles.length < 60) {
    const cached = loadHistoricalCandles({
      symbol: params.symbol,
      resolution: params.resolution,
      limit: Math.max(900, barsWanted),
    });
    if (cached.length >= 60) {
      rawCandles = cached;
      sourceMode = 'historical_cache';
    } else {
      rawCandles = generateDemoFallbackCandles(
        params.symbol,
        params.resolution,
        Math.max(520, barsWanted),
      );
      sourceMode = 'demo_fallback';
    }
  }

  const cleaned = cleanAndAuditCandles({
    rawCandles,
    symbol: params.symbol,
    resolution: params.resolution,
    sourceMode,
  });

  saveDatasetAudit(cleaned.report);
  return {
    candles: cleaned.candles,
    report: cleaned.report,
    sourceMode,
    fundingRate,
    oiChangePct,
  };
}

export async function ensureSentinelInitialized(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const existingRegime = getDeployedModelWithArtifact<SerializedRegimeArtifact>('regime');
    const existingRisk = getDeployedModelWithArtifact<SerializedRiskArtifact>('risk');

    if (existingRegime && existingRisk) {
      return;
    }

    console.log('[SentinelEngine] Bootstrapping initial ML models on BTCUSD 15m Delta candles...');
    const { candles, sourceMode } = await loadCleanedMarketCandles({
      symbol: 'BTCUSD',
      resolution: '15m',
      lookbackBars: 1400,
    });

    if (!existingRegime) {
      const regTrain = trainAndEvaluateRegimeModel({
        candles,
        algorithm: 'gbdt',
      });
      const rec = saveModelVersion({
        id: `reg-v1-${Date.now()}`,
        modelKind: 'regime',
        version: 'v1.0.0',
        algorithm: 'Gradient Boosted Trees',
        symbolScope: 'BTCUSD',
        resolution: '15m',
        deployed: true,
        status: 'deployed',
        metrics: regTrain.metrics,
        artifact: regTrain.artifact,
      });
      insertAuditLog({
        eventType: 'model_deploy',
        actor: 'System Bootstrap',
        strategyId: null,
        symbol: 'BTCUSD',
        action: `Deployed initial Model 1 (${rec.version}) on ${sourceMode} data`,
        details: {
          testAccuracy: rec.metrics.testAccuracy,
          macroF1: rec.metrics.macroF1,
          brierScore: rec.metrics.brierScore,
        },
        humanApproved: true,
      });
    }

    if (!existingRisk) {
      const riskTrain = trainAndEvaluateRiskModel({
        candles,
        horizonMinutes: 30,
      });
      const rec = saveModelVersion({
        id: `risk-v1-${Date.now()}`,
        modelKind: 'risk',
        version: 'v1.0.0',
        algorithm: 'XGBoost-Style Binary GBDT',
        symbolScope: 'BTCUSD',
        resolution: '15m',
        deployed: true,
        status: 'deployed',
        metrics: riskTrain.metrics,
        artifact: riskTrain.artifact,
      });
      insertAuditLog({
        eventType: 'model_deploy',
        actor: 'System Bootstrap',
        strategyId: null,
        symbol: 'BTCUSD',
        action: `Deployed initial Model 2 (${rec.version}) on ${sourceMode} data`,
        details: {
          testAccuracy: rec.metrics.testAccuracy,
          positivePrecision: rec.metrics.positivePrecision,
          positiveRecall: rec.metrics.positiveRecall,
          brierScore: rec.metrics.brierScore,
        },
        humanApproved: true,
      });
    }
  })().catch((err) => {
    initPromise = null;
    throw err;
  });

  return initPromise;
}

const STRATEGY_META: Record<
  string,
  {
    archetype: StrategyArchetype;
    timeframe: CandleResolution;
    preferredRegimes: MarketRegime[];
    hostileRegimes: MarketRegime[];
    baseLeverage: number;
    baseCapital: number;
  }
> = {
  'strat-btc-momentum': {
    archetype: 'trend_following',
    timeframe: '15m',
    preferredRegimes: ['Trending'],
    hostileRegimes: ['Ranging', 'Transition / Unstable'],
    baseLeverage: 5.0,
    baseCapital: 25000,
  },
  'strat-eth-grid': {
    archetype: 'mean_reversion',
    timeframe: '15m',
    preferredRegimes: ['Ranging', 'Low Volatility'],
    hostileRegimes: ['Trending', 'High Volatility', 'Transition / Unstable'],
    baseLeverage: 4.0,
    baseCapital: 20000,
  },
  'strat-btc-breakout': {
    archetype: 'volatility_breakout',
    timeframe: '15m',
    preferredRegimes: ['High Volatility', 'Trending'],
    hostileRegimes: ['Low Volatility', 'Transition / Unstable'],
    baseLeverage: 6.0,
    baseCapital: 25000,
  },
  'strat-eth-basis': {
    archetype: 'funding_arbitrage',
    timeframe: '1h',
    preferredRegimes: ['Low Volatility', 'Ranging'],
    hostileRegimes: ['High Volatility', 'Transition / Unstable'],
    baseLeverage: 3.0,
    baseCapital: 30000,
  },
};

function deriveRuntimeStrategyProfile(params: {
  guardrail: GuardrailConfig;
  candles: DeltaCandle[];
  regimeSeries: MarketRegime[];
}): StrategyProfile {
  const { guardrail, candles } = params;
  const meta = STRATEGY_META[guardrail.strategyId] ?? STRATEGY_META['strat-btc-momentum'];
  const features = engineerFeatures(candles);
  const tail = features.slice(-24);

  let equity = meta.baseCapital;
  let peak = meta.baseCapital;
  let maxDd = 0;
  let wins = 0;
  let consecLosses = 0;
  let grossWin = 0;
  let grossLoss = 0;
  const recentReturnsPct: number[] = [];

  for (let i = 1; i < tail.length; i++) {
    const f = tail[i];
    const r = f.ret1;
    const reg = params.regimeSeries[params.regimeSeries.length - tail.length + i] ?? 'Ranging';
    let stratRet = 0;

    if (meta.archetype === 'trend_following') {
      const dir = f.ema20 >= f.ema50 ? 1 : -1;
      stratRet = dir * r * (reg === 'Trending' ? 1.1 : -0.45);
    } else if (meta.archetype === 'mean_reversion') {
      const dir = f.close >= f.ema20 ? -1 : 1;
      stratRet = dir * r * (reg === 'Ranging' || reg === 'Low Volatility' ? 0.95 : -0.7);
    } else if (meta.archetype === 'volatility_breakout') {
      stratRet = (f.rangeExpansion > 1.25 ? Math.sign(r) : 0) * r * 0.95;
    } else {
      stratRet = 0.00035 - (reg === 'High Volatility' ? Math.abs(r) * 0.65 : Math.abs(r) * 0.08);
    }

    const scaled = Math.max(-0.08, Math.min(0.08, stratRet * meta.baseLeverage - 0.0004));
    recentReturnsPct.push(Math.round(scaled * 10000) / 100);
    equity *= 1 + scaled;
    if (equity > peak) peak = equity;
    const dd = ((peak - equity) / peak) * 100;
    if (dd > maxDd) maxDd = dd;

    if (scaled >= 0) {
      wins += 1;
      grossWin += scaled;
      consecLosses = 0;
    } else {
      grossLoss += Math.abs(scaled);
      consecLosses += 1;
    }
  }

  const latestFeature = tail[tail.length - 1];
  const recentDrawdownPct = Math.max(0, Math.round(((peak - equity) / peak) * 10000) / 100);
  const dailyLossPct = Math.max(
    0,
    Math.round(((meta.baseCapital - equity) / meta.baseCapital) * 10000) / 100,
  );
  const avgSlippageBps =
    latestFeature !== undefined
      ? Math.round((2.2 + latestFeature.rangeExpansion * 2.1 + Math.max(0, latestFeature.volumeChange) * 1.1) * 10) / 10
      : 3.5;

  const statusScale =
    guardrail.status === 'killed' || guardrail.status === 'paused'
      ? 0
      : guardrail.status === 'reduced'
        ? 0.5
        : 1;

  return {
    id: guardrail.strategyId,
    name: guardrail.strategyName,
    archetype: meta.archetype,
    symbol: guardrail.symbol,
    timeframe: meta.timeframe,
    preferredRegimes: meta.preferredRegimes,
    hostileRegimes: meta.hostileRegimes,
    tradingMode: guardrail.tradingMode,
    status: guardrail.status,
    leverage: Math.round(meta.baseLeverage * statusScale * 10) / 10,
    exposureUsd: Math.round(equity * meta.baseLeverage * 0.6 * statusScale),
    equityUsd: Math.round(equity),
    recentDrawdownPct,
    maxDrawdownPct: Math.round(maxDd * 100) / 100,
    dailyLossPct,
    winRatePct: Math.round((wins / Math.max(1, tail.length - 1)) * 100),
    profitFactor: Math.round(((grossWin + 0.002) / (grossLoss + 0.002)) * 100) / 100,
    consecutiveLosses: consecLosses,
    avgSlippageBps,
    recentReturnsPct,
    isSimulatedMetrics: true,
  };
}

async function computeHeatmap(mode: 'live' | 'demo'): Promise<MultiAssetRegimeCell[]> {
  const cacheKey = `heatmap:${mode}`;
  const cached = heatmapCache.get(cacheKey);
  if (cached) return cached.value;

  const deployedRegime = getDeployedModelWithArtifact<SerializedRegimeArtifact>('regime');
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
      const { candles, report, sourceMode } = await loadCleanedMarketCandles({
        symbol: p.symbol,
        resolution: p.resolution,
        lookbackBars: 240,
        mode,
      });
      const feats = engineerFeatures(candles);
      const latest = feats[feats.length - 1];
      const prev = feats[feats.length - 2];
      const inf = inferRegimeWithModel({
        symbol: p.symbol,
        resolution: p.resolution,
        featureRow: latest,
        prevFeatureRow: prev,
        artifact: deployedRegime?.artifact ?? null,
        modelVersion: deployedRegime?.record.version ?? 'Baseline',
        dataQualityScore: report.qualityScore,
      });

      return {
        symbol: p.symbol,
        resolution: p.resolution,
        regime: inf.regime,
        confidence: inf.confidence,
        atrPct: latest.atrPct,
        rsi14: latest.rsi14,
        trendStrength: latest.trendStrength,
        lastClose: latest.close,
        dataMode: sourceMode,
      } satisfies MultiAssetRegimeCell;
    }),
  );

  heatmapCache.set(cacheKey, cells);
  return cells;
}

export async function getSentinelOverview(params: {
  symbol: string;
  resolution: CandleResolution;
  mode?: 'live' | 'demo';
}): Promise<SentinelOverviewResponse> {
  await ensureSentinelInitialized();
  const mode = params.mode ?? 'live';
  const cacheKey = `${params.symbol}:${params.resolution}:${mode}`;
  const cached = analysisCache.get(cacheKey);
  if (cached && mode === 'live') {
    // Still refresh guardrail configs from DB so updates/kill-switch apply immediately
    return refreshGuardrailsOnCachedOverview(cached.value);
  }

  const deployedRegime = getDeployedModelWithArtifact<SerializedRegimeArtifact>('regime');
  const deployedRisk = getDeployedModelWithArtifact<SerializedRiskArtifact>('risk');

  const [{ candles, report, sourceMode, fundingRate, oiChangePct }, heatmap] =
    await Promise.all([
      loadCleanedMarketCandles({
        symbol: params.symbol,
        resolution: params.resolution,
        lookbackBars: 480,
        mode,
      }),
      computeHeatmap(mode),
    ]);

  const features = engineerFeatures(candles, { fundingRate, oiChangePct });
  const tailStart = Math.max(0, features.length - 72);
  const timeline: RegimeTimelinePoint[] = [];

  for (let i = tailStart; i < features.length; i++) {
    const inf = inferRegimeWithModel({
      symbol: params.symbol,
      resolution: params.resolution,
      featureRow: features[i],
      prevFeatureRow: i > 0 ? features[i - 1] : undefined,
      artifact: deployedRegime?.artifact ?? null,
      modelVersion: deployedRegime?.record.version ?? 'v1.0.0',
      dataQualityScore: report.qualityScore,
    });
    timeline.push({
      time: features[i].time,
      close: features[i].close,
      regime: inf.regime,
      confidence: inf.confidence,
      realizedVol20: features[i].realizedVol20,
      trendStrength: features[i].trendStrength,
      atrPct: features[i].atrPct,
    });
  }

  const latestFeature = features[features.length - 1];
  const prevFeature = features[features.length - 2];
  const latestRegime = inferRegimeWithModel({
    symbol: params.symbol,
    resolution: params.resolution,
    featureRow: latestFeature,
    prevFeatureRow: prevFeature,
    artifact: deployedRegime?.artifact ?? null,
    modelVersion: deployedRegime?.record.version ?? 'v1.0.0',
    dataQualityScore: report.qualityScore,
  });

  // Also load BTC & ETH 15m data for strategy telemetry grounding
  const btcCandles =
    params.symbol === 'BTCUSD'
      ? candles
      : (await loadCleanedMarketCandles({ symbol: 'BTCUSD', resolution: '15m', lookbackBars: 240, mode })).candles;
  const ethCandles =
    params.symbol === 'ETHUSD'
      ? candles
      : (await loadCleanedMarketCandles({ symbol: 'ETHUSD', resolution: '15m', lookbackBars: 240, mode })).candles;

  const btcFeatures = engineerFeatures(btcCandles);
  const ethFeatures = engineerFeatures(ethCandles);

  const guardrails = listGuardrails();
  const strategies: StrategyMonitorSnapshot[] = guardrails.map((g) => {
    const useEth = g.symbol === 'ETHUSD';
    const sCandles = useEth ? ethCandles : btcCandles;
    const sFeats = useEth ? ethFeatures : btcFeatures;
    const sLastFeat = sFeats[sFeats.length - 1];
    const sPrevFeat = sFeats[sFeats.length - 2];

    const sRegime = inferRegimeWithModel({
      symbol: g.symbol,
      resolution: '15m',
      featureRow: sLastFeat,
      prevFeatureRow: sPrevFeat,
      artifact: deployedRegime?.artifact ?? null,
      modelVersion: deployedRegime?.record.version ?? 'v1.0.0',
      dataQualityScore: report.qualityScore,
    });

    const profile = deriveRuntimeStrategyProfile({
      guardrail: g,
      candles: sCandles,
      regimeSeries: sFeats.slice(-30).map((f, idx, arr) =>
        inferRegimeWithModel({
          symbol: g.symbol,
          resolution: '15m',
          featureRow: f,
          prevFeatureRow: idx > 0 ? arr[idx - 1] : undefined,
          artifact: deployedRegime?.artifact ?? null,
          modelVersion: deployedRegime?.record.version ?? 'v1.0.0',
          dataQualityScore: report.qualityScore,
        }).regime,
      ),
    });

    const health = calculateStrategyHealth({
      strategy: profile,
      currentRegime: sRegime.regime,
      featureRow: sLastFeat,
    });

    const riskPredRaw = predictStrategyDeterioration({
      strategy: profile,
      regime: sRegime.regime,
      featureRow: sLastFeat,
      artifact: deployedRisk?.artifact ?? null,
      modelVersion: deployedRisk?.record.version ?? 'v1.0.0',
      dataQualityScore: report.qualityScore,
    });

    const riskPrediction = {
      strategyId: profile.id,
      symbol: profile.symbol,
      horizonMinutes: 30 as const,
      ...riskPredRaw,
      calibrationNote: deployedRisk
        ? `Platt-calibrated Brier=${deployedRisk.record.metrics.brierScore.toFixed(3)}`
        : 'Rule baseline calibration',
      modelVersion: deployedRisk?.record.version ?? 'Baseline',
    };

    const decision = evaluateDecisionEngine({
      strategy: profile,
      health,
      regime: sRegime,
      riskPrediction,
      guardrail: g,
      dataQualityScore: report.qualityScore,
    });

    return {
      strategy: profile,
      health,
      regime: sRegime,
      riskPrediction,
      decision,
      guardrail: g,
    };
  });

  // Detect regime transition on latest timeline pair & persist alert if new
  if (timeline.length >= 2) {
    const prevPt = timeline[timeline.length - 2];
    const currPt = timeline[timeline.length - 1];
    let distinctPrev: typeof currPt | undefined;
    for (let j = timeline.length - 2; j >= 0; j--) {
      if (timeline[j].regime !== currPt.regime) {
        distinctPrev = timeline[j];
        break;
      }
    }

    const existingAlerts = listRegimeAlerts({ limit: 5 }).filter(
      (a) => a.fromRegime !== a.toRegime,
    );
    const shouldEmit =
      prevPt.regime !== currPt.regime ||
      (existingAlerts.length === 0 && distinctPrev !== undefined);

    if (shouldEmit && distinctPrev) {
      const fromRegime = prevPt.regime !== currPt.regime ? prevPt.regime : distinctPrev.regime;
      const toRegime = currPt.regime;
      const alertId = `alert-${params.symbol}-${currPt.time}-${fromRegime}-${toRegime}`;
      const affected = strategies.filter(
        (s) => s.strategy.symbol === params.symbol || strategies.length <= 4,
      );
      const maxRisk = Math.max(...affected.map((a) => a.riskPrediction.probability30m), 0);
      const minH = Math.min(...affected.map((a) => a.health.totalScore), 100);
      const severity: AlertSeverity =
        toRegime === 'Transition / Unstable' || maxRisk >= 0.65 || minH < 45
          ? 'Critical'
          : toRegime === 'High Volatility' || prevPt.regime !== currPt.regime
            ? 'Warning'
            : 'Information';

      const topAction: RiskAction =
        severity === 'Critical'
          ? 'CONSIDER PAUSING'
          : severity === 'Warning'
            ? 'REDUCE EXPOSURE'
            : 'MONITOR';

      insertRegimeAlert({
        id: alertId,
        timestamp: new Date(currPt.time * 1000).toISOString(),
        symbol: params.symbol,
        fromRegime,
        toRegime,
        severity,
        affectedStrategies: affected.map((s) => ({
          strategyId: s.strategy.id,
          strategyName: s.strategy.name,
          healthScore: s.health.totalScore,
          riskProb30m: s.riskPrediction.probability30m,
          recommendedAction: s.decision.action,
        })),
        reason: `${params.symbol} transitioned from ${fromRegime} to ${toRegime} (ATR ${(latestFeature.atrPct * 100).toFixed(2)}%, Vol Clustering ${latestFeature.volClustering.toFixed(2)}x).`,
        recommendedAction: topAction,
        acknowledged: false,
      });
    }
  }

  const response: SentinelOverviewResponse = {
    selectedSymbol: params.symbol,
    resolution: params.resolution,
    dataMode: sourceMode,
    dataQuality: report,
    regime: latestRegime,
    timeline,
    heatmap,
    strategies,
    recentAlerts: listRegimeAlerts({ limit: 30 }),
    activeModels: {
      regime: deployedRegime?.record ?? null,
      risk: deployedRisk?.record ?? null,
    },
    recentCandles: candles.slice(-140),
    generatedAt: new Date().toISOString(),
  };

  if (mode === 'live') {
    analysisCache.set(cacheKey, response);
  }
  return response;
}

function refreshGuardrailsOnCachedOverview(
  cached: SentinelOverviewResponse,
): SentinelOverviewResponse {
  const guardrails = listGuardrails();
  const byId = new Map(guardrails.map((g) => [g.strategyId, g]));
  const updatedStrategies = cached.strategies.map((snap) => {
    const g = byId.get(snap.strategy.id) ?? snap.guardrail;
    const statusScale =
      g.status === 'killed' || g.status === 'paused' ? 0 : g.status === 'reduced' ? 0.5 : 1;
    const updatedStrat: StrategyProfile = {
      ...snap.strategy,
      status: g.status,
      tradingMode: g.tradingMode,
      leverage: Math.round((STRATEGY_META[g.strategyId]?.baseLeverage ?? 4) * statusScale * 10) / 10,
      exposureUsd: Math.round(snap.strategy.equityUsd * (STRATEGY_META[g.strategyId]?.baseLeverage ?? 4) * 0.6 * statusScale),
    };
    const health = calculateStrategyHealth({
      strategy: updatedStrat,
      currentRegime: snap.regime.regime,
      featureRow: snap.regime.features,
    });
    const decision = evaluateDecisionEngine({
      strategy: updatedStrat,
      health,
      regime: snap.regime,
      riskPrediction: snap.riskPrediction,
      guardrail: g,
      dataQualityScore: cached.dataQuality.qualityScore,
    });
    return {
      ...snap,
      strategy: updatedStrat,
      health,
      guardrail: g,
      decision,
    };
  });

  return {
    ...cached,
    strategies: updatedStrategies,
    recentAlerts: listRegimeAlerts({ limit: 30 }),
  };
}

export async function getStrategyExplanation(params: {
  symbol: string;
  resolution: CandleResolution;
  strategyId: string;
  mode?: 'live' | 'demo';
  includeGemini?: boolean;
}): Promise<ExplainablePrediction> {
  const overview = await getSentinelOverview({
    symbol: params.symbol,
    resolution: params.resolution,
    mode: params.mode,
  });

  const target =
    overview.strategies.find((s) => s.strategy.id === params.strategyId) ??
    overview.strategies[0];

  const base = buildExplainablePrediction({
    strategy: target.strategy,
    health: target.health,
    regime: target.regime,
    riskPrediction: target.riskPrediction,
    decision: target.decision,
    dataQuality: overview.dataQuality,
    riskBrierScore: overview.activeModels.risk?.metrics.brierScore ?? null,
    geminiNarrative: null,
    geminiAvailable: Boolean(process.env.GEMINI_API_KEY),
  });

  if (params.includeGemini && process.env.GEMINI_API_KEY) {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = [
        'You are the Risk Officer narrative synthesizer for Regime Sentinel (read-only crypto derivatives monitor).',
        'Summarize the risk state in 3 concise sentences using ONLY the exact verified numbers below.',
        'Do NOT invent any prices, percentages, or guarantees. Never advise buying or selling.',
        `Strategy: ${base.strategyName} (${base.symbol})`,
        `Regime: ${base.detectedRegime} (${base.regimeConfidencePct}% confidence)`,
        `Health Score: ${target.health.totalScore}/100 (${target.health.statusLabel})`,
        `30m Deterioration Risk: ${Math.round(target.riskPrediction.probability30m * 100)}%`,
        `Recommended Action: ${base.recommendedAction}`,
        `Key Risk Drivers: ${base.increasedRiskFactors.map((d) => `${d.label}=${d.value} (contrib ${d.contribution})`).join('; ')}`,
      ].join('\n');

      const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      base.geminiNarrative = result.text?.trim() || null;
    } catch (err) {
      console.warn('[SentinelEngine] Optional Gemini synthesis skipped:', err instanceof Error ? err.message : err);
    }
  }

  return base;
}

export async function triggerModelTraining(params: {
  modelKind: 'regime' | 'risk';
  algorithm?: RegimeAlgorithmChoice;
  symbol: string;
  resolution: CandleResolution;
  horizonMinutes?: 30 | 60;
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
  if (trainingInProgress) {
    throw new Error('A model training pipeline is already running. Please wait for it to finish.');
  }
  trainingInProgress = true;

  try {
    await ensureSentinelInitialized();
    const { candles, sourceMode } = await loadCleanedMarketCandles({
      symbol: params.symbol,
      resolution: params.resolution,
      lookbackBars: 1800,
    });

    const versions = listModelVersions(params.modelKind);
    const nextNum = versions.length + 1;
    const versionStr = `v1.${nextNum}.0`;

    let candidate: ModelVersionRecord;
    const currentDeployed = getDeployedModelWithArtifact(params.modelKind)?.record ?? null;

    if (params.modelKind === 'regime') {
      const algo: RegimeAlgorithmChoice = params.algorithm ?? 'gbdt';
      const trained = trainAndEvaluateRegimeModel({ candles, algorithm: algo });
      candidate = saveModelVersion({
        id: `reg-${Date.now()}`,
        modelKind: 'regime',
        version: versionStr,
        algorithm: algo === 'gbdt' ? 'Gradient Boosted Trees' : 'Random Forest',
        symbolScope: params.symbol,
        resolution: params.resolution,
        deployed: false,
        status: 'candidate',
        metrics: trained.metrics,
        artifact: trained.artifact,
      });
    } else {
      const horizon = params.horizonMinutes ?? 30;
      const trained = trainAndEvaluateRiskModel({ candles, horizonMinutes: horizon });
      candidate = saveModelVersion({
        id: `risk-${Date.now()}`,
        modelKind: 'risk',
        version: versionStr,
        algorithm: `XGBoost-Style Binary GBDT (${horizon}m)`,
        symbolScope: params.symbol,
        resolution: params.resolution,
        deployed: false,
        status: 'candidate',
        metrics: trained.metrics,
        artifact: trained.artifact,
      });
    }

    insertAuditLog({
      eventType: 'model_train',
      actor: 'Quant Operator',
      strategyId: null,
      symbol: params.symbol,
      action: `Trained ${params.modelKind} candidate ${candidate.version} (${candidate.algorithm}) on ${sourceMode}`,
      details: {
        testAccuracy: candidate.metrics.testAccuracy,
        valAccuracy: candidate.metrics.valAccuracy,
        macroF1: candidate.metrics.macroF1,
        brierScore: candidate.metrics.brierScore,
      },
      humanApproved: false,
    });

    const deltaAcc = currentDeployed
      ? Math.round((candidate.metrics.testAccuracy - currentDeployed.metrics.testAccuracy) * 10000) / 10000
      : null;

    const recommendation =
      currentDeployed === null
        ? 'Ready for human review and deployment.'
        : candidate.metrics.testAccuracy >= currentDeployed.metrics.testAccuracy &&
            candidate.metrics.brierScore <= currentDeployed.metrics.brierScore + 0.02
          ? 'Candidate improves or matches out-of-sample generalization; eligible for human-approved promotion.'
          : 'Candidate did NOT beat active deployed model on untouched test metrics; retain current production model unless investigating.';

    return {
      candidate,
      deployedComparison: {
        currentDeployedId: currentDeployed?.id ?? null,
        currentTestAccuracy: currentDeployed?.metrics.testAccuracy ?? null,
        candidateTestAccuracy: candidate.metrics.testAccuracy,
        deltaAccuracy: deltaAcc,
        recommendation,
      },
    };
  } finally {
    trainingInProgress = false;
  }
}

export async function getTrainingCenterStatus(symbol: string, resolution: CandleResolution) {
  await ensureSentinelInitialized();
  const { candles, report } = await loadCleanedMarketCandles({
    symbol,
    resolution,
    lookbackBars: 900,
  });

  const regimeModels = listModelVersions('regime');
  const riskModels = listModelVersions('risk');
  const deployedRegime = getDeployedModelWithArtifact<SerializedRegimeArtifact>('regime');

  // Live PSI drift calculation comparing deployed training baseline vs latest 120 bars
  let liveDriftPsi = 0;
  if (deployedRegime && candles.length >= 60) {
    const recentFeats = engineerFeatures(candles.slice(-140));
    const recentVols = recentFeats.slice(-100).map((f) => f.realizedVol20);
    liveDriftPsi = computePsi(deployedRegime.artifact.baselineRealizedVol, recentVols);
  }

  return {
    trainingInProgress,
    datasetReport: report,
    liveDriftPsi,
    liveDriftStatus:
      liveDriftPsi >= 0.25 ? 'Drift Alert' : liveDriftPsi >= 0.1 ? 'Moderate Shift' : 'Nominal',
    regimeModels,
    riskModels,
    dbStats: getDatabaseStats(),
  };
}

export function executeGuardrailUpdate(config: GuardrailConfig, actor = 'Risk Operator'): GuardrailConfig {
  const updated = updateGuardrail(config);
  insertAuditLog({
    eventType: 'guardrail_update',
    actor,
    strategyId: updated.strategyId,
    symbol: updated.symbol,
    action: `Updated guardrails for ${updated.strategyName} (mode=${updated.tradingMode}, status=${updated.status})`,
    details: {
      maxDailyLossPct: updated.maxDailyLossPct,
      maxDrawdownPct: updated.maxDrawdownPct,
      maxExposureUsd: updated.maxExposureUsd,
      maxLeverage: updated.maxLeverage,
      maxSlippageBps: updated.maxSlippageBps,
      maxConsecutiveLosses: updated.maxConsecutiveLosses,
      maxRiskProbPct: updated.maxRiskProbPct,
    },
    humanApproved: true,
  });
  return updated;
}

export function executeKillSwitch(params: { confirmed: boolean; reason: string; actor?: string }) {
  if (!params.confirmed) {
    throw new Error('Explicit human confirmation is required before triggering the kill switch.');
  }
  setAllGuardrailStatuses('killed');
  const log = insertAuditLog({
    eventType: 'kill_switch',
    actor: params.actor ?? 'Human Risk Operator',
    strategyId: null,
    symbol: 'ALL',
    action: 'GLOBAL KILL SWITCH ACTIVATED — all monitored strategies halted',
    details: { reason: params.reason },
    humanApproved: true,
  });
  return { guardrails: listGuardrails(), auditLog: log };
}

export function executeResumeStrategies(params: { confirmed: boolean; actor?: string }) {
  if (!params.confirmed) {
    throw new Error('Explicit human confirmation is required before resuming strategies.');
  }
  setAllGuardrailStatuses('active');
  const log = insertAuditLog({
    eventType: 'strategy_resume',
    actor: params.actor ?? 'Human Risk Operator',
    strategyId: null,
    symbol: 'ALL',
    action: 'Strategies resumed to paper-monitored active state after operator sign-off',
    details: { defaultMode: 'paper' },
    humanApproved: true,
  });
  return { guardrails: listGuardrails(), auditLog: log };
}

export function executeModelDeployment(params: { modelId: string; confirmed: boolean; actor?: string }) {
  if (!params.confirmed) {
    throw new Error('Explicit human validation & approval is required to replace a deployed model.');
  }
  const promoted = promoteModelVersion(params.modelId);
  if (!promoted) {
    throw new Error(`Model version ${params.modelId} not found.`);
  }
  insertAuditLog({
    eventType: 'model_deploy',
    actor: params.actor ?? 'Quant Reviewer',
    strategyId: null,
    symbol: promoted.symbolScope,
    action: `Human-approved promotion of ${promoted.modelKind} model ${promoted.version} (${promoted.algorithm})`,
    details: {
      modelId: promoted.id,
      testAccuracy: promoted.metrics.testAccuracy,
      macroF1: promoted.metrics.macroF1,
      brierScore: promoted.metrics.brierScore,
    },
    humanApproved: true,
  });
  return promoted;
}

export async function executePaperSimulation(
  req: PaperSimulationRequest,
): Promise<PaperSimulationResult> {
  let anchorPrice: number | undefined;
  try {
    const snap = await fetchTickerSnapshot(req.symbol);
    anchorPrice = snap.ticker.markPrice ?? snap.ticker.close ?? undefined;
  } catch {
    // Anchor defaults cleanly inside simulator
  }
  const result = runPaperSimulation(req, anchorPrice);
  savePaperRun(result);
  insertAuditLog({
    eventType: 'paper_simulation',
    actor: 'Paper Simulator',
    strategyId: req.strategyId,
    symbol: req.symbol,
    action: `Simulated ${req.strategyId} on ${req.symbol} (${req.simulateTransition ? `${req.targetRegime} -> ${req.transitionToRegime}` : req.targetRegime})`,
    details: {
      unguardedPnlUsd: result.summary.unguardedPnlUsd,
      protectedPnlUsd: result.summary.protectedPnlUsd,
      unguardedMaxDrawdownPct: result.summary.unguardedMaxDrawdownPct,
      protectedMaxDrawdownPct: result.summary.protectedMaxDrawdownPct,
      guardrailBreaches: result.summary.guardrailBreachesCount,
    },
    humanApproved: false,
  });
  return result;
}

export function getPaperRunHistory(): PaperSimulationResult[] {
  return listPaperRuns(10);
}

export function getAuditTrail(eventType?: string) {
  return listAuditLogs({ eventType, limit: 120 });
}

export function getAlertsHistory(severity?: AlertSeverity, symbol?: string): RegimeTransitionAlert[] {
  return listRegimeAlerts({ severity, symbol, limit: 80 });
}

export function ackAlert(id: string): boolean {
  return acknowledgeRegimeAlert(id);
}

export function getSupportedRegimes(): readonly MarketRegime[] {
  return MARKET_REGIMES;
}
