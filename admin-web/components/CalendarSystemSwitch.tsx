'use client';

import { useCalendarSystem } from '@/lib/calendarSystem';

/** The one AD/BS switch for the whole app — lives next to the page title. */
export default function CalendarSystemSwitch() {
  const { system, setSystem } = useCalendarSystem();

  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="hidden text-xs font-medium text-slate-400 sm:inline">Calendar:</span>
      <div className="flex overflow-hidden rounded-lg border border-slate-300 text-sm font-semibold shadow-sm">
        <button
          type="button"
          onClick={() => setSystem('AD')}
          title="Gregorian calendar"
          className={`px-4 py-1.5 transition-colors ${
            system === 'AD' ? 'bg-accent text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
          }`}
        >
          AD
        </button>
        <button
          type="button"
          onClick={() => setSystem('BS')}
          title="Nepali (Bikram Sambat) calendar"
          className={`px-4 py-1.5 transition-colors ${
            system === 'BS' ? 'bg-accent text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
          }`}
        >
          BS
        </button>
      </div>
    </div>
  );
}
