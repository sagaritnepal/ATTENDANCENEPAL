'use client';

import { useCalendarSystem } from '@/lib/calendarSystem';

/** The one AD/BS switch for the whole app — lives next to the page title. */
export default function CalendarSystemSwitch() {
  const { system, setSystem } = useCalendarSystem();

  return (
    <div className="flex shrink-0 items-center">
      <div className="flex overflow-hidden rounded-lg border border-slate-300 text-sm font-bold shadow-sm sm:text-base">
        <button
          type="button"
          onClick={() => setSystem('AD')}
          title="Gregorian calendar"
          className={`px-3 py-1.5 transition-colors sm:px-5 sm:py-2 ${
            system === 'AD' ? 'bg-accent text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
          }`}
        >
          AD
        </button>
        <button
          type="button"
          onClick={() => setSystem('BS')}
          title="Nepali (Bikram Sambat) calendar"
          className={`px-3 py-1.5 transition-colors sm:px-5 sm:py-2 ${
            system === 'BS' ? 'bg-accent text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
          }`}
        >
          BS
        </button>
      </div>
    </div>
  );
}
