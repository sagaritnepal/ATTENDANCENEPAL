'use client';

import { useMemo, useState } from 'react';
import { buildMonth, stepAnchor, todayAnchor, type CalendarSystem } from '@/lib/calendar';

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

type Props = {
  /** AD dates (YYYY-MM-DD) that have at least one attendance punch. */
  presentDates: Set<string>;
  selectedDate: string | null;
  onSelectDate: (adKey: string) => void;
};

export default function MonthCalendar({ presentDates, selectedDate, onSelectDate }: Props) {
  const [system, setSystem] = useState<CalendarSystem>('BS');
  const [anchor, setAnchor] = useState(todayAnchor);

  const month = useMemo(() => buildMonth(system, anchor.year, anchor.month), [system, anchor]);

  function go(direction: 1 | -1) {
    setAnchor(stepAnchor(system, anchor.year, anchor.month, direction));
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
        <div className="flex overflow-hidden rounded-lg border border-slate-200 text-xs font-semibold">
          <button
            onClick={() => setSystem('AD')}
            className={`px-3 py-1.5 ${system === 'AD' ? 'bg-accent text-white' : 'bg-white text-slate-500'}`}
          >
            AD
          </button>
          <button
            onClick={() => setSystem('BS')}
            className={`px-3 py-1.5 ${system === 'BS' ? 'bg-accent text-white' : 'bg-white text-slate-500'}`}
          >
            BS
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
          const present = presentDates.has(cell.adKey);
          const selected = selectedDate === cell.adKey;
          return (
            <button
              key={`${cell.adKey}-${i}`}
              onClick={() => onSelectDate(cell.adKey)}
              className={`relative aspect-square rounded-lg text-sm ${
                !cell.inMonth ? 'text-slate-300' : cell.isToday ? 'font-bold text-accent' : 'text-ink'
              } ${selected ? 'bg-accent text-white' : 'hover:bg-slate-100'}`}
            >
              {cell.displayDay}
              {present && !selected && (
                <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-good" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
