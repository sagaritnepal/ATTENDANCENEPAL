'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import EmployeeShell from '@/components/EmployeeShell';
import MonthCalendar from '@/components/MonthCalendar';
import { localDateKey } from '@/lib/calendar';
import type { AttendanceLog } from '@/lib/types';

const WINDOW_DAYS = 400;

export default function MyCalendarPage() {
  const [employeeId, setEmployeeId] = useState<string | null>(null);
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
      const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
      const { data: rows } = await supabase
        .from('attendance_logs')
        .select('*')
        .eq('employee_id', profile.employee_id)
        .gte('punch_time', since)
        .order('punch_time', { ascending: true });
      setLogs(rows ?? []);
    });
  }, []);

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
    <EmployeeShell title="Calendar">
      {loading ? (
        <p className="text-center text-sm text-slate-400">Loading…</p>
      ) : !employeeId ? (
        <p className="mt-10 text-center text-sm text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>
      ) : (
        <>
          <MonthCalendar presentDates={presentDates} selectedDate={selectedDate} onSelectDate={setSelectedDate} />

          {selectedDate && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold text-ink">{selectedDate}</h2>
              {dayLoading ? (
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
          )}
        </>
      )}
    </EmployeeShell>
  );
}
