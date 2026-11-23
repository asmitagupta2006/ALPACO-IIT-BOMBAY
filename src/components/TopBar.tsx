import type { User } from 'firebase/auth';
import { Activity, AlertTriangle, LogIn, LogOut, Menu, RefreshCw, UserCheck, WifiOff, X } from 'lucide-react';
import type { DeltaWsConnectionState, HealthStatusResponse } from '../contracts/delta';
import { formatTimestamp } from '../utils/format';
import type { NavSectionId } from './sentinel/OverviewDashboard';

interface TopBarProps {
  health: HealthStatusResponse | null;
  wsStateOverride: DeltaWsConnectionState | null;
  isCheckingHealth: boolean;
  onRefreshHealth: () => void;
  activeSection: NavSectionId;
  onNavigate: (section: NavSectionId) => void;
  mobileSidebarOpen: boolean;
  onToggleMobileSidebar: () => void;
  user?: User | null;
  authLoading?: boolean;
  onSignIn?: () => void;
  onSignOut?: () => void;
}

const TOP_QUICK_LINKS: readonly { id: NavSectionId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'monitor', label: 'Live Monitor' },
  { id: 'guardrails', label: 'Guardrails' },
  { id: 'training', label: 'ML Training' },
  { id: 'deck', label: '6-Slide Deck' },
];

export function TopBar({
  health,
  wsStateOverride,
  isCheckingHealth,
  onRefreshHealth,
  activeSection,
  onNavigate,
  mobileSidebarOpen,
  onToggleMobileSidebar,
  user = null,
  authLoading = false,
  onSignIn,
  onSignOut,
}: TopBarProps) {
  const wsState = wsStateOverride ?? health?.deltaWsState ?? 'disconnected';
  const restOk = health?.deltaRestOk ?? false;

  let statusShortLabel = 'Checking';
  let statusLabel = 'Checking API';
  let statusToneClass = 'text-slate-300 border-slate-700/80 bg-slate-900/80';
  let StatusIcon = Activity;

  if (health) {
    if (restOk && wsState === 'connected') {
      statusShortLabel = 'API OK';
      statusLabel = `API Connected${health.deltaRestLatencyMs !== null ? ` · ${health.deltaRestLatencyMs}ms` : ''}`;
      statusToneClass = 'text-emerald-400 border-emerald-500/30 bg-emerald-950/30';
      StatusIcon = Activity;
    } else if (restOk) {
      statusShortLabel = 'REST OK';
      statusLabel = `REST OK · WS ${wsState}`;
      statusToneClass = 'text-amber-400 border-amber-500/30 bg-amber-950/30';
      StatusIcon = AlertTriangle;
    } else {
      statusShortLabel = 'Offline';
      statusLabel = 'API Disconnected';
      statusToneClass = 'text-rose-400 border-rose-500/30 bg-rose-950/30';
      StatusIcon = WifiOff;
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-[#0B1120]/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1680px] items-center justify-between gap-2 sm:gap-6 px-3 sm:px-6 py-3">
        {/* Zone 1: Brand Wordmark + Mobile Sidebar Toggle */}
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <button
            type="button"
            onClick={onToggleMobileSidebar}
            aria-label={mobileSidebarOpen ? 'Close navigation sidebar' : 'Open navigation sidebar'}
            className="lg:hidden inline-flex items-center justify-center rounded-md border border-slate-800 bg-[#111A2E] p-1.5 text-slate-300 hover:text-slate-100 cursor-pointer shrink-0"
          >
            {mobileSidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
          <a
            href="#overview"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('overview');
            }}
            className="font-display text-base sm:text-lg font-semibold tracking-tight text-slate-100 whitespace-nowrap truncate"
          >
            Regime Sentinel
          </a>
        </div>

        {/* Zone 2: Clean single-line quick navigation links */}
        <nav aria-label="Primary quick links" className="hidden md:flex items-center gap-6 text-sm font-medium">
          {TOP_QUICK_LINKS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors duration-150 cursor-pointer ${
                activeSection === item.id
                  ? 'text-slate-100 border-b border-sky-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: Connection Health + Optional Google Sign-In */}
        <div className="flex items-center gap-2 shrink-0">
          {!authLoading && onSignIn && onSignOut && (
            user ? (
              <div className="flex items-center gap-1.5">
                <span
                  title={`Signed in (uid: ${user.uid})`}
                  className="hidden sm:inline-flex items-center gap-1.5 rounded-md border border-sky-500/35 bg-sky-950/25 px-2.5 py-1.5 font-mono text-[11px] text-sky-200 whitespace-nowrap"
                >
                  <UserCheck className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
                  <span>{user.displayName || `uid:${user.uid.slice(0, 6)}`}</span>
                </span>
                <button
                  type="button"
                  onClick={onSignOut}
                  aria-label="Sign out of Google"
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#111A2E] px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-slate-100 whitespace-nowrap cursor-pointer"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Sign out</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onSignIn}
                title="Optional: sign in with Google to save decisions to Firestore"
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-[#111A2E] px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-sky-500/50 hover:text-sky-200 whitespace-nowrap cursor-pointer"
              >
                <LogIn className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
                <span className="hidden sm:inline">Google Sign-In</span>
                <span className="sm:hidden">Sign in</span>
              </button>
            )
          )}

          <button
            type="button"
            onClick={onRefreshHealth}
            disabled={isCheckingHealth}
            title={
              health?.lastError
                ? `Last error: ${health.lastError}`
                : `Last checked: ${formatTimestamp(health?.checkedAt)}`
            }
            className={`inline-flex items-center gap-1.5 sm:gap-2 rounded-md border px-2.5 sm:px-3 py-1.5 font-mono text-xs font-medium tabular-nums whitespace-nowrap shrink-0 transition-colors duration-150 cursor-pointer hover:brightness-110 disabled:opacity-60 ${statusToneClass}`}
          >
            <StatusIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="sm:hidden">{statusShortLabel}</span>
            <span className="hidden sm:inline">{statusLabel}</span>
            <RefreshCw
              className={`h-3 w-3 shrink-0 opacity-75 ${isCheckingHealth ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    </header>
  );
}
