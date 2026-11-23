import type {
  AlertSeverity,
  DataSourceMode,
  MarketRegime,
  RiskAction,
} from '../../contracts/sentinel';

export function regimeBadgeClass(regime: MarketRegime): string {
  switch (regime) {
    case 'Trending':
      return 'text-sky-300 border-sky-500/35 bg-sky-950/30';
    case 'Ranging':
      return 'text-slate-200 border-slate-600/50 bg-slate-800/40';
    case 'High Volatility':
      return 'text-amber-300 border-amber-500/40 bg-amber-950/30';
    case 'Low Volatility':
      return 'text-emerald-300 border-emerald-500/35 bg-emerald-950/30';
    case 'Transition / Unstable':
      return 'text-rose-300 border-rose-500/40 bg-rose-950/30';
  }
}

export function regimeHexColor(regime: MarketRegime): string {
  switch (regime) {
    case 'Trending':
      return '#38BDF8';
    case 'Ranging':
      return '#94A3B8';
    case 'High Volatility':
      return '#F59E0B';
    case 'Low Volatility':
      return '#10B981';
    case 'Transition / Unstable':
      return '#F43F5E';
  }
}

export function actionToneClass(action: RiskAction): string {
  switch (action) {
    case 'CONTINUE':
      return 'text-emerald-300 border-emerald-500/35 bg-emerald-950/30';
    case 'MONITOR':
      return 'text-sky-300 border-sky-500/35 bg-sky-950/30';
    case 'REDUCE EXPOSURE':
      return 'text-amber-300 border-amber-500/40 bg-amber-950/30';
    case 'CONSIDER PAUSING':
      return 'text-orange-300 border-orange-500/40 bg-orange-950/30';
    case 'CRITICAL RISK WARNING':
      return 'text-rose-300 border-rose-500/45 bg-rose-950/35';
  }
}

export function severityToneClass(severity: AlertSeverity): string {
  switch (severity) {
    case 'Information':
      return 'text-sky-300 border-sky-500/35 bg-sky-950/30';
    case 'Warning':
      return 'text-amber-300 border-amber-500/40 bg-amber-950/30';
    case 'Critical':
      return 'text-rose-300 border-rose-500/45 bg-rose-950/35';
  }
}

export function formatDataModeLabel(mode: DataSourceMode): {
  label: string;
  toneClass: string;
} {
  switch (mode) {
    case 'live':
      return {
        label: 'Live Delta Exchange India',
        toneClass: 'text-emerald-300 border-emerald-500/35 bg-emerald-950/25',
      };
    case 'historical_cache':
      return {
        label: 'Historical SQLite Cache',
        toneClass: 'text-amber-300 border-amber-500/35 bg-amber-950/25',
      };
    case 'demo_fallback':
      return {
        label: 'Demo Fallback (Synthetic)',
        toneClass: 'text-rose-300 border-rose-500/35 bg-rose-950/25',
      };
  }
}

export function healthToneClass(score: number): string {
  if (score >= 75) return 'text-emerald-300';
  if (score >= 55) return 'text-sky-300';
  if (score >= 35) return 'text-amber-300';
  return 'text-rose-400';
}

export function healthBarColor(score: number): string {
  if (score >= 75) return 'bg-emerald-500';
  if (score >= 55) return 'bg-sky-500';
  if (score >= 35) return 'bg-amber-500';
  return 'bg-rose-500';
}

export function formatTimeShortUtc(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(11, 16) + ' UTC';
}
