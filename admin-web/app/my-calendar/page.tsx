'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import EmployeeShell from '@/components/EmployeeShell';
import MonthCalendar from '@/components/MonthCalendar';
import { formatAdDate, localDateKey } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { computeDayStatus, formatMinutes, resolveShift } from '@/lib/shift';
import type { AttendanceLog, Employee, Shift } from '@/lib/types';

const WINDOW_DAYS = 400;

export default function MyCalendarPage() {
  const { system } = useCalendarSystem();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayLogs, setDayLogs] = useState<AttendanceLog[]>([]);
  const [dayLoading, setDayLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('employee_id')
        .eq('id', data.user.id)
        .single();
      setLoading(false);
      if (!profile?.employee_id) return;
      setEmployeeId(profile.employee_id);
      const [{ data: emp }, { data: shiftRows }, { data: rows }] = await Promise.all([
        supabase.from('employees').select('*').eq('id', profile.employee_id).single(),
        supabase.from('shifts').select('*'),
        supabase
          .from('attendance_logs')
          .select('*')
          .eq('employee_id', profile.employee_id)
          .gte('punch_time', new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString())
          .order('punch_time', { ascending: true }),
      ]);
      setEmployee(emp ?? null);
      setShifts(shiftRows ?? []);
      setLogs(rows ?? []);
    });
  }, []);

  const dayStatus = useMemo(() => {
    const byDate = new Map<string, AttendanceLog[]>();
    for (const log of logs) {
      const key = localDateKey(log.punch_time);
      const list = byDate.get(key);
      if (list) list.push(log);
      else byDate.set(key, [log]);
    }
    const map = new Map<string, ReturnType<typeof computeDayStatus>>();
    if (!employee) return map;
    const shift = resolveShift(employee, shifts);
    for (const [date, dayLogs] of byDate) map.set(date, computeDayStatus(dayLogs, shift));
    return map;
  }, [logs, employee, shifts]);

  const history = useMemo(() => [...logs].sort((a, b) => b.punch_time.localeCompare(a.punch_time)).slice(0, 50), [logs]);

  const selectedDaySummary = useMemo(() => {
    if (dayLogs.length === 0 || !employee) return null;
    return computeDayStatus(dayLogs, resolveShift(employee, shifts));
  }, [dayLogs, employee, shifts]);

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
    <EmployeeShell title="Calendar">
      {loading ? (
        <p className="text-center text-sm text-slate-400">Loading…</p>
      ) : !employeeId ? (
        <p className="mt-10 text-center text-sm text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>
      ) : (
        <>
          <MonthCalendar dayStatus={dayStatus} selectedDate={selectedDate} onSelectDate={setSelectedDate} />

          {selectedDate && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold text-ink">{formatAdDate(selectedDate, system)}</h2>
              {dayLoading ? (
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
          )}

          <h2 className="mb-3 mt-6 text-sm font-semibold text-ink">History</h2>
          {history.length === 0 ? (
            <p className="mt-2 text-center text-sm text-slate-400">No attendance records yet.</p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {history.map(log => (
                <div key={log.id} className="flex items-center gap-3 px-4 py-3">
                  <span
                    className={`w-12 shrink-0 rounded-md px-2 py-1 text-center text-xs font-bold ${
                      log.punch_type === '0' ? 'bg-good-bg text-good-text' : 'bg-warning-bg text-warning-text'
                    }`}
                  >
                    {log.punch_type === '0' ? 'IN' : 'OUT'}
                  </span>
                  <div className="flex-1">
                    <div className="text-sm text-ink">
                      {formatAdDate(localDateKey(log.punch_time), system)} ·{' '}
                      {new Date(log.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="text-xs capitalize text-slate-400">{log.method}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </EmployeeShell>
  );
}
