import type { Phase2RegimeLabel } from '../../contracts/regime';
import type { DataSourceMode } from '../../contracts/sentinel';

export function regimeBadgeClass(regime: Phase2RegimeLabel | null): string {
  switch (regime) {
    case 'Trending':
      return 'text-sky-300 border-sky-500/35 bg-sky-950/30';
    case 'Calm/Range':
      return 'text-emerald-300 border-emerald-500/35 bg-emerald-950/30';
    case 'High-Volatility/Shock':
      return 'text-rose-300 border-rose-500/40 bg-rose-950/30';
    default:
      return 'text-amber-300 border-amber-500/35 bg-amber-950/25';
  }
}

export function regimeHexColor(regime: Phase2RegimeLabel | null): string {
  switch (regime) {
    case 'Trending':
      return '#38BDF8';
    case 'Calm/Range':
      return '#10B981';
    case 'High-Volatility/Shock':
      return '#F43F5E';
    default:
      return '#475569';
  }
}

export function formatDataModeLabel(_mode: DataSourceMode): {
  label: string;
  toneClass: string;
} {
  return {
    label: 'Live Delta Exchange India',
    toneClass: 'text-emerald-300 border-emerald-500/35 bg-emerald-950/25',
  };
}

export function formatTimeShortUtc(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(11, 16) + ' UTC';
}
