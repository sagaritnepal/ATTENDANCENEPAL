'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildMonth, formatAdDate, stepAnchor, todayAnchor } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const POPOVER_WIDTH = 288; // matches w-72

function parseAdKey(value: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(value);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) - 1 };
}

/**
 * Click-to-pick calendar with an AD/BS switch — the same date-grid model
 * (lib/calendar.ts) the Attendance calendar already uses, reused here so
 * every date field in the app can toggle to the Nepali (Bikram Sambat)
 * calendar instead of just the Gregorian one.
 *
 * The AD/BS system itself isn't chosen here — it comes from the one global
 * switch in the page header (CalendarSystemSwitch), so every date picker
 * and every displayed date on the page changes together.
 *
 * The popover renders through a portal into document.body, positioned by
 * the trigger's viewport coordinates — a plain absolutely-positioned child
 * would get clipped by any ancestor with overflow-y-auto (every modal on
 * desktop uses that for its scrollable body), which is how a native
 * <input type="date"> never behaved since its picker is a browser-level
 * overlay, not a DOM node inside the page.
 */
export default function DatePicker({
  value,
  onChange,
  placeholder = 'Select date',
  className,
}: {
  /** AD date as YYYY-MM-DD (what's actually stored/sent), or '' for unset. */
  value: string;
  onChange: (adKey: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const { system } = useCalendarSystem();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(todayAnchor);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  function openPicker() {
    setAnchor(parseAdKey(value) ?? todayAnchor());
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const left = Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8);
      setCoords({ top: rect.bottom + 4, left: Math.max(8, left) });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleScrollOrResize() {
      setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [open]);

  const month = useMemo(() => buildMonth(system, anchor.year, anchor.month), [system, anchor]);

  function go(direction: 1 | -1) {
    setAnchor(stepAnchor(system, anchor.year, anchor.month, direction));
  }

  function selectCell(adKey: string) {
    onChange(adKey);
    setOpen(false);
  }

  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const displayValue = value ? formatAdDate(value, system) : '';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPicker())}
        className={`flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:border-accent/40 ${className ?? ''}`}
      >
        <span className={displayValue ? 'text-ink' : 'text-slate-400'}>{displayValue || placeholder}</span>
        <CalendarGlyph className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open &&
        coords &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ position: 'fixed', top: coords.top, left: coords.left, width: POPOVER_WIDTH }}
            className="z-[1000] rounded-xl border border-slate-200 bg-white p-3 shadow-lg"
          >
            <div className="mb-2 flex items-center justify-between">
              <button type="button" onClick={() => go(-1)} className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50">
                ‹
              </button>
              <span className="text-sm font-semibold text-ink">{month.label}</span>
              <button type="button" onClick={() => go(1)} className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50">
                ›
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-slate-400">
              {WEEKDAY_LABELS.map(w => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {month.weeks.flat().map((cell, i) => {
                const isSelected = cell.adKey === value;
                return (
                  <button
                    key={`${cell.adKey}-${i}`}
                    type="button"
                    onClick={() => selectCell(cell.adKey)}
                    className={`h-7 w-7 rounded-full text-xs ${
                      !cell.inMonth
                        ? 'text-slate-300'
                        : isSelected
                          ? 'bg-accent font-semibold text-white'
                          : cell.isToday
                            ? 'bg-accent/10 font-semibold text-accent'
                            : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {cell.displayDay}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
              <span className="text-[11px] text-slate-400">Today: {formatAdDate(todayIso, system)}</span>
              <button type="button" onClick={() => selectCell(todayIso)} className="text-[11px] font-medium text-accent hover:underline">
                Select today
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function CalendarGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
