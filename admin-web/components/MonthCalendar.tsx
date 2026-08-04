'use client';

import { useEffect, useMemo, useState } from 'react';
import { buildMonth, stepAnchor, todayAnchor } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import type { DayStatus } from '@/lib/shift';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Props = {
  /** AD date (YYYY-MM-DD) -> that day's attendance state. */
  dayStatus: Map<string, DayStatus>;
  /** AD dates (YYYY-MM-DD) covered by an approved leave request. */
  leaveDates?: Set<string>;
  selectedDate: string | null;
  onSelectDate: (adKey: string) => void;
  /** Fires with the AD date keys currently in view (on mount and whenever
   * the visible month changes) — lets a parent aggregate stats for exactly
   * the month this grid is showing, without owning the anchor itself. */
  onMonthChange?: (adKeys: string[]) => void;
};

/** A day cell's caption + dot color when it has something worth flagging at
 * a glance — mirrors the small in-cell event labels ("Sick Leave", "0.5 day
 * Annual Leave") from the reference dashboard, using our own real
 * attendance/leave data instead of invented event types. */
function dayCaption(status: DayStatus | undefined, onLeave: boolean): { label: string; dot: string } | null {
  if (onLeave) return { label: 'Leave', dot: 'bg-purple-500' };
  if (!status) return null;
  if (status.isLate) return { label: 'Late', dot: 'bg-warning' };
  if (status.isEarly) return { label: 'Early', dot: 'bg-critical' };
  if (status.hasOut) return { label: 'Present', dot: 'bg-good' };
  if (status.hasIn) return { label: 'In', dot: 'bg-warning' };
  return null;
}

export default function MonthCalendar({ dayStatus, leaveDates, selectedDate, onSelectDate, onMonthChange }: Props) {
  const { system } = useCalendarSystem();
  const [anchor, setAnchor] = useState(todayAnchor);
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');

  const month = useMemo(() => buildMonth(system, anchor), [system, anchor]);
  const inMonthCells = useMemo(() => month.weeks.flat().filter(c => c.inMonth), [month]);

  useEffect(() => {
    onMonthChange?.(inMonthCells.map(c => c.adKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  function go(direction: 1 | -1) {
    setAnchor(stepAnchor(system, anchor, direction));
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => go(-1)} className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50">
            ←
          </button>
          <span className="min-w-[10ch] text-center text-base font-semibold text-ink">{month.label}</span>
          <button onClick={() => go(1)} className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50">
            →
          </button>
        </div>
        <div className="flex overflow-hidden rounded-lg border border-slate-200 text-xs font-semibold">
          <button
            onClick={() => setViewMode('calendar')}
            className={`px-3 py-1.5 transition-colors ${viewMode === 'calendar' ? 'bg-accent text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
          >
            Calendar View
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 transition-colors ${viewMode === 'list' ? 'bg-accent text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
          >
            List View
          </button>
        </div>
      </div>

      {viewMode === 'calendar' ? (
        <>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium uppercase text-slate-400">
            {WEEKDAY_LABELS.map(w => (
              <div key={w} className="py-1">
                {w}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {month.weeks.flat().map((cell, i) => {
              const status = dayStatus.get(cell.adKey);
              const onLeave = leaveDates?.has(cell.adKey) ?? false;
              const selected = selectedDate === cell.adKey;
              const caption = cell.inMonth ? dayCaption(status, onLeave) : null;
              const attendanceBg = onLeave ? 'bg-purple-50' : status?.hasOut ? 'bg-good-bg' : status?.hasIn ? 'bg-warning-bg' : '';
              return (
                <button
                  key={`${cell.adKey}-${i}`}
                  onClick={() => onSelectDate(cell.adKey)}
                  className={`relative flex min-h-[40px] flex-col items-center justify-center gap-0.5 rounded-lg text-sm sm:min-h-[50px] ${
                    !cell.inMonth ? 'text-slate-300' : cell.isToday ? 'font-bold text-accent' : 'text-ink'
                  } ${selected ? 'bg-accent text-white' : `${attendanceBg} hover:bg-slate-100`}`}
                >
                  <span>{cell.displayDay}</span>
                  {caption && (
                    <span
                      className={`flex items-center gap-1 truncate px-1 text-[9px] font-medium leading-none ${
                        selected ? 'text-white/90' : 'text-slate-500'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${selected ? 'bg-white' : caption.dot}`} />
                      {caption.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className="max-h-[320px] divide-y divide-slate-100 overflow-y-auto">
          {inMonthCells.map(cell => {
            const status = dayStatus.get(cell.adKey);
            const onLeave = leaveDates?.has(cell.adKey) ?? false;
            const caption = dayCaption(status, onLeave);
            const selected = selectedDate === cell.adKey;
            return (
              <button
                key={cell.adKey}
                onClick={() => onSelectDate(cell.adKey)}
                className={`flex w-full items-center justify-between gap-3 px-2 py-2.5 text-left transition-colors ${
                  selected ? 'bg-accent/10' : 'hover:bg-slate-50'
                }`}
              >
                <span className={`text-sm ${cell.isToday ? 'font-bold text-accent' : 'text-ink'}`}>
                  {cell.displayDay} {month.label.split(' ')[0]}
                </span>
                {caption ? (
                  <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                    <span className={`h-2 w-2 rounded-full ${caption.dot}`} />
                    {caption.label}
                  </span>
                ) : (
                  <span className="text-xs text-slate-300">—</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-warning-bg" /> Checked in
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-good-bg" /> Checked out
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-purple-50" /> On leave
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-warning" /> Late in
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-critical" /> Early out
        </span>
      </div>
    </div>
  );
}
