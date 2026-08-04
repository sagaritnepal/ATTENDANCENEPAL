'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import CalendarSystemSwitch from './CalendarSystemSwitch';
import AccountMenu from './AccountMenu';

type SearchProps = { value: string; onChange: (value: string) => void; placeholder?: string; suggestions?: string[] };

export default function TopBar({
  title,
  onOpenMenu,
  search,
  adminName,
  role,
}: {
  title: string;
  onOpenMenu: () => void;
  search?: SearchProps;
  adminName: string;
  role: 'admin' | 'hr';
}) {
  const [deviceCounts, setDeviceCounts] = useState<{ online: number; total: number }>({ online: 0, total: 0 });
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);

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
    <header className="border-b border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-2 px-4 py-4 sm:px-6 lg:px-8 lg:py-5">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <button
            aria-label="Open menu"
            onClick={onOpenMenu}
            className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
          <h1 className="truncate text-lg font-bold text-ink sm:text-2xl">{title}</h1>
          <CalendarSystemSwitch />
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-5">
          <div
            ref={searchBoxRef}
            tabIndex={-1}
            onBlur={e => {
              if (!searchBoxRef.current?.contains(e.relatedTarget as Node)) setSuggestionsOpen(false);
            }}
            className="relative hidden md:block"
          >
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={search?.placeholder ?? 'Search anything...'}
              value={search?.value ?? ''}
              onChange={e => {
                search?.onChange(e.target.value);
                setSuggestionsOpen(true);
              }}
              onFocus={() => setSuggestionsOpen(true)}
              disabled={!search}
              className="w-64 rounded-full border border-slate-200 bg-slate-50 py-2 pl-9 pr-4 text-sm text-ink placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
            />
            {suggestionsOpen && search && search.suggestions && search.suggestions.length > 0 && (
              <div className="absolute left-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                {search.suggestions.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      search.onChange(s);
                      setSuggestionsOpen(false);
                    }}
                    className="block w-full truncate px-3 py-2 text-left text-sm text-ink hover:bg-slate-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* The desktop search box above is hidden below md — this is the
              only way to search on a phone, so it can't just be omitted. */}
          {search && (
            <button
              aria-label="Search"
              onClick={() => setMobileSearchOpen(v => !v)}
              className={`rounded-full p-2 hover:bg-slate-100 md:hidden ${mobileSearchOpen ? 'bg-slate-100 text-accent' : 'text-slate-500'}`}
            >
              <SearchIcon className="h-5 w-5" />
            </button>
          )}

          <span className="hidden items-center gap-1.5 rounded-full bg-good-bg px-3 py-1.5 text-xs font-medium text-good-text lg:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-good" />
            BioSync Active
          </span>

          <button aria-label="Notifications" className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
            <BellIcon className="h-5 w-5" />
          </button>

          <div className="hidden text-right text-xs leading-tight text-slate-500 lg:block">
            Connected Devices
            <div className="text-sm font-semibold text-ink">
              {deviceCounts.online}/{deviceCounts.total} Online
            </div>
          </div>

          <div className="hidden h-8 w-px bg-slate-200 sm:block" />

          <AccountMenu adminName={adminName} role={role} />
        </div>
      </div>

      {search && mobileSearchOpen && (
        <div className="border-t border-slate-100 px-4 py-3 md:hidden">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              type="text"
              placeholder={search.placeholder ?? 'Search anything...'}
              value={search.value}
              onChange={e => search.onChange(e.target.value)}
              className="w-full rounded-full border border-slate-200 bg-slate-50 py-2 pl-9 pr-9 text-sm text-ink placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
            <button
              aria-label="Close search"
              onClick={() => setMobileSearchOpen(false)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 hover:bg-slate-100"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
          {search.suggestions && search.suggestions.length > 0 && (
            <div className="mt-1.5 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              {search.suggestions.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    search.onChange(s);
                    setMobileSearchOpen(false);
                  }}
                  className="block w-full truncate px-3 py-2 text-left text-sm text-ink hover:bg-slate-50"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
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

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 6 6 18M6 6l12 12" />
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
