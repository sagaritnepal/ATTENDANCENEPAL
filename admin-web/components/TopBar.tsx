'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function TopBar({ title, onOpenMenu }: { title: string; onOpenMenu: () => void }) {
  const [deviceCounts, setDeviceCounts] = useState<{ online: number; total: number }>({ online: 0, total: 0 });

  useEffect(() => {
    supabase
      .from('devices')
      .select('status')
      .then(({ data }) => {
        if (!data) return;
        setDeviceCounts({ online: data.filter(d => d.status === 'online').length, total: data.length });
      });
  }, []);

  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-4 sm:px-6 lg:px-8 lg:py-5">
      <div className="flex items-center gap-3">
        <button
          aria-label="Open menu"
          onClick={onOpenMenu}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
        >
          <MenuIcon className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold text-ink sm:text-2xl">{title}</h1>
      </div>

      <div className="flex items-center gap-3 sm:gap-5">
        <div className="relative hidden md:block">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search anything..."
            className="w-64 rounded-full border border-slate-200 bg-slate-50 py-2 pl-9 pr-4 text-sm text-ink placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>

        <span className="hidden items-center gap-1.5 rounded-full bg-good-bg px-3 py-1.5 text-xs font-medium text-good-text lg:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-good" />
          BioSync Active
        </span>

        <button aria-label="Notifications" className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
          <BellIcon className="h-5 w-5" />
        </button>

        <div className="hidden text-right text-xs leading-tight text-slate-500 sm:block">
          Connected Devices
          <div className="text-sm font-semibold text-ink">
            {deviceCounts.online}/{deviceCounts.total} Online
          </div>
        </div>
      </div>
    </header>
  );
}
function MenuIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path strokeLinecap="round" d="m21 21-4.3-4.3" />
    </svg>
  );
}
function BellIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path strokeLinecap="round" d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}
