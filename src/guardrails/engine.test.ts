import test from 'node:test';
import assert from 'node:assert/strict';
import type { GuardrailRule } from '../contracts/guardrails.ts';
import type { Phase2RegimeResponse } from '../contracts/regime.ts';
import {
  evaluateGuardrailRules,
  reconcileAlertFeed,
  validateCooldownSeconds,
  validateGuardrailRule,
} from './engine.ts';

function makeRegimeSnapshot(overrides?: Partial<Phase2RegimeResponse>): Phase2RegimeResponse {
  return {
    symbol: 'BTCUSD',
    resolution: '15m',
    basis: 'trade',
    sufficientData: true,
    insufficientReason: null,
    candlesRequired: 65,
    candleCountUsed: 96,
    classifiedBarCount: 32,
    lastCandleTimestamp: 1700000000,
    lastCandleIso: '2026-11-23T12:00:00.000Z',
    currentRegime: 'Trending',
    score: 50.0,
    inputs: [
      {
        id: 'logReturn',
        label: 'Log Return (Latest Bar)',
        category: 'candle',
        available: true,
        value: 0.004,
        formattedValue: '+0.4000%',
        unit: '%',
        weight: 0,
        reasonIfExcluded: null,
        formulaNote: '',
      },
      {
        id: 'shortVol',
        label: 'Realized Volatility (14-bar)',
        category: 'candle',
        available: true,
        value: 0.01,
        formattedValue: '1.0000%',
        unit: '% / bar',
        weight: 0,
        reasonIfExcluded: null,
        formulaNote: '',
      },
      {
        id: 'volZScore',
        label: 'Volatility Z-Score (50-bar baseline)',
        category: 'candle',
        available: true,
        value: 1.5,
        formattedValue: '+1.50σ',
        unit: 'σ',
        weight: 0.42,
        reasonIfExcluded: null,
        formulaNote: '',
      },
      {
        id: 'trendStrength',
        label: 'Trend Strength (EMA 20 / Vol)',
        category: 'candle',
        available: true,
        value: -0.6,
        formattedValue: '-0.60σ',
        unit: 'σ',
        weight: 0.16,
        reasonIfExcluded: null,
        formulaNote: '',
      },
      {
        id: 'cusumMax',
        label: 'Return CUSUM Change-Point',
        category: 'candle',
        available: true,
        value: 2.2,
        formattedValue: '2.20σ',
        unit: 'σ',
        weight: 0.31,
        reasonIfExcluded: null,
        formulaNote: '',
      },
      {
        id: 'fundingRate',
        label: 'Funding Rate (8h)',
        category: 'ticker_optional',
        available: true,
        value: 0.012,
        formattedValue: '+0.0120%',
        unit: '%',
        weight: 0.05,
        reasonIfExcluded: null,
        formulaNote: '',
      },
      {
        id: 'markIndexBasis',
        label: 'Mark vs Spot Basis',
        category: 'ticker_optional',
        available: true,
        value: -0.05,
        formattedValue: '-0.0500%',
        unit: '%',
        weight: 0.04,
        reasonIfExcluded: null,
        formulaNote: '',
      },
      {
        id: 'oiChange6h',
        label: '6h Open Interest Change',
        category: 'ticker_optional',
        available: true,
        value: 4.5,
        formattedValue: '+4.50%',
        unit: '%',
        weight: 0.02,
        reasonIfExcluded: null,
        formulaNote: '',
      },
      {
        id: 'impliedVolatility',
        label: 'Implied Volatility (Mark IV)',
        category: 'ticker_optional',
        available: false,
        value: null,
        formattedValue: 'Excluded',
        unit: '%',
        weight: 0,
        reasonIfExcluded: 'Options only (absent on perpetual/futures contracts)',
        formulaNote: '',
      },
    ],
    parameters: {
      shortVolWindow: 14,
      baselineVolWindow: 50,
      minCandlesRequired: 65,
      emaWindow: 20,
      emaSlopeLookback: 5,
      cusumDriftK: 0.5,
      cusumThresholdH: 4,
      volZHighThreshold: 1.5,
      trendStrengthThreshold: 0.25,
      gapToleranceMultiplier: 1.5,
      weights: { volZ: 0.4, cusum: 0.3, trend: 0.15, optionalPoolMax: 0.15 },
    },
    series: [],
    transitions: [],
    timestampGaps: [],
    tickerAvailable: true,
    tickerError: null,
    source: 'Source: Delta candles',
    computedAt: '2026-11-23T12:05:00.000Z',
    ...overrides,
  };
}

