import type {
  DecisionRecommendation,
  GuardrailBreach,
  GuardrailConfig,
  RegimeInference,
  RiskAction,
  RiskPredictionOutput,
  StrategyHealthBreakdown,
  StrategyProfile,
} from '../contracts/sentinel';

/**
 * Model 3: Transparent Risk Recommendation & Guardrail Decision Engine.
 * Combines:
 * - Model 1 Regime Classification & confidence
 * - Model 2 Strategy Deterioration Probability (30m / 60m)
 * - Strategy Health Score (0..100)
 * - Hard Risk Guardrail Limits
 * - Data Quality Score
 *
 * Falls back to conservative rule-based monitoring if data quality < 70 or
 * model confidence < 0.45. Never independently executes live orders.
 */
export function evaluateDecisionEngine(params: {
  strategy: StrategyProfile;
  health: StrategyHealthBreakdown;
  regime: RegimeInference;
  riskPrediction: RiskPredictionOutput;
  guardrail: GuardrailConfig;
  dataQualityScore: number;
}): DecisionRecommendation {
  const { strategy, health, regime, riskPrediction, guardrail, dataQualityScore } = params;
  const breaches: GuardrailBreach[] = [];
  const rationale: string[] = [];

  if (strategy.dailyLossPct >= guardrail.maxDailyLossPct) {
    breaches.push({
      rule: 'Maximum Daily Loss',
      currentValue: `${strategy.dailyLossPct.toFixed(2)}%`,
      thresholdValue: `${guardrail.maxDailyLossPct.toFixed(2)}%`,
      severity: 'Critical',
      explanation: `Daily loss (${strategy.dailyLossPct.toFixed(2)}%) reached or exceeded hard limit (${guardrail.maxDailyLossPct.toFixed(2)}%).`,
    });
  }

  if (strategy.recentDrawdownPct >= guardrail.maxDrawdownPct) {
    breaches.push({
      rule: 'Maximum Strategy Drawdown',
      currentValue: `${strategy.recentDrawdownPct.toFixed(2)}%`,
      thresholdValue: `${guardrail.maxDrawdownPct.toFixed(2)}%`,
      severity: 'Critical',
      explanation: `Recent drawdown (${strategy.recentDrawdownPct.toFixed(2)}%) breached max allowed (${guardrail.maxDrawdownPct.toFixed(2)}%).`,
    });
  }

  if (strategy.exposureUsd > guardrail.maxExposureUsd) {
    breaches.push({
      rule: 'Maximum Position Exposure',
      currentValue: `$${strategy.exposureUsd.toLocaleString()}`,
      thresholdValue: `$${guardrail.maxExposureUsd.toLocaleString()}`,
      severity: 'Warning',
      explanation: `Active notional exposure ($${strategy.exposureUsd.toLocaleString()}) exceeds cap ($${guardrail.maxExposureUsd.toLocaleString()}).`,
    });
  }

  if (strategy.leverage > guardrail.maxLeverage) {
    breaches.push({
      rule: 'Maximum Leverage',
      currentValue: `${strategy.leverage.toFixed(1)}x`,
      thresholdValue: `${guardrail.maxLeverage.toFixed(1)}x`,
      severity: 'Warning',
      explanation: `Effective leverage (${strategy.leverage.toFixed(1)}x) exceeds configured cap (${guardrail.maxLeverage.toFixed(1)}x).`,
    });
  }

  if (strategy.avgSlippageBps > guardrail.maxSlippageBps) {
    breaches.push({
      rule: 'Maximum Execution Slippage',
      currentValue: `${strategy.avgSlippageBps.toFixed(1)} bps`,
      thresholdValue: `${guardrail.maxSlippageBps.toFixed(1)} bps`,
      severity: 'Warning',
      explanation: `Average slippage (${strategy.avgSlippageBps.toFixed(1)} bps) exceeded execution quality budget (${guardrail.maxSlippageBps.toFixed(1)} bps).`,
    });
  }

  if (strategy.consecutiveLosses >= guardrail.maxConsecutiveLosses) {
    breaches.push({
      rule: 'Maximum Consecutive Losses',
      currentValue: `${strategy.consecutiveLosses}`,
      thresholdValue: `${guardrail.maxConsecutiveLosses}`,
      severity: 'Warning',
      explanation: `Consecutive losing trades (${strategy.consecutiveLosses}) reached threshold (${guardrail.maxConsecutiveLosses}).`,
    });
  }

  const maxRiskPct = Math.max(riskPrediction.probability30m, riskPrediction.probability60m) * 100;
  if (maxRiskPct >= guardrail.maxRiskProbPct) {
    breaches.push({
      rule: 'Maximum Predicted Risk Probability',
      currentValue: `${maxRiskPct.toFixed(1)}%`,
      thresholdValue: `${guardrail.maxRiskProbPct.toFixed(1)}%`,
      severity: maxRiskPct >= 78 ? 'Critical' : 'Warning',
      explanation: `Model 2 deterioration probability (${maxRiskPct.toFixed(1)}%) exceeded permitted ceiling (${guardrail.maxRiskProbPct.toFixed(1)}%).`,
    });
  }

  const poorData = dataQualityScore < 70;
  const lowConfidence = regime.confidence < 0.45 || riskPrediction.confidence < 0.45;
  const usedRuleFallback = poorData || lowConfidence || regime.isFallbackRule || riskPrediction.isFallbackRule;
  const fallbackReason = poorData
    ? `Data quality score (${dataQualityScore}/100) below 70 threshold — conservative rule monitoring active.`
    : lowConfidence
      ? `Model confidence (${Math.round(Math.min(regime.confidence, riskPrediction.confidence) * 100)}%) below 45% — conservative rule monitoring active.`
      : regime.isFallbackRule || riskPrediction.isFallbackRule
        ? 'Fallback deterministic rule thresholds applied.'
        : null;

  let action: RiskAction = 'CONTINUE';
  const hasCriticalBreach = breaches.some((b) => b.severity === 'Critical');
  const isHostile = strategy.hostileRegimes.includes(regime.regime);
  const isUnstable = regime.regime === 'Transition / Unstable';

  if (guardrail.status === 'killed') {
    action = 'CRITICAL RISK WARNING';
    rationale.push('Strategy kill switch is active; all live execution remains halted pending human review.');
  } else if (hasCriticalBreach || health.totalScore < 35 || riskPrediction.probability30m >= 0.78) {
    action = 'CRITICAL RISK WARNING';
  } else if (
    breaches.length >= 2 ||
    health.totalScore < 50 ||
    riskPrediction.probability30m >= 0.62 ||
    (isHostile && riskPrediction.probability30m >= 0.48)
  ) {
    action = 'CONSIDER PAUSING';
  } else if (
    breaches.length === 1 ||
    health.totalScore < 65 ||
    riskPrediction.probability30m >= 0.45 ||
    isHostile ||
    isUnstable
  ) {
    action = 'REDUCE EXPOSURE';
  } else if (health.totalScore < 78 || riskPrediction.probability30m >= 0.28 || usedRuleFallback) {
    action = 'MONITOR';
  } else {
    action = 'CONTINUE';
  }

  if (usedRuleFallback && action === 'CONTINUE') {
    action = 'MONITOR';
  }

  rationale.push(
    `Detected regime is ${regime.regime} (${Math.round(regime.confidence * 100)}% confidence); strategy prefers [${strategy.preferredRegimes.join(', ')}].`,
  );
  rationale.push(
    `Strategy Health Score is ${health.totalScore}/100 (${health.statusLabel}); 30m deterioration risk is ${Math.round(riskPrediction.probability30m * 100)}% (60m: ${Math.round(riskPrediction.probability60m * 100)}%).`,
  );
  if (breaches.length > 0) {
    rationale.push(
      `Triggered ${breaches.length} guardrail rule(s): ${breaches.map((b) => b.rule).join(', ')}.`,
    );
  }
  if (fallbackReason) {
    rationale.push(fallbackReason);
  }

  return {
    strategyId: strategy.id,
    action,
    humanApprovalRequired:
      guardrail.tradingMode === 'live_gated' || action !== 'CONTINUE',
    usedRuleFallback,
    fallbackReason,
    rationale,
    breaches,
  };
}
