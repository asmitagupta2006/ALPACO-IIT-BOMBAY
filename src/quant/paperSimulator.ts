import type { DeltaCandle } from '../contracts/delta';
import type {
  AlertSeverity,
  MarketRegime,
  PaperSimulationRequest,
  PaperSimulationResult,
  PaperSimulationStep,
  RiskAction,
  StrategyArchetype,
  StrategyProfile,
} from '../contracts/sentinel';
import { createSeededRng } from '../ml/decisionTree';
import { engineerFeatures } from './indicators';
import { calculateStrategyHealth } from './strategyHealth';

const STRATEGY_ARCHETYPES: Record<
  string,
  {
    name: string;
    archetype: StrategyArchetype;
    preferredRegimes: MarketRegime[];
    hostileRegimes: MarketRegime[];
  }
> = {
  'strat-btc-momentum': {
    name: 'BTC Momentum Trend',
    archetype: 'trend_following',
    preferredRegimes: ['Trending'],
    hostileRegimes: ['Ranging', 'Transition / Unstable'],
  },
  'strat-eth-grid': {
    name: 'ETH Mean-Reversion Grid',
    archetype: 'mean_reversion',
    preferredRegimes: ['Ranging', 'Low Volatility'],
    hostileRegimes: ['Trending', 'High Volatility', 'Transition / Unstable'],
  },
  'strat-btc-breakout': {
    name: 'BTC Volatility Breakout',
    archetype: 'volatility_breakout',
    preferredRegimes: ['High Volatility', 'Trending'],
    hostileRegimes: ['Low Volatility', 'Transition / Unstable'],
  },
  'strat-eth-basis': {
    name: 'ETH Funding Basis Arb',
    archetype: 'funding_arbitrage',
    preferredRegimes: ['Low Volatility', 'Ranging'],
    hostileRegimes: ['High Volatility', 'Transition / Unstable'],
  },
};

function generateRegimePathCandles(params: {
  symbol: 'BTCUSD' | 'ETHUSD';
  basePrice: number;
  barsCount: number;
  targetRegime: MarketRegime;
  simulateTransition: boolean;
  transitionToRegime: MarketRegime;
}): { candles: DeltaCandle[]; regimes: MarketRegime[] } {
  const rng = createSeededRng(
    params.symbol === 'BTCUSD' ? 9101 + params.barsCount : 4207 + params.barsCount,
  );
  const candles: DeltaCandle[] = [];
  const regimes: MarketRegime[] = [];
  const nowSec = Math.floor(Date.now() / 1000);
  const stepSec = 900; // 15m simulation step

  let price = params.basePrice;
  const splitIdx = Math.floor(params.barsCount * 0.45);

  for (let i = 0; i < params.barsCount; i++) {
    let activeRegime = params.targetRegime;
    if (params.simulateTransition) {
      if (i >= splitIdx && i < splitIdx + 4) {
        activeRegime = 'Transition / Unstable';
      } else if (i >= splitIdx + 4) {
        activeRegime = params.transitionToRegime;
      }
    }
    regimes.push(activeRegime);

    const z = (rng() + rng() + rng() - 1.5) * 1.4; // approx normal
    let drift = 0;
    let vol = 0.0028;

    if (activeRegime === 'Trending') {
      drift = 0.0022;
      vol = 0.0032;
    } else if (activeRegime === 'Ranging') {
      drift = -0.0025 * ((price - params.basePrice) / params.basePrice);
      vol = 0.0022;
    } else if (activeRegime === 'High Volatility') {
      drift = 0.0005 * Math.sin(i * 0.45);
      vol = 0.0115;
    } else if (activeRegime === 'Low Volatility') {
      drift = 0.0001;
      vol = 0.0012;
    } else {
      // Transition / Unstable: whipsaw reversals + spike vol
      drift = (i % 2 === 0 ? 1 : -1) * 0.0045;
      vol = 0.0135;
    }

    const ret = drift + z * vol;
    const open = price;
    const close = Math.max(open * 0.85, open * (1 + ret));
    const wickScale = Math.max(0.001, Math.abs(ret) * 0.8 + vol * (0.7 + rng()));
    const high = Math.max(open, close) * (1 + wickScale * 0.6);
    const low = Math.min(open, close) * (1 - wickScale * 0.6);
    const volume =
      (activeRegime === 'High Volatility' || activeRegime === 'Transition / Unstable' ? 2.4 : 1.0) *
      (120 + rng() * 240);

    candles.push({
      time: nowSec - (params.barsCount - i) * stepSec,
      open,
      high,
      low,
      close,
      volume,
    });
    price = close;
  }

  return { candles, regimes };
}

