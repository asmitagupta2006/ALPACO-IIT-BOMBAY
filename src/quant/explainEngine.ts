import type {
  DatasetQualityReport,
  DecisionRecommendation,
  ExplainablePrediction,
  RegimeInference,
  RiskPredictionOutput,
  StrategyHealthBreakdown,
  StrategyProfile,
} from '../contracts/sentinel';

/**
 * Generates an honest, strictly feature-grounded 8-part Explainable AI dossier
 * from actual model outputs, feature values, tree-path attributions, and guardrail states.
 * Never fabricates indicator values or guarantees future market direction.
 */
export function buildExplainablePrediction(params: {
  strategy: StrategyProfile;
  health: StrategyHealthBreakdown;
  regime: RegimeInference;
  riskPrediction: RiskPredictionOutput;
  decision: DecisionRecommendation;
  dataQuality: DatasetQualityReport;
  riskBrierScore: number | null;
  geminiNarrative?: string | null;
  geminiAvailable?: boolean;
}): ExplainablePrediction {
  const { strategy, health, regime, riskPrediction, decision, dataQuality } = params;
  const f = regime.features;

  const isHostile = strategy.hostileRegimes.includes(regime.regime);
  const isUnstable = regime.regime === 'Transition / Unstable';
  const riskPct30 = Math.round(riskPrediction.probability30m * 100);
  const riskPct60 = Math.round(riskPrediction.probability60m * 100);
  const regimeConfPct = Math.round(regime.confidence * 100);

  const whatHappened =
    decision.breaches.length > 0
      ? `${strategy.name} on ${strategy.symbol} recorded ${decision.breaches.length} guardrail breach(es) under ${regime.regime} conditions, elevating 30m deterioration risk to ${riskPct30}%.`
      : isHostile || isUnstable
        ? `${strategy.symbol} entered a ${regime.regime} regime (${regimeConfPct}% confidence), creating structural mismatch for ${strategy.name} (Health ${health.totalScore}/100).`
        : `${strategy.symbol} is operating in ${regime.regime} (${regimeConfPct}% confidence) with ${strategy.name} Health at ${health.totalScore}/100 and ${riskPct30}% 30m breach risk.`;

  const indicatorsChanged = [
    {
      name: 'ATR % of Price',
      value: `${(f.atrPct * 100).toFixed(3)}%`,
      baselineDelta: f.atrPct > 0.008 ? 'Elevated bar range vs calm baseline' : 'Within normal range envelope',
    },
    {
      name: 'Realized Volatility (20)',
      value: `${(f.realizedVol20 * 100).toFixed(3)}%`,
      baselineDelta: `Vol Clustering (5/20): ${f.volClustering.toFixed(2)}x`,
    },
    {
      name: 'Trend Strength & Efficiency',
      value: `${(f.trendStrength * 100).toFixed(1)}%`,
      baselineDelta: `Kaufman ER: ${f.efficiencyRatio.toFixed(2)} · RSI(14): ${f.rsi14.toFixed(1)}`,
    },
    {
      name: 'Volume Surge & Range Expansion',
      value: `${(f.volumeChange * 100).toFixed(1)}%`,
      baselineDelta: `Range/ATR: ${f.rangeExpansion.toFixed(2)}x · Funding: ${f.fundingRate.toFixed(4)}%`,
    },
  ];

  const isPreferred = strategy.preferredRegimes.includes(regime.regime);
  const whyStrategyAffected = isHostile
    ? `${strategy.name} (${strategy.archetype.replace('_', ' ')}) is designed for [${strategy.preferredRegimes.join(', ')}] markets, whereas ${regime.regime} is in its hostile regime set [${strategy.hostileRegimes.join(', ')}]. At ${strategy.leverage}x leverage and ${strategy.avgSlippageBps.toFixed(1)} bps slippage, regime mismatch applies a -${health.components.regimeMismatchPenalty} point health penalty.`
    : isUnstable
      ? `Transition / Unstable conditions elevate stop-hunt whipsaws and widen effective spread/slippage (${strategy.avgSlippageBps.toFixed(1)} bps), reducing strategy health by -${health.components.regimeMismatchPenalty} points.`
      : isPreferred
        ? `${strategy.name} aligns with ${regime.regime} conditions (0 regime mismatch penalty); current risk stems from ${strategy.recentDrawdownPct.toFixed(2)}% recent drawdown, ${strategy.consecutiveLosses} consecutive losses, and ${strategy.leverage}x leverage exposure.`
        : `${strategy.name} prefers [${strategy.preferredRegimes.join(', ')}] markets, so ${regime.regime} is a secondary/neutral regime (-${health.components.regimeMismatchPenalty} point mismatch penalty). Combined with ${strategy.recentDrawdownPct.toFixed(2)}% recent drawdown and ${strategy.leverage}x leverage, execution buffers are tightened.`;

  const actionJustification =
    decision.action === 'CONTINUE'
      ? `CONTINUE is recommended because no hard guardrail limits are breached, strategy health is ${health.totalScore}/100, and 30m deterioration probability (${riskPct30}%) remains below intervention thresholds.`
      : `${decision.action} is recommended based on ${decision.rationale.join(' ')} Human operator review is required before executing live position adjustments.`;

  const limitations = [
    'Probabilities measure historical similarity to prior volatility/drawdown patterns and cannot predict exogenous news shocks or guaranteed future prices.',
    dataQuality.sourceMode === 'demo_fallback'
      ? 'Currently evaluating on clearly-labeled Demo Fallback historical bars because live exchange data is paused/unavailable.'
      : `Strategy execution metrics (drawdown ${strategy.recentDrawdownPct.toFixed(2)}%, slippage ${strategy.avgSlippageBps.toFixed(1)} bps) are runtime paper-monitored values rather than private exchange account fills.`,
    `Out-of-sample confidence depends on data freshness (${dataQuality.freshnessSeconds ?? 'N/A'}s lag) and distribution stability (Quality ${dataQuality.qualityScore}/100).`,
  ];

  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    symbol: strategy.symbol,
    generatedAt: new Date().toISOString(),
    whatHappened,
    indicatorsChanged,
    detectedRegime: regime.regime,
    regimeConfidencePct: regimeConfPct,
    whyStrategyAffected,
    increasedRiskFactors: riskPrediction.topFeatures,
    recommendedAction: decision.action,
    actionJustification,
    calibratedConfidence: {
      regimeConfidencePct: regimeConfPct,
      riskCalibrationBrier: params.riskBrierScore,
      dataQualityScore: dataQuality.qualityScore,
    },
    limitations,
    geminiNarrative: params.geminiNarrative ?? null,
    geminiAvailable: params.geminiAvailable ?? false,
  };
}
