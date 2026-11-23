import type {
  AlpacaAssetClass,
  AlpacaFeedInfo,
  AlpacaRawBar,
  AlpacaStockFeed,
} from '../contracts/alpaca';
import type { CandleResolution, DeltaCandle } from '../contracts/delta';

const RESOLUTION_TO_ALPACA: Record<CandleResolution, string> = {
  '1m': '1Min',
  '3m': '3Min',
  '5m': '5Min',
  '15m': '15Min',
  '30m': '30Min',
  '1h': '1Hour',
  '2h': '2Hour',
  '4h': '4Hour',
  '6h': '6Hour',
  '1d': '1Day',
};

export function mapResolutionToAlpacaTimeframe(resolution: CandleResolution): string {
  return RESOLUTION_TO_ALPACA[resolution];
}

export function detectAlpacaAssetClass(symbol: string): AlpacaAssetClass {
  return symbol.includes('/') ? 'crypto' : 'us_equity';
}

export function describeAlpacaFeed(
  assetClass: AlpacaAssetClass,
  stockFeed: AlpacaStockFeed,
): AlpacaFeedInfo {
  if (assetClass === 'crypto') {
    return {
      feed: 'us',
      label: 'Alpaca US Crypto Feed',
      isDelayed: false,
      delayMinutes: 0,
      note: 'Real-time Alpaca US crypto market data feed (/v1beta3/crypto/us).',
    };
  }

  switch (stockFeed) {
    case 'iex':
      return {
        feed: 'iex',
        label: 'IEX Real-Time (~2.5% US Vol)',
        isDelayed: false,
        delayMinutes: 0,
        note: 'Free-plan compatible real-time feed from Investors Exchange (IEX). Lower volume than consolidated SIP.',
      };
    case 'delayed_sip':
      return {
        feed: 'delayed_sip',
        label: 'Delayed SIP (15-min Delay)',
        isDelayed: true,
        delayMinutes: 15,
        note: 'Consolidated US equities SIP tape delayed by 15 minutes per exchange/free-tier rules.',
      };
    case 'sip':
      return {
        feed: 'sip',
        label: 'SIP Consolidated (Real-Time)',
        isDelayed: false,
        delayMinutes: 0,
        note: 'Full US consolidated SIP tape (requires paid Alpaca Market Data subscription for <15m live bars).',
      };
  }
}

/**
 * Normalizes Alpaca Market Data bars (`t`, `o`, `h`, `l`, `c`, `v`)
 * into the shared internal candle structure:
 * - timestamps in Unix seconds (integer)
 * - all OHLCV prices/volumes as finite numbers
 * - sorted ascending by timestamp
 * - deduplicated by timestamp (last bar wins if duplicate timestamp appears)
 */
export function normalizeAlpacaBars(rawBars: readonly AlpacaRawBar[]): DeltaCandle[] {
  if (!Array.isArray(rawBars) || rawBars.length === 0) {
    return [];
  }

  const byTime = new Map<number, DeltaCandle>();

  for (const bar of rawBars) {
    if (!bar || typeof bar.t !== 'string') continue;

    const ms = Date.parse(bar.t);
    if (!Number.isFinite(ms)) continue;
    const time = Math.floor(ms / 1000);

    const open = typeof bar.o === 'number' ? bar.o : Number(bar.o);
    const high = typeof bar.h === 'number' ? bar.h : Number(bar.h);
    const low = typeof bar.l === 'number' ? bar.l : Number(bar.l);
    const close = typeof bar.c === 'number' ? bar.c : Number(bar.c);
    const volume = typeof bar.v === 'number' ? bar.v : Number(bar.v);

    if (
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      !Number.isFinite(volume)
    ) {
      continue;
    }

    byTime.set(time, {
      time,
      open,
      high,
      low,
      close,
      volume,
    });
  }

  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}
