'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import MonthCalendar from '@/components/MonthCalendar';
import { localDateKey } from '@/lib/calendar';
import type { AttendanceLog, Employee } from '@/lib/types';

const WINDOW_DAYS = 400;

export default function CalendarPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeId, setEmployeeId] = useState<string>('');
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayLogs, setDayLogs] = useState<AttendanceLog[]>([]);
  const [dayLoading, setDayLoading] = useState(false);

  useEffect(() => {
    supabase
      .from('employees')
      .select('*')
      .eq('status', 'active')
      .order('name')
      .then(({ data }) => {
        setEmployees(data ?? []);
        if (data && data.length > 0) setEmployeeId(data[0].id);
      });
  }, []);

  useEffect(() => {
    if (!employeeId) return;
    setSelectedDate(null);
    const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
    supabase
      .from('attendance_logs')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('punch_time', since)
      .order('punch_time', { ascending: true })
      .then(({ data }) => setLogs(data ?? []));
  }, [employeeId]);

  const presentDates = useMemo(() => {
    const set = new Set<string>();
    for (const log of logs) set.add(localDateKey(log.punch_time));
    return set;
  }, [logs]);

  useEffect(() => {
    if (!selectedDate || !employeeId) {
      setDayLogs([]);
      return;
    }
    setDayLoading(true);
    const start = `${selectedDate}T00:00:00`;
    const end = new Date(new Date(start).getTime() + 86400000).toISOString();
    supabase
      .from('attendance_logs')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('punch_time', start)
      .lt('punch_time', end)
      .order('punch_time', { ascending: true })
      .then(({ data }) => {
        setDayLogs(data ?? []);
        setDayLoading(false);
      });
  }, [selectedDate, employeeId]);

  return (
    <AppShell title="Attendance Calendar">
      <div className="mb-5 max-w-xs">
        <label className="mb-1 block text-xs font-medium text-slate-600">Employee</label>
        <select
          value={employeeId}
          onChange={e => setEmployeeId(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          {employees.map(emp => (
            <option key={emp.id} value={emp.id}>
              {emp.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        <MonthCalendar presentDates={presentDates} selectedDate={selectedDate} onSelectDate={setSelectedDate} />

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">{selectedDate ?? 'Select a day'}</h2>
          {!selectedDate ? (
            <p className="text-sm text-slate-400">Tap a date on the calendar to see punch times.</p>
          ) : dayLoading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : dayLogs.length === 0 ? (
            <p className="text-sm text-slate-400">No punches recorded.</p>
          ) : (
            <div className="space-y-2">
              {dayLogs.map(log => (
                <div key={log.id} className="flex items-center gap-3">
                  <span
                    className={`w-12 shrink-0 rounded-md px-2 py-1 text-center text-xs font-bold ${
                      log.punch_type === '0' ? 'bg-good-bg text-good-text' : 'bg-warning-bg text-warning-text'
                    }`}
                  >
                    {log.punch_type === '0' ? 'IN' : 'OUT'}
                  </span>
                  <span className="text-sm text-ink">
                    {new Date(log.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-xs capitalize text-slate-400">{log.method}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