test('1. Boundary values: strict > does not fire at exact threshold, >= fires at exact threshold', () => {
  const regime = makeRegimeSnapshot({ score: 50.0 });
  const strictGtRule: GuardrailRule = {
    id: 'r_gt',
    name: 'Score Strictly Above 50',
    logic: 'OR',
    action: 'REDUCE SIZE',
    enabled: true,
    conditions: [{ id: 'c1', metric: 'risk_score', operator: '>', thresholdNumber: 50 }],
  };
  const gteRule: GuardrailRule = {
    id: 'r_gte',
    name: 'VolZ At Least 1.5',
    logic: 'OR',
    action: 'REDUCE SIZE',
    enabled: true,
    conditions: [{ id: 'c2', metric: 'vol_z_score', operator: '>=', thresholdNumber: 1.5 }],
  };

  const evalStrict = evaluateGuardrailRules({
    regimeOutput: regime,
    rules: [strictGtRule],
  });
  assert.equal(evalStrict.available, true);
  assert.equal(evalStrict.action, 'CONTINUE');
  assert.equal(evalStrict.firedRules.length, 0);

  const evalGte = evaluateGuardrailRules({
    regimeOutput: regime,
    rules: [strictGtRule, gteRule],
  });
  assert.equal(evalGte.available, true);
  assert.equal(evalGte.action, 'REDUCE SIZE');
  assert.equal(evalGte.firedRules.length, 1);
  assert.equal(evalGte.firedRules[0].ruleId, 'r_gte');
});

test('2. Multiple rules firing: most severe action (PAUSE) wins and ALL fired rules are listed', () => {
  const regime = makeRegimeSnapshot({
    currentRegime: 'High-Volatility/Shock',
    score: 82.5,
  });

  const reduceRule: GuardrailRule = {
    id: 'r_reduce',
    name: 'Shock Regime Size Cut',
    logic: 'OR',
    action: 'REDUCE SIZE',
    enabled: true,
    conditions: [
      { id: 'c1', metric: 'regime', operator: '=', thresholdRegime: 'High-Volatility/Shock' },
    ],
  };

  const pauseRule: GuardrailRule = {
    id: 'r_pause',
    name: 'Extreme Score Halt',
    logic: 'OR',
    action: 'PAUSE',
    enabled: true,
    conditions: [{ id: 'c2', metric: 'risk_score', operator: '>', thresholdNumber: 75 }],
  };

  const evalOut = evaluateGuardrailRules({
    regimeOutput: regime,
    rules: [reduceRule, pauseRule],
  });

  assert.equal(evalOut.available, true);
  assert.equal(evalOut.action, 'PAUSE');
  assert.equal(evalOut.firedRules.length, 2);
  assert.deepEqual(
    evalOut.firedRules.map((r) => r.ruleId),
    ['r_reduce', 'r_pause'],
  );
  assert.equal(evalOut.symbol, 'BTCUSD');
  assert.equal(evalOut.timeframe, '15m');
});

test('3. Disabled rules do not evaluate or fire even when threshold is breached', () => {
  const regime = makeRegimeSnapshot({ score: 92 });
  const disabledPause: GuardrailRule = {
    id: 'r_disabled',
    name: 'Disabled Halt',
    logic: 'OR',
    action: 'PAUSE',
    enabled: false,
    conditions: [{ id: 'c1', metric: 'risk_score', operator: '>', thresholdNumber: 20 }],
  };

  const out = evaluateGuardrailRules({
    regimeOutput: regime,
    rules: [disabledPause],
  });

  assert.equal(out.available, true);
  assert.equal(out.enabledRuleCount, 0);
  assert.equal(out.action, 'CONTINUE');
  assert.equal(out.firedRules.length, 0);
});

test('4. Missing inputs: excluded ticker metric does not trigger and insufficient regime emits NO recommendation', () => {
  const perpRegime = makeRegimeSnapshot({ score: 45 });
  const ivRule: GuardrailRule = {
    id: 'r_iv',
    name: 'Option IV Spike',
    logic: 'AND',
    action: 'PAUSE',
    enabled: true,
    conditions: [{ id: 'c1', metric: 'implied_volatility', operator: '>', thresholdNumber: 80 }],
  };

  const outExcluded = evaluateGuardrailRules({
    regimeOutput: perpRegime,
    rules: [ivRule],
  });
  assert.equal(outExcluded.available, true);
  assert.equal(outExcluded.action, 'CONTINUE');
  assert.equal(outExcluded.firedRules.length, 0);
  assert.equal(outExcluded.missingInputs.length, 1);
  assert.equal(outExcluded.missingInputs[0].metric, 'implied_volatility');

  const insufficientRegime = makeRegimeSnapshot({
    sufficientData: false,
    insufficientReason: 'Need at least 65 candles, received 24.',
    currentRegime: null,
    score: null,
    inputs: [],
  });
  const outInsufficient = evaluateGuardrailRules({
    regimeOutput: insufficientRegime,
    rules: [
      {
        id: 'r_score',
        name: 'Any Score',
        logic: 'OR',
        action: 'PAUSE',
        enabled: true,
        conditions: [{ id: 'c2', metric: 'risk_score', operator: '>=', thresholdNumber: 0 }],
      },
    ],
  });

  assert.equal(outInsufficient.available, false);
  assert.equal(outInsufficient.action, null);
  assert.equal(outInsufficient.firedRules.length, 0);
  assert.match(outInsufficient.unavailableReason ?? '', /65 candles/);
});

