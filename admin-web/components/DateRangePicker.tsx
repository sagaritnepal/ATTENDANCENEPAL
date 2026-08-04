'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildMonth, formatAdDate, stepAnchor, todayAnchor, type CalendarAnchor } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const POPOVER_WIDTH = 288; // matches w-72

function parseAdKey(value: string): CalendarAnchor | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]) };
}

/**
 * One calendar for picking a From/To range, instead of two separate
 * DatePicker fields side by side — click a start day, then an end day (or
 * the same day twice for a 1-day range); picking a new start after a range
 * is already set begins a fresh range instead of adjusting one end. Mirrors
 * DatePicker's portal-positioned popover so it isn't clipped by a modal's
 * overflow-y-auto body.
 */
export default function DateRangePicker({
  from,
  to,
  onChange,
}: {
  /** AD dates as YYYY-MM-DD (what's actually stored/sent). */
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const { system } = useCalendarSystem();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState(todayAnchor);
  const [pickingStart, setPickingStart] = useState<string | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  function openPicker() {
    setAnchor(parseAdKey(from) ?? todayAnchor());
    setPickingStart(null);
    setHoverDate(null);
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

  const month = useMemo(() => buildMonth(system, anchor), [system, anchor]);

  function go(direction: 1 | -1) {
    setAnchor(stepAnchor(system, anchor, direction));
  }

  function selectCell(adKey: string) {
    if (!pickingStart) {
      // First click of a fresh range — hold it and wait for the end date,
      // previewing the span live as the pointer moves (see hoverDate below).
      setPickingStart(adKey);
      onChange(adKey, adKey);
      return;
    }
    const start = pickingStart < adKey ? pickingStart : adKey;
    const end = pickingStart < adKey ? adKey : pickingStart;
    onChange(start, end);
    setPickingStart(null);
    setHoverDate(null);
    setOpen(false);
  }

  // While the end date is being picked, preview the full span between the
  // clicked start and wherever the pointer currently is — otherwise the
  // calendar only ever shows two disconnected dots and never looks like a
  // "select a range" control until after the second click.
  const previewAnchor = pickingStart ? (hoverDate ?? pickingStart) : null;
  const liveStart = pickingStart ? (pickingStart < previewAnchor! ? pickingStart : previewAnchor!) : from;
  const liveEnd = pickingStart ? (pickingStart < previewAnchor! ? previewAnchor! : pickingStart) : to;

  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPicker())}
        className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm shadow-sm hover:border-accent/40"
      >
        <CalendarGlyph className="h-4 w-4 shrink-0 text-accent" />
        <span className="truncate whitespace-nowrap text-ink">
          {formatAdDate(from, system)} – {formatAdDate(to, system)}
        </span>
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

            <p className="mb-1.5 text-center text-[11px] text-slate-400">
              {pickingStart ? 'Pick the end date' : 'Pick the start date'}
            </p>

            <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-slate-400">
              {WEEKDAY_LABELS.map(w => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1" onMouseLeave={() => setHoverDate(null)}>
              {month.weeks.flat().map((cell, i) => {
                const isStart = cell.adKey === liveStart;
                const isEnd = cell.adKey === liveEnd;
                const inRange = cell.adKey > liveStart && cell.adKey < liveEnd;
                return (
                  <button
                    key={`${cell.adKey}-${i}`}
                    type="button"
                    onClick={() => selectCell(cell.adKey)}
                    onMouseEnter={() => pickingStart && setHoverDate(cell.adKey)}
                    className={`h-7 w-7 rounded-full text-xs ${
                      !cell.inMonth
                        ? 'text-slate-300'
                        : isStart || isEnd
                          ? 'bg-accent font-semibold text-white'
                          : inRange
                            ? 'bg-accent/15 text-ink'
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
              <button
                type="button"
                onClick={() => {
                  onChange(todayIso, todayIso);
                  setPickingStart(null);
                  setHoverDate(null);
                  setOpen(false);
                }}
                className="text-[11px] font-medium text-accent hover:underline"
              >
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
