'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import MonthCalendar from '@/components/MonthCalendar';
import { localDateKey } from '@/lib/calendar';
import { computeDayStatus, formatMinutes, resolveShift } from '@/lib/shift';
import type { AttendanceLog, Employee, Shift } from '@/lib/types';

const WINDOW_DAYS = 400;

export default function CalendarPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
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
    supabase.from('shifts').select('*').then(({ data }) => setShifts(data ?? []));
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

  const dayStatus = useMemo(() => {
    const byDate = new Map<string, AttendanceLog[]>();
    for (const log of logs) {
      const key = localDateKey(log.punch_time);
      const list = byDate.get(key);
      if (list) list.push(log);
      else byDate.set(key, [log]);
    }
    const map = new Map<string, ReturnType<typeof computeDayStatus>>();
    const employee = employees.find(e => e.id === employeeId);
    if (!employee) return map;
    const shift = resolveShift(employee, shifts);
    for (const [date, dayLogs] of byDate) map.set(date, computeDayStatus(dayLogs, shift));
    return map;
  }, [logs, employees, employeeId, shifts]);

  const selectedDaySummary = useMemo(() => {
    if (dayLogs.length === 0) return null;
    const employee = employees.find(e => e.id === employeeId);
    if (!employee) return null;
    return computeDayStatus(dayLogs, resolveShift(employee, shifts));
  }, [dayLogs, employees, employeeId, shifts]);

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
        <MonthCalendar dayStatus={dayStatus} selectedDate={selectedDate} onSelectDate={setSelectedDate} />

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">{selectedDate ?? 'Select a day'}</h2>
          {!selectedDate ? (
            <p className="text-sm text-slate-400">Tap a date on the calendar to see punch times.</p>
          ) : dayLoading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : !selectedDaySummary ? (
            <p className="text-sm text-slate-400">No punches recorded.</p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="w-12 shrink-0 rounded-md bg-good-bg px-2 py-1 text-center text-xs font-bold text-good-text">
                  IN
                </span>
                <span className="text-sm text-ink">
                  {new Date(selectedDaySummary.checkIn.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="text-xs capitalize text-slate-400">{selectedDaySummary.checkIn.method}</span>
              </div>
              {selectedDaySummary.checkOut && (
                <div className="flex items-center gap-3">
                  <span className="w-12 shrink-0 rounded-md bg-warning-bg px-2 py-1 text-center text-xs font-bold text-warning-text">
                    OUT
                  </span>
                  <span className="text-sm text-ink">
                    {new Date(selectedDaySummary.checkOut.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-xs capitalize text-slate-400">{selectedDaySummary.checkOut.method}</span>
                </div>
              )}
              {selectedDaySummary.isLate && (
                <p className="text-xs font-medium text-warning-text">Late by {formatMinutes(selectedDaySummary.lateMinutes)}</p>
              )}
              {selectedDaySummary.isEarly && (
                <p className="text-xs font-medium text-critical-text">
                  Early out by {formatMinutes(selectedDaySummary.earlyMinutes)}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
