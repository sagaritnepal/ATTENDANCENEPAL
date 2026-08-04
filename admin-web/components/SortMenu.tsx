'use client';

import { useEffect, useRef, useState } from 'react';

export type SortKey = 'enrollId' | 'name' | 'date' | 'modified';

const SORT_LABELS: Record<SortKey, string> = {
  enrollId: 'Enroll ID',
  name: 'A to Z',
  date: 'Date',
  modified: 'Modified',
};

/**
 * A "Sort by" icon + dropdown reused across every employee-record table
 * (Employees Directory, Attendance Report, Payroll) — each page owns its
 * own comparator per key (the row shape differs per table) and just passes
 * back the chosen key. Defaults to ascending Enroll ID everywhere; other
 * keys sort ascending too (oldest date first, oldest-created first) for one
 * predictable direction instead of a per-key default that flips around.
 */
export default function SortMenu({
  value,
  onChange,
  options = ['enrollId', 'name', 'date', 'modified'],
}: {
  value: SortKey;
  onChange: (key: SortKey) => void;
  options?: SortKey[];
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm hover:border-accent/40"
      >
        <SortIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="text-slate-400">Sort:</span> {SORT_LABELS[value]}
        <ChevronIcon className={`h-3 w-3 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {options.map(key => (
            <button
              key={key}
              type="button"
              onClick={() => {
                onChange(key);
                setOpen(false);
              }}
              className={`block w-full px-3 py-2 text-left text-sm ${
                value === key ? 'bg-accent/10 font-semibold text-accent' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {SORT_LABELS[key]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SortIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h10M7 12h6M7 17h3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6m0 0 2.5-2.5M18 19l-2.5-2.5" />
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