test('5. Input validation rejects invalid numbers, empty names, empty conditions, and bad cooldowns', () => {
  const badRule = validateGuardrailRule({
    name: ' ',
    action: 'PAUSE',
    logic: 'OR',
    enabled: true,
    conditions: [
      { id: 'c1', metric: 'risk_score', operator: '>', thresholdNumber: 150 },
    ],
  });
  assert.equal(badRule.valid, false);
  assert.ok(badRule.errors.length >= 2);

  const emptyConds = validateGuardrailRule({
    name: 'Valid Name',
    action: 'PAUSE',
    logic: 'OR',
    enabled: true,
    conditions: [],
  });
  assert.equal(emptyConds.valid, false);

  assert.equal(validateCooldownSeconds(300).valid, true);
  assert.equal(validateCooldownSeconds(-5).valid, false);
  assert.equal(validateCooldownSeconds(12.5).valid, false);
});

test('6. Alert reconciliation suppresses duplicate polls, respects cooldown, escalates, and marks older pending alerts Superseded', () => {
  const reduceRule: GuardrailRule = {
    id: 'r_reduce',
    name: 'Score > 40',
    logic: 'OR',
    action: 'REDUCE SIZE',
    enabled: true,
    conditions: [{ id: 'c1', metric: 'risk_score', operator: '>', thresholdNumber: 40 }],
  };
  const pauseRule: GuardrailRule = {
    id: 'r_pause',
    name: 'Score > 70',
    logic: 'OR',
    action: 'PAUSE',
    enabled: true,
    conditions: [{ id: 'c2', metric: 'risk_score', operator: '>', thresholdNumber: 70 }],
  };

  const t0 = 1_700_000_000_000;
  const eval1 = evaluateGuardrailRules({
    regimeOutput: makeRegimeSnapshot({ score: 55 }),
    rules: [reduceRule, pauseRule],
    evaluatedAtIso: new Date(t0).toISOString(),
  });
  const step1 = reconcileAlertFeed({
    existingAlerts: [],
    evaluation: eval1,
    cooldownSeconds: 300,
    nowMs: t0,
  });
  assert.equal(step1.alerts.length, 1);
  assert.equal(step1.createdAlert?.action, 'REDUCE SIZE');
  assert.equal(step1.createdAlert?.status, 'pending');

  // Same poll 10s later -> no duplicate alert
  const step2 = reconcileAlertFeed({
    existingAlerts: step1.alerts,
    evaluation: eval1,
    cooldownSeconds: 300,
    nowMs: t0 + 10_000,
  });
  assert.equal(step2.alerts.length, 1);
  assert.equal(step2.createdAlert, null);

  // User dismisses alert 1, then same rule fires inside cooldown -> suppressed
  const dismissedAlerts = step2.alerts.map((a) => ({
    ...a,
    status: 'dismissed' as const,
    decision: 'dismissed' as const,
  }));
  const step3Cooldown = reconcileAlertFeed({
    existingAlerts: dismissedAlerts,
    evaluation: eval1,
    cooldownSeconds: 300,
    nowMs: t0 + 60_000,
  });
  assert.equal(step3Cooldown.createdAlert, null);

  // Now score jumps to 80 so action escalates to PAUSE with a new rule firing -> raises new alert and supersedes pending
  const evalPause = evaluateGuardrailRules({
    regimeOutput: makeRegimeSnapshot({ score: 80 }),
    rules: [reduceRule, pauseRule],
    evaluatedAtIso: new Date(t0 + 70_000).toISOString(),
  });
  const step4Escalate = reconcileAlertFeed({
    existingAlerts: step1.alerts, // still pending
    evaluation: evalPause,
    cooldownSeconds: 300,
    nowMs: t0 + 70_000,
  });
  assert.equal(step4Escalate.alerts.length, 2);
  assert.equal(step4Escalate.createdAlert?.action, 'PAUSE');
  assert.equal(step4Escalate.supersededCount, 1);
  assert.equal(step4Escalate.alerts[1].status, 'superseded');

  // Market calms down to CONTINUE -> pending PAUSE alert is marked Superseded
  const evalCalm = evaluateGuardrailRules({
    regimeOutput: makeRegimeSnapshot({ score: 25 }),
    rules: [reduceRule, pauseRule],
    evaluatedAtIso: new Date(t0 + 120_000).toISOString(),
  });
  const step5Calm = reconcileAlertFeed({
    existingAlerts: step4Escalate.alerts,
    evaluation: evalCalm,
    cooldownSeconds: 300,
    nowMs: t0 + 120_000,
  });
  assert.equal(step5Calm.createdAlert, null);
  assert.equal(step5Calm.alerts[0].status, 'superseded');
});
