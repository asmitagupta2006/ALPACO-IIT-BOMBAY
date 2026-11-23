import type {
  EngineeredFeatureRow,
  MarketRegime,
  StrategyHealthBreakdown,
  StrategyProfile,
} from '../contracts/sentinel';

/**
 * Documented Strategy Health Formula (0..100):
 * Health = clamp(0, 100,
 *   100
 *   - DrawdownPenalty       [min(30, recentDD*2.2 + maxDD*0.8)]
 *   - StreakPenalty         [min(20, consecutiveLosses * 4.2)]
 *   - SlippagePenalty       [min(15, max(0, avgSlippageBps - 2.5) * 1.4)]
 *   - VolExposurePenalty    [min(18, leverage * (atrPct * 100) * 1.15)]
 *   - RegimeMismatchPenalty [0 if preferred, 8 if neutral, 22 if hostile/unstable]
 *   + ProfitFactorAdj       [clamp(-8, +8, (profitFactor - 1.25) * 6)]
 * )
 */
export function calculateStrategyHealth(params: {
  strategy: StrategyProfile;
  currentRegime: MarketRegime;
  featureRow: EngineeredFeatureRow;
}): StrategyHealthBreakdown {
  const { strategy, currentRegime, featureRow } = params;

  const drawdownPenalty = Math.min(
    30,
    Math.round((strategy.recentDrawdownPct * 2.2 + strategy.maxDrawdownPct * 0.8) * 10) / 10,
  );
  const streakPenalty = Math.min(
    20,
    Math.round(strategy.consecutiveLosses * 4.2 * 10) / 10,
  );
  const slippagePenalty = Math.min(
    15,
    Math.round(Math.max(0, strategy.avgSlippageBps - 2.5) * 1.4 * 10) / 10,
  );
  const volExposurePenalty = Math.min(
    18,
    Math.round(strategy.leverage * (featureRow.atrPct * 100) * 1.15 * 10) / 10,
  );

  let regimeMismatchPenalty = 8;
  if (strategy.preferredRegimes.includes(currentRegime)) {
    regimeMismatchPenalty = 0;
  } else if (
    strategy.hostileRegimes.includes(currentRegime) ||
    currentRegime === 'Transition / Unstable'
  ) {
    regimeMismatchPenalty = currentRegime === 'Transition / Unstable' ? 20 : 22;
  }

  const profitFactorAdjustment = Math.max(
    -8,
    Math.min(8, Math.round((strategy.profitFactor - 1.25) * 6 * 10) / 10),
  );

  const rawScore =
    100 -
    drawdownPenalty -
    streakPenalty -
    slippagePenalty -
    volExposurePenalty -
    regimeMismatchPenalty +
    profitFactorAdjustment;

  const totalScore = Math.max(0, Math.min(100, Math.round(rawScore)));
  const statusLabel =
    totalScore >= 75
      ? 'Healthy'
      : totalScore >= 55
        ? 'Watch'
        : totalScore >= 35
          ? 'Degraded'
          : 'Critical';

  return {
    strategyId: strategy.id,
    totalScore,
    statusLabel,
    components: {
      baseScore: 100,
      drawdownPenalty,
      streakPenalty,
      slippagePenalty,
      volExposurePenalty,
      regimeMismatchPenalty,
      profitFactorAdjustment,
    },
    formulaSummary:
      '100 - DD_Penalty(<=30) - Streak_Penalty(<=20) - Slippage_Penalty(<=15) - VolLev_Penalty(<=18) - Regime_Mismatch(0|8|20|22) + PF_Adj([-8,+8])',
    measuredVsSimulated: strategy.isSimulatedMetrics
      ? 'Market ATR/Regime measured from Delta candles; Strategy PnL/drawdown/slippage are simulated runtime telemetry.'
      : 'Measured runtime execution metrics paired with live Delta Exchange candle volatility.',
  };
}
