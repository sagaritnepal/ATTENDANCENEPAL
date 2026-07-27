'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: HomeIcon },
  { href: '/employees', label: 'Employees', icon: UsersIcon },
  { href: '/attendance', label: 'Attendance', icon: ClockIcon },
  { href: '/shifts', label: 'Shifts', icon: CalendarIcon },
  { href: '/devices', label: 'Devices', icon: DeviceIcon },
  { href: '/payroll', label: 'Payroll', icon: CardIcon },
];

export default function Sidebar({ adminName }: { adminName: string }) {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col bg-sidebar text-slate-300">
      <div className="flex items-center gap-2 px-5 py-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent font-bold text-white">
          X
        </div>
        <span className="text-lg font-semibold text-white">
          Attend<span className="text-accent">X</span>
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        {NAV_ITEMS.map(item => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                active ? 'bg-sidebar-active font-medium text-accent' : 'hover:bg-sidebar-active/60 hover:text-white'
              }`}
            >
              <Icon className="h-5 w-5" active={active} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-3 border-t border-white/10 px-4 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-700 text-sm font-semibold text-white">
          {adminName.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <div className="text-sm font-medium text-white">{adminName}</div>
          <div className="text-xs text-slate-400">System Administrator</div>
        </div>
      </div>
    </aside>
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
