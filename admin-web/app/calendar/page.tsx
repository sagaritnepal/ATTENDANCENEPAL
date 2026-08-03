'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import MonthCalendar from '@/components/MonthCalendar';
import { localDateKey } from '@/lib/calendar';
import { computeDayStatus, formatMinutes, resolveShift } from '@/lib/shift';
import type { AttendanceLog, Employee, LeaveRequest, Shift } from '@/lib/types';

const WINDOW_DAYS = 400;

/** Every AD date key (YYYY-MM-DD) from start to end, inclusive — mirrors
 * my-calendar/page.tsx's datesBetween(). Both bounds are already plain
 * dates (Postgres `date` columns), so this stays local-date arithmetic. */
function datesBetween(start: string, end: string): string[] {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const last = new Date(ey, em - 1, ed);
  const dates: string[] = [];
  for (let d = new Date(sy, sm - 1, sd); d <= last; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return dates;
}

export default function CalendarPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employeeId, setEmployeeId] = useState<string>('');
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
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
    supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', employeeId)
      .eq('status', 'approved')
      .then(({ data }) => setLeaveRequests(data ?? []));
  }, [employeeId]);

  const leaveByDate = useMemo(() => {
    const map = new Map<string, LeaveRequest>();
    for (const lr of leaveRequests) {
      for (const date of datesBetween(lr.start_date, lr.end_date)) map.set(date, lr);
    }
    return map;
  }, [leaveRequests]);

  const leaveDates = useMemo(() => new Set(leaveByDate.keys()), [leaveByDate]);
  const selectedLeave = selectedDate ? leaveByDate.get(selectedDate) ?? null : null;

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
        <MonthCalendar dayStatus={dayStatus} leaveDates={leaveDates} selectedDate={selectedDate} onSelectDate={setSelectedDate} />

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-ink">{selectedDate ?? 'Select a day'}</h2>
          {selectedLeave && (
            <div className="mb-3 rounded-xl bg-purple-100 p-3">
              <div className="text-xs font-medium text-purple-700">On Leave</div>
              <div className="text-base font-bold capitalize text-ink">{selectedLeave.leave_type}</div>
            </div>
          )}
          {!selectedDate ? (
            <p className="text-sm text-slate-400">Tap a date on the calendar to see punch times.</p>
          ) : dayLoading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : !selectedDaySummary ? (
            !selectedLeave && <p className="text-sm text-slate-400">No punches recorded.</p>
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
