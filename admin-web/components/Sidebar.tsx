'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type NavChild = { href: string; label: string; icon: (props: IconProps) => JSX.Element; adminOnly: boolean };
type NavItem = { href: string; label: string; icon: (props: IconProps) => JSX.Element; adminOnly: boolean; children?: NavChild[] };

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: HomeIcon, adminOnly: false },
  {
    href: '/employees',
    label: 'Employees',
    icon: UsersIcon,
    adminOnly: false,
    children: [
      { href: '/attendance', label: 'Attendance', icon: ClockIcon, adminOnly: false },
      { href: '/leave', label: 'Leave', icon: LeaveIcon, adminOnly: false },
      { href: '/corrections', label: 'Corrections', icon: CorrectionIcon, adminOnly: false },
      { href: '/calendar', label: 'Calendar', icon: CalendarViewIcon, adminOnly: false },
      { href: '/shifts', label: 'Shifts', icon: CalendarIcon, adminOnly: true },
      { href: '/branches', label: 'Branch/Depart', icon: BranchIcon, adminOnly: true },
    ],
  },
  { href: '/payroll', label: 'Payroll', icon: CardIcon, adminOnly: false },
  { href: '/tasks', label: 'Tasks', icon: TaskIcon, adminOnly: false },
  { href: '/devices', label: 'Devices', icon: DeviceIcon, adminOnly: true },
];

type Props = {
  role: 'admin' | 'hr';
  drawerOpen: boolean;
  onCloseDrawer: () => void;
};

export default function Sidebar({ role, drawerOpen, onCloseDrawer }: Props) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter(item => !item.adminOnly || role === 'admin');

  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  // Auto-expand whichever group contains the page currently being viewed —
  // including the group's own link, since every page wraps its own
  // AppShell/Sidebar (no shared persistent layout), so navigating to it
  // remounts this component and would otherwise lose the toggle from the
  // click that navigated here.
  useEffect(() => {
    const group = NAV_ITEMS.find(i => i.href === pathname || i.children?.some(c => c.href === pathname));
    if (group) setOpenGroups(prev => (prev.has(group.href) ? prev : new Set(prev).add(group.href)));
  }, [pathname]);

  function toggleGroup(href: string) {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return next;
    });
  }

  return (
    <>
      {drawerOpen && (
        <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={onCloseDrawer} aria-hidden="true" />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex h-screen w-60 shrink-0 -translate-x-full flex-col bg-sidebar text-slate-300 transition-transform duration-200 lg:static lg:translate-x-0 ${
          drawerOpen ? 'translate-x-0' : ''
        }`}
      >
        <div className="flex flex-col items-center gap-1 px-5 pb-3 pt-4 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="Attendance Nepal" className="h-24 w-24 shrink-0" />
          <span className="text-lg font-semibold text-white">Attendance Nepal</span>
        </div>

        {role === 'hr' && (
          <div className="px-3 pb-3">
            <Link
              href="/checkin"
              onClick={onCloseDrawer}
              className="flex items-center justify-center gap-2 rounded-lg bg-accent/20 px-3 py-2 text-sm font-medium text-accent hover:bg-accent/30"
            >
              My Check-In / Out
            </Link>
          </div>
        )}

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3">
          {items.map(item => {
            const childItems = (item.children ?? []).filter(c => !c.adminOnly || role === 'admin');
            const hasChildren = childItems.length > 0;
            const isOpen = openGroups.has(item.href);
            const active = pathname === item.href;
            const childActive = childItems.some(c => c.href === pathname);
            const Icon = item.icon;
            return (
              <div key={item.href}>
                <div className="flex items-center gap-1">
                  <Link
                    href={item.href}
                    onClick={() => {
                      onCloseDrawer();
                      if (hasChildren) toggleGroup(item.href);
                    }}
                    className={`flex flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      active || childActive ? 'bg-sidebar-active font-medium text-accent' : 'hover:bg-sidebar-active/60 hover:text-white'
                    }`}
                  >
                    <Icon className="h-5 w-5" active={active || childActive} />
                    {item.label}
                  </Link>
                  {hasChildren && (
                    <button
                      type="button"
                      onClick={() => toggleGroup(item.href)}
                      aria-label={isOpen ? `Collapse ${item.label}` : `Expand ${item.label}`}
                      className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-sidebar-active/60 hover:text-white"
                    >
                      <ChevronIcon className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                  )}
                </div>
                {hasChildren && isOpen && (
                  <div className="ml-4 mt-1 flex flex-col gap-1 border-l border-white/10 pl-3">
                    {childItems.map(c => {
                      const cActive = pathname === c.href;
                      const CIcon = c.icon;
                      return (
                        <Link
                          key={c.href}
                          href={c.href}
                          onClick={onCloseDrawer}
                          className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                            cActive ? 'bg-sidebar-active font-medium text-accent' : 'text-slate-300 hover:bg-sidebar-active/60 hover:text-white'
                          }`}
                        >
                          <CIcon className="h-4 w-4" active={cActive} />
                          {c.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

type IconProps = { className?: string; active?: boolean };

function HomeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 11.5 12 4l9 7.5M5 10v10h14V10" />
    </svg>
  );
}
function UsersIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 11a4 4 0 1 0-4-4M2 21v-1a6 6 0 0 1 6-6h1a6 6 0 0 1 6 6v1M17 14a6 6 0 0 1 5 6v1" />
    </svg>
  );
}
function ClockIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
    </svg>
  );
}
function LeaveIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h5l2-3h4l2 3h5M4 12l1.5 7h13L20 12" />
    </svg>
  );
}
function CorrectionIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 20a8 8 0 1 0-6.93-4M4 15v5h5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l2.5 2.5" />
    </svg>
  );
}
function TaskIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m8 12 2.5 2.5L16 9" />
    </svg>
  );
}
function BranchIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21s-7-6.1-7-11a7 7 0 1 1 14 0c0 4.9-7 11-7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
function CalendarViewIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
      <circle cx="8.5" cy="15" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
function CalendarIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
function DeviceIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path strokeLinecap="round" d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </svg>
  );
}
function CardIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path strokeLinecap="round" d="M2 10h20" />
    </svg>
  );
}
function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  );
}
