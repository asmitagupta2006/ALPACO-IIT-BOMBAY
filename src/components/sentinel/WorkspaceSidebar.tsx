import {
  Activity,
  CandlestickChart,
  FileSpreadsheet,
  History,
  LayoutDashboard,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import type { NavSectionId } from './OverviewDashboard';

interface NavGroup {
  groupLabel: string;
  items: {
    id: NavSectionId;
    label: string;
    icon: typeof LayoutDashboard;
    badge?: string;
  }[];
}

interface WorkspaceSidebarProps {
  activeSection: NavSectionId;
  onSelectSection: (section: NavSectionId) => void;
  pendingAlertCount: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function WorkspaceSidebar({
  activeSection,
  onSelectSection,
  pendingAlertCount,
  mobileOpen,
  onCloseMobile,
}: WorkspaceSidebarProps) {
  const groups: NavGroup[] = [
    {
      groupLabel: 'Markets & Overview',
      items: [
        { id: 'overview', label: 'Overview Dashboard', icon: LayoutDashboard },
        { id: 'monitor', label: 'Live Market Monitor', icon: CandlestickChart },
      ],
    },
    {
      groupLabel: 'Detection & Guardrails',
      items: [
        { id: 'regime', label: 'Regime Detection Engine', icon: TrendingUp },
        {
          id: 'guardrails',
          label: 'Guardrails & Decision Log',
          icon: ShieldAlert,
          badge: pendingAlertCount > 0 ? String(pendingAlertCount) : undefined,
        },
      ],
    },
    {
      groupLabel: 'Governance & Specs',
      items: [
        { id: 'audit', label: 'Audit & Data History', icon: History },
        { id: 'specs', label: 'Contract Specifications', icon: FileSpreadsheet },
        { id: 'system', label: 'System & API Health', icon: Activity },
      ],
    },
  ];

  const handleSelect = (id: NavSectionId) => {
    onSelectSection(id);
    onCloseMobile();
  };

  const navContent = (
    <div className="flex h-full flex-col justify-between p-3 space-y-5">
      <nav aria-label="Workspace sections" className="space-y-5">
        {groups.map((group) => (
          <div key={group.groupLabel} className="space-y-1">
            <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {group.groupLabel}
            </div>
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelect(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`w-full flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-sky-500/15 text-sky-200 border border-sky-500/35'
                      : 'text-slate-300 border border-transparent hover:bg-slate-800/60 hover:text-slate-100'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      className={`h-3.5 w-3.5 shrink-0 ${
                        isActive ? 'text-sky-400' : 'text-slate-400'
                      }`}
                      aria-hidden="true"
                    />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.badge && (
                    <span className="rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums shrink-0 bg-amber-950/50 text-amber-300 border border-amber-500/35">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="rounded-md border border-slate-800/90 bg-[#0B1120] p-3 text-[11px] text-slate-400 space-y-1">
        <div className="font-semibold text-slate-200">Read-Only Public Proxy</div>
        <p className="leading-relaxed">
          Streams live public Delta Exchange India market data with deterministic regime calculation. No order execution APIs exist; guardrail alerts record human decisions only.
        </p>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-[248px] shrink-0 rounded-lg border border-slate-800/90 bg-[#111A2E] sticky top-[69px] max-h-[calc(100vh-88px)] overflow-y-auto">
        {navContent}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-50 w-[264px] max-w-[85vw] bg-[#111A2E] border-r border-slate-800 overflow-y-auto">
            {navContent}
          </aside>
        </div>
      )}
    </>
  );
}
