'use client';

import { useCalendarSystem } from '@/lib/calendarSystem';

/** The one AD/BS switch for the whole app — lives next to the page title. */
export default function CalendarSystemSwitch() {
  const { system, setSystem } = useCalendarSystem();

  return (
    <div className="flex shrink-0 items-center">
      <div className="flex overflow-hidden rounded-lg border border-slate-300 text-base font-bold shadow-sm">
        <button
          type="button"
          onClick={() => setSystem('AD')}
          title="Gregorian calendar"
          className={`px-5 py-2 transition-colors ${
            system === 'AD' ? 'bg-accent text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
          }`}
        >
          AD
        </button>
        <button
          type="button"
          onClick={() => setSystem('BS')}
          title="Nepali (Bikram Sambat) calendar"
          className={`px-5 py-2 transition-colors ${
            system === 'BS' ? 'bg-accent text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
          }`}
        >
          BS
        </button>
      </div>
    </div>
  );
}
