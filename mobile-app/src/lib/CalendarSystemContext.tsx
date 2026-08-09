import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CalendarSystem } from './calendar';

const STORAGE_KEY = 'attendance-nepal-calendar-system';

const CalendarSystemContext = createContext<{ system: CalendarSystem; setSystem: (system: CalendarSystem) => void }>({
  system: 'AD',
  setSystem: () => {},
});

export function CalendarSystemProvider({ children }: { children: React.ReactNode }) {
  const [system, setSystemState] = useState<CalendarSystem>('AD');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(stored => {
      if (stored === 'AD' || stored === 'BS') setSystemState(stored);
    });
  }, []);

  function setSystem(next: CalendarSystem) {
    setSystemState(next);
    AsyncStorage.setItem(STORAGE_KEY, next);
  }

  return <CalendarSystemContext.Provider value={{ system, setSystem }}>{children}</CalendarSystemContext.Provider>;
}

export function useCalendarSystem() {
  return useContext(CalendarSystemContext);
}
