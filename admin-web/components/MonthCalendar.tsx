'use client';

import { useMemo, useState } from 'react';
import { buildMonth, stepAnchor, todayAnchor } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import type { DayStatus } from '@/lib/shift';

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

type Props = {
  /** AD date (YYYY-MM-DD) -> that day's attendance state. */
  dayStatus: Map<string, DayStatus>;
  selectedDate: string | null;
  onSelectDate: (adKey: string) => void;
};

export default function MonthCalendar({ dayStatus, selectedDate, onSelectDate }: Props) {
  const { system } = useCalendarSystem();
  const [anchor, setAnchor] = useState(todayAnchor);

  const month = useMemo(() => buildMonth(system, anchor), [system, anchor]);

  function go(direction: 1 | -1) {
    setAnchor(stepAnchor(system, anchor, direction));
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => go(-1)} className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50">
            ←
          </button>
          <span className="min-w-[10ch] text-center text-sm font-semibold text-ink">{month.label}</span>
          <button onClick={() => go(1)} className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50">
            →
          </button>
        </div>
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
          const selected = selectedDate === cell.adKey;
          const attendanceBg = status?.hasOut ? 'bg-good-bg' : status?.hasIn ? 'bg-warning-bg' : '';
          return (
            <button
              key={`${cell.adKey}-${i}`}
              onClick={() => onSelectDate(cell.adKey)}
              className={`relative aspect-square rounded-lg text-sm ${
                !cell.inMonth ? 'text-slate-300' : cell.isToday ? 'font-bold text-accent' : 'text-ink'
              } ${selected ? 'bg-accent text-white' : `${attendanceBg} hover:bg-slate-100`}`}
            >
              {cell.displayDay}
              {status && !selected && (status.isLate || status.isEarly) && (
                <span className="absolute bottom-1 left-1/2 flex -translate-x-1/2 gap-0.5">
                  {status.isLate && <span className="h-1 w-1 rounded-full bg-warning" title="Late in" />}
                  {status.isEarly && <span className="h-1 w-1 rounded-full bg-critical" title="Early out" />}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-warning-bg" /> Checked in
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-good-bg" /> Checked out
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-warning" /> Late in
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-critical" /> Early out
        </span>
      </div>
    </div>
  );
}
