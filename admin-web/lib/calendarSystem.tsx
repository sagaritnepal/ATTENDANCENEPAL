'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import type { CalendarSystem } from './calendar';

const STORAGE_KEY = 'attendance-nepal-calendar-system';

const CalendarSystemContext = createContext<{
  system: CalendarSystem;
  setSystem: (system: CalendarSystem) => void;
}>({ system: 'BS', setSystem: () => {} });

export function CalendarSystemProvider({ children }: { children: React.ReactNode }) {
  // BS (Nepali calendar) is the default for a first-time visitor — AD stays
  // fully available via the switch, this only changes what's selected
  // before anyone's ever touched it. Anyone who already picked AD before
  // (or picks it going forward) keeps that choice via localStorage below,
  // same as always.
  const [system, setSystemState] = useState<CalendarSystem>('BS');

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'AD' || stored === 'BS') setSystemState(stored);
  }, []);

  function setSystem(next: CalendarSystem) {
    setSystemState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  return <CalendarSystemContext.Provider value={{ system, setSystem }}>{children}</CalendarSystemContext.Provider>;
}

/** The one global AD/BS choice — every date field and every displayed date
 * across the app reads and writes this same value, so switching it once
 * (from the switch in the page header) changes everything at once. */
export function useCalendarSystem() {
  return useContext(CalendarSystemContext);
}
