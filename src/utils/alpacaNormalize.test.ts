import test from 'node:test';
import assert from 'node:assert/strict';
import type { AlpacaRawBar } from '../contracts/alpaca';
import {
  describeAlpacaFeed,
  detectAlpacaAssetClass,
  mapResolutionToAlpacaTimeframe,
  normalizeAlpacaBars,
} from './alpacaNormalize';

test('normalizeAlpacaBars converts RFC-3339 timestamps to seconds, casts numbers, sorts ascending, and deduplicates', () => {
  const handWrittenBars: AlpacaRawBar[] = [
    {
      t: '2026-11-23T14:35:00Z',
      o: 185.4,
      h: 186.1,
      l: 185.1,
      c: 185.95,
      v: 42100,
    },
    {
      t: '2026-11-23T14:30:00Z',
      o: '184.50',
      h: '185.20',
      l: '184.25',
      c: '185.00',
      v: '31000',
    },
    // Duplicate timestamp for 14:30:00Z (with offset +00:00) — later entry replaces earlier
    {
      t: '2026-11-23T14:30:00+00:00',
      o: 184.5,
      h: 185.25,
      l: 184.25,
      c: 185.1,
      v: 31500,
    },
    // Offset timezone (-05:00 -> 14:25:00Z)
    {
      t: '2026-11-23T09:25:00-05:00',
      o: 184.0,
      h: 184.6,
      l: 183.9,
      c: 184.5,
      v: 19800,
    },
  ];

  const normalized = normalizeAlpacaBars(handWrittenBars);

  assert.equal(normalized.length, 3);
  assert.deepEqual(normalized, [
    {
      time: 1795443900, // 2026-11-23T14:25:00Z
      open: 184.0,
      high: 184.6,
      low: 183.9,
      close: 184.5,
      volume: 19800,
    },
    {
      time: 1795444200, // 2026-11-23T14:30:00Z (deduped)
      open: 184.5,
      high: 185.25,
      low: 184.25,
      close: 185.1,
      volume: 31500,
    },
    {
      time: 1795444500, // 2026-11-23T14:35:00Z
      open: 185.4,
      high: 186.1,
      low: 185.1,
      close: 185.95,
      volume: 42100,
    },
  ]);

  // Verify strict ascending order and finite numbers
  for (let i = 1; i < normalized.length; i++) {
    assert.ok(normalized[i].time > normalized[i - 1].time);
  }
});

test('normalizeAlpacaBars drops bars with invalid timestamps or non-finite numbers', () => {
  const malformedBars = [
    { t: 'not-a-timestamp', o: 100, h: 101, l: 99, c: 100, v: 500 },
    { t: '2026-11-23T15:00:00Z', o: Number.NaN, h: 101, l: 99, c: 100, v: 500 },
    { t: '2026-11-23T15:05:00Z', o: 100, h: 102, l: 99.5, c: 101.25, v: 1200 },
  ] as unknown as AlpacaRawBar[];

  const normalized = normalizeAlpacaBars(malformedBars);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].time, Math.floor(Date.parse('2026-11-23T15:05:00Z') / 1000));
  assert.equal(normalized[0].close, 101.25);
});

test('mapResolutionToAlpacaTimeframe and feed/asset-class helpers return expected docs values', () => {
  assert.equal(mapResolutionToAlpacaTimeframe('1m'), '1Min');
  assert.equal(mapResolutionToAlpacaTimeframe('15m'), '15Min');
  assert.equal(mapResolutionToAlpacaTimeframe('1h'), '1Hour');
  assert.equal(mapResolutionToAlpacaTimeframe('1d'), '1Day');

  assert.equal(detectAlpacaAssetClass('AAPL'), 'us_equity');
  assert.equal(detectAlpacaAssetClass('BTC/USD'), 'crypto');

  const delayedInfo = describeAlpacaFeed('us_equity', 'delayed_sip');
  assert.equal(delayedInfo.isDelayed, true);
  assert.equal(delayedInfo.delayMinutes, 15);

  const iexInfo = describeAlpacaFeed('us_equity', 'iex');
  assert.equal(iexInfo.isDelayed, false);
  assert.equal(iexInfo.delayMinutes, 0);
});
