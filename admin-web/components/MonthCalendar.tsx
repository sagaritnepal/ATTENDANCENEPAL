'use client';

import { useEffect, useMemo, useState } from 'react';
import { buildMonth, localDateKey, stepAnchor, todayAnchor } from '@/lib/calendar';
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

type DayFlags = {
  late: boolean;
  early: boolean;
  leave: boolean;
  present: boolean;
  checkedInOnly: boolean;
  absent: boolean;
};

/** Late and Early can both apply to the same day (late in AND left early),
 * so they're tracked independently rather than as a single "the" flag — one
 * renders above the day number, the other below. Everything else (leave,
 * present, still-clocked-in, absent) is mutually exclusive and gets a single
 * dot. A day with no punches, not on leave, that's already happened counts
 * as absent — previously such a day rendered identically to a future day
 * with no way to tell them apart. */
function dayFlags(status: DayStatus | undefined, onLeave: boolean, isPastOrToday: boolean): DayFlags {
  if (onLeave) return { late: false, early: false, leave: true, present: false, checkedInOnly: false, absent: false };
  if (!status) return { late: false, early: false, leave: false, present: false, checkedInOnly: false, absent: isPastOrToday };
  return {
    late: status.isLate,
    early: status.isEarly,
    leave: false,
    present: status.hasOut && !status.isLate && !status.isEarly,
    checkedInOnly: status.hasIn && !status.hasOut,
    absent: false,
  };
}

function captionFor(flags: DayFlags): string | undefined {
  const parts: string[] = [];
  if (flags.leave) parts.push('On leave');
  if (flags.late) parts.push('Late in');
  if (flags.early) parts.push('Early out');
  if (flags.present) parts.push('Present');
  if (flags.checkedInOnly) parts.push('Checked in');
  if (flags.absent) parts.push('Absent');
  return parts.length > 0 ? parts.join(' & ') : undefined;
}

export default function MonthCalendar({ dayStatus, leaveDates, selectedDate, onSelectDate, onMonthChange }: Props) {
  const { system } = useCalendarSystem();
  const [anchor, setAnchor] = useState(todayAnchor);

  const month = useMemo(() => buildMonth(system, anchor), [system, anchor]);
  const inMonthCells = useMemo(() => month.weeks.flat().filter(c => c.inMonth), [month]);
  const todayKey = useMemo(() => localDateKey(new Date().toISOString()), []);

  useEffect(() => {
    onMonthChange?.(inMonthCells.map(c => c.adKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  function go(direction: 1 | -1) {
    setAnchor(stepAnchor(system, anchor, direction));
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-center gap-3">
        <button onClick={() => go(-1)} className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50">
          ←
        </button>
        <span className="min-w-[10ch] text-center text-base font-semibold text-ink">{month.label}</span>
        <button onClick={() => go(1)} className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50">
          →
        </button>
      </div>

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
          const flags = cell.inMonth ? dayFlags(status, onLeave, cell.adKey <= todayKey) : dayFlags(undefined, false, false);
          const caption = cell.inMonth ? captionFor(flags) : undefined;
          const attendanceBg = onLeave
            ? 'bg-purple-50'
            : flags.present || flags.late
              ? 'bg-good-bg'
              : flags.checkedInOnly
                ? 'bg-info-bg'
                : flags.absent
                  ? 'bg-slate-100'
                  : '';
          return (
            <button
              key={`${cell.adKey}-${i}`}
              onClick={() => onSelectDate(cell.adKey)}
              title={caption}
              className={`relative flex min-h-[52px] flex-col items-center justify-center rounded-lg text-sm sm:min-h-[60px] ${
                !cell.inMonth ? 'text-slate-300' : cell.isToday ? 'font-bold text-accent' : 'text-ink'
              } ${selected ? 'bg-accent text-white' : `${attendanceBg} hover:bg-slate-100`}`}
            >
              {flags.late && (
                <span
                  className={`absolute top-1 rounded-full px-1.5 py-px text-[8px] font-bold uppercase leading-none shadow-sm ${
                    selected ? 'bg-white text-accent' : 'bg-warning text-white'
                  }`}
                >
                  Late
                </span>
              )}
              <span>{cell.displayDay}</span>
              {flags.early ? (
                <span
                  className={`absolute bottom-1 rounded-full px-1.5 py-px text-[8px] font-bold uppercase leading-none shadow-sm ${
                    selected ? 'bg-white text-accent' : 'bg-critical text-white'
                  }`}
                >
                  Early
                </span>
              ) : flags.leave ? (
                <span className={`absolute bottom-1.5 h-1.5 w-1.5 rounded-full ${selected ? 'bg-white' : 'bg-purple-500'}`} />
              ) : flags.absent ? (
                <span className={`absolute bottom-1.5 h-1.5 w-1.5 rounded-full ${selected ? 'bg-white' : 'bg-slate-400'}`} />
              ) : flags.present ? (
                <span className={`absolute bottom-1.5 h-1.5 w-1.5 rounded-full ${selected ? 'bg-white' : 'bg-good'}`} />
              ) : flags.checkedInOnly ? (
                <span className={`absolute bottom-1.5 h-1.5 w-1.5 rounded-full ${selected ? 'bg-white' : 'bg-info'}`} />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-good" /> Present
        </span>
        <span className="flex items-center gap-1.5">
          <span className="rounded-full bg-warning px-1.5 py-px text-[8px] font-bold uppercase leading-none text-white">Late</span> Late in
        </span>
        <span className="flex items-center gap-1.5">
          <span className="rounded-full bg-critical px-1.5 py-px text-[8px] font-bold uppercase leading-none text-white">Early</span> Early out
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-info" /> Checked in
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-purple-500" /> On leave
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-400" /> Absent
        </span>
      </div>
    </div>
  );
}