export function runPaperSimulation(
  req: PaperSimulationRequest,
  anchorPrice?: number,
): PaperSimulationResult {
  const meta = STRATEGY_ARCHETYPES[req.strategyId] ?? STRATEGY_ARCHETYPES['strat-btc-momentum'];
  const basePrice = anchorPrice && anchorPrice > 0 ? anchorPrice : req.symbol === 'BTCUSD' ? 86500 : 3150;

  const { candles, regimes } = generateRegimePathCandles({
    symbol: req.symbol,
    basePrice,
    barsCount: Math.max(30, Math.min(160, req.barsCount)),
    targetRegime: req.targetRegime,
    simulateTransition: req.simulateTransition,
    transitionToRegime: req.transitionToRegime,
  });

  const features = engineerFeatures(candles);
  let unguardedEquity = req.capitalUsd;
  let unguardedPeak = req.capitalUsd;
  let unguardedMaxDd = 0;

  let protectedEquity = req.capitalUsd;
  let protectedPeak = req.capitalUsd;
  let protectedMaxDd = 0;

  let consecLosses = 0;
  let wins = 0;
  let totalTrades = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let minHealth = 100;
  let riskEventsCount = 0;
  let guardrailBreachesCount = 0;
  let totalExecutionCostsUsd = 0;
  let exposureReductions = 0;
  let exposureMultiplier = 1.0;

  const steps: PaperSimulationStep[] = [];
  const events: PaperSimulationResult['events'] = [];

  for (let i = 1; i < features.length; i++) {
    const f = features[i];
    const prev = features[i - 1];
    const regime = regimes[i];
    const prevRegime = regimes[i - 1];

    const ret = (f.close - prev.close) / Math.max(prev.close, 1);
    let rawSignalRet = 0;

    if (meta.archetype === 'trend_following') {
      const dir = f.ema20 >= f.ema50 ? 1 : -1;
      rawSignalRet = dir * ret * (regime === 'Trending' ? 1.15 : regime === 'Transition / Unstable' ? -0.9 : -0.35);
    } else if (meta.archetype === 'mean_reversion') {
      const dev = (prev.close - prev.ema20) / Math.max(prev.ema20, 1);
      const dir = dev >= 0 ? -1 : 1;
      rawSignalRet = dir * ret * (regime === 'Ranging' || regime === 'Low Volatility' ? 1.0 : -0.85);
    } else if (meta.archetype === 'volatility_breakout') {
      const dir = f.rangeExpansion > 1.2 ? Math.sign(ret) : 0;
      rawSignalRet = dir * ret * (regime === 'High Volatility' || regime === 'Trending' ? 1.1 : -0.45);
    } else {
      rawSignalRet =
        0.00045 - (regime === 'High Volatility' || regime === 'Transition / Unstable' ? Math.abs(ret) * 0.75 : Math.abs(ret) * 0.1);
    }

    const dynamicSlippageBps =
      req.baseSlippageBps + (f.rangeExpansion > 1.4 ? (f.rangeExpansion - 1) * 4.5 : 0);
    const feeAndSlippageRate = ((req.takerFeeBps + dynamicSlippageBps) / 10000) * 0.45;

    // Unguarded baseline
    const unguardedBarRet = rawSignalRet * req.leverage - feeAndSlippageRate * req.leverage;
    unguardedEquity = Math.max(100, unguardedEquity * (1 + unguardedBarRet));
    if (unguardedEquity > unguardedPeak) unguardedPeak = unguardedEquity;
    const uDd = ((unguardedPeak - unguardedEquity) / unguardedPeak) * 100;
    if (uDd > unguardedMaxDd) unguardedMaxDd = uDd;

    // Sentinel-protected trajectory (uses prior bar's exposureMultiplier)
    const effectiveLev = req.leverage * exposureMultiplier;
    const execCost = protectedEquity * effectiveLev * feeAndSlippageRate;
    totalExecutionCostsUsd += execCost;

    const protectedBarRet = rawSignalRet * effectiveLev - feeAndSlippageRate * effectiveLev;
    protectedEquity = Math.max(100, protectedEquity * (1 + protectedBarRet));
    if (protectedEquity > protectedPeak) protectedPeak = protectedEquity;
    const pDd = ((protectedPeak - protectedEquity) / protectedPeak) * 100;
    if (pDd > protectedMaxDd) protectedMaxDd = pDd;

    totalTrades += 1;
    if (protectedBarRet >= 0) {
      wins += 1;
      grossWin += protectedBarRet;
      consecLosses = 0;
    } else {
      grossLoss += Math.abs(protectedBarRet);
      consecLosses += 1;
    }

    const simProfile: StrategyProfile = {
      id: req.strategyId,
      name: meta.name,
      archetype: meta.archetype,
      symbol: req.symbol,
      timeframe: '15m',
      preferredRegimes: meta.preferredRegimes,
      hostileRegimes: meta.hostileRegimes,
      tradingMode: 'paper',
      status: exposureMultiplier === 0 ? 'paused' : exposureMultiplier < 1 ? 'reduced' : 'active',
      leverage: effectiveLev,
      exposureUsd: Math.round(protectedEquity * effectiveLev),
      equityUsd: Math.round(protectedEquity),
      recentDrawdownPct: Math.round(pDd * 100) / 100,
      maxDrawdownPct: Math.round(protectedMaxDd * 100) / 100,
      dailyLossPct: Math.max(0, Math.round(((req.capitalUsd - protectedEquity) / req.capitalUsd) * 10000) / 100),
      winRatePct: Math.round((wins / Math.max(1, totalTrades)) * 100),
      profitFactor: Math.round(((grossWin + 0.001) / (grossLoss + 0.001)) * 100) / 100,
      consecutiveLosses: consecLosses,
      avgSlippageBps: Math.round(dynamicSlippageBps * 10) / 10,
      recentReturnsPct: [],
      isSimulatedMetrics: true,
    };

    const health = calculateStrategyHealth({
      strategy: simProfile,
      currentRegime: regime,
      featureRow: f,
    });
    if (health.totalScore < minHealth) minHealth = health.totalScore;

    const isHostile = meta.hostileRegimes.includes(regime);
    const riskProb30m = Math.min(
      0.95,
      Math.max(
        0.05,
        0.12 +
          (isHostile ? 0.34 : 0) +
          (regime === 'Transition / Unstable' ? 0.22 : 0) +
          Math.min(0.25, pDd * 0.04) +
          Math.min(0.18, consecLosses * 0.04),
      ),
    );

    let action: RiskAction = 'CONTINUE';
    let guardrailTriggered: string | null = null;

    if (pDd >= 6.0 || health.totalScore < 38 || riskProb30m >= 0.78) {
      action = 'CRITICAL RISK WARNING';
      guardrailTriggered = pDd >= 6.0 ? 'Max Drawdown >= 6%' : 'Critical Health / Risk Threshold';
      guardrailBreachesCount += 1;
      riskEventsCount += 1;
      if (exposureMultiplier > 0.25) {
        exposureMultiplier = 0.25;
        exposureReductions += 1;
      }
    } else if (health.totalScore < 55 || riskProb30m >= 0.58) {
      action = 'CONSIDER PAUSING';
      guardrailTriggered = 'Deterioration Risk >= 58%';
      riskEventsCount += 1;
      if (exposureMultiplier > 0.4) {
        exposureMultiplier = 0.4;
        exposureReductions += 1;
      }
    } else if (isHostile || health.totalScore < 68 || riskProb30m >= 0.42) {
      action = 'REDUCE EXPOSURE';
      if (exposureMultiplier > 0.6) {
        exposureMultiplier = 0.6;
        exposureReductions += 1;
      }
    } else {
      exposureMultiplier = Math.min(1.0, exposureMultiplier + 0.15);
    }

    if (regime !== prevRegime) {
      const sev: AlertSeverity =
        regime === 'Transition / Unstable' || meta.hostileRegimes.includes(regime)
          ? 'Warning'
          : 'Information';
      events.push({
        step: i,
        time: f.time,
        severity: sev,
        title: `Regime Transition: ${prevRegime} → ${regime}`,
        detail: `Health adjusted to ${health.totalScore}/100 · Risk Prob ${Math.round(riskProb30m * 100)}% · Multiplier ${Math.round(exposureMultiplier * 100)}%`,
        action,
      });
    } else if (guardrailTriggered && events.length < 18) {
      events.push({
        step: i,
        time: f.time,
        severity: 'Critical',
        title: `Guardrail Triggered: ${guardrailTriggered}`,
        detail: `Simulated drawdown ${pDd.toFixed(2)}%, slippage ${dynamicSlippageBps.toFixed(1)} bps. Sentinel recommended ${action}.`,
        action,
      });
    }

    steps.push({
      step: i,
      time: f.time,
      close: Math.round(f.close * 100) / 100,
      regime,
      unguardedEquity: Math.round(unguardedEquity * 100) / 100,
      protectedEquity: Math.round(protectedEquity * 100) / 100,
      healthScore: health.totalScore,
      riskProb30m: Math.round(riskProb30m * 1000) / 1000,
      action,
      guardrailTriggered,
      executionCostUsd: Math.round(execCost * 100) / 100,
    });
  }

  return {
    id: `sim-${Date.now()}`,
    isSimulated: true,
    disclaimer:
      'SIMULATED PAPER TRADING: Equity, slippage, and protective scaling are computed in a simulated Delta Exchange environment and do not represent live trading profits.',
    request: req,
    summary: {
      unguardedFinalEquity: Math.round(unguardedEquity * 100) / 100,
      unguardedPnlUsd: Math.round((unguardedEquity - req.capitalUsd) * 100) / 100,
      unguardedMaxDrawdownPct: Math.round(unguardedMaxDd * 100) / 100,
      protectedFinalEquity: Math.round(protectedEquity * 100) / 100,
      protectedPnlUsd: Math.round((protectedEquity - req.capitalUsd) * 100) / 100,
      protectedMaxDrawdownPct: Math.round(protectedMaxDd * 100) / 100,
      minHealthScore: minHealth,
      riskEventsCount,
      guardrailBreachesCount,
      totalExecutionCostsUsd: Math.round(totalExecutionCostsUsd * 100) / 100,
      exposureReductions,
    },
    steps,
    events,
  };
}
