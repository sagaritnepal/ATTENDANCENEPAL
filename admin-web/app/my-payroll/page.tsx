'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import EmployeeShell from '@/components/EmployeeShell';
import Badge from '@/components/Badge';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { computeDayStatus, resolveShift } from '@/lib/shift';
import type { AttendanceLog, Employee, PayrollSummary, Shift } from '@/lib/types';

function monthBounds(offset: number) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const start = d.toISOString().slice(0, 10);
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const label = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { start, end, label };
}

/** Days in the *current* real calendar month — salary is a monthly figure,
 * so Received/Remaining prorate against this regardless of which month is
 * currently being viewed above. Matches Attendance Report/Payroll's own
 * proration on the admin side. */
function daysInCurrentMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

type DayRow = {
  date: string;
  hours: number;
  overtime: number;
  isLate: boolean;
  isEarly: boolean;
  pending?: boolean;
};

export default function MyPayrollPage() {
  const { system } = useCalendarSystem();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);

  const { start, end, label } = monthBounds(offset);

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
      const [{ data: emp }, { data: shiftRows }] = await Promise.all([
        supabase.from('employees').select('*').eq('id', profile.employee_id).single(),
        supabase.from('shifts').select('*'),
      ]);
      setEmployee(emp ?? null);
      setShifts(shiftRows ?? []);
    });
  }, []);

  // Same data + same live-calc fallback the admin Payroll/Attendance Report
  // pages use: payroll_summaries where the nightly job has already run,
  // computeDayStatus() against raw punches where it hasn't — so today's
  // punch shows up here immediately instead of only after that job runs.
  useEffect(() => {
    if (!employeeId) return;
    supabase
      .from('payroll_summaries')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('work_date', start)
      .lte('work_date', end)
      .then(({ data }) => setSummaries(data ?? []));
    supabase
      .from('attendance_logs')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('punch_time', `${start}T00:00:00Z`)
      .lte('punch_time', `${end}T23:59:59Z`)
      .then(({ data }) => setLogs(data ?? []));
  }, [employeeId, start, end]);

  const dayRows: DayRow[] = useMemo(() => {
    if (!employee) return [];
    const shift = resolveShift(employee, shifts);
    const days: string[] = [];
    const cur = new Date(start + 'T00:00:00Z');
    const endDate = new Date(end + 'T00:00:00Z');
    while (cur <= endDate) {
      days.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    const out: DayRow[] = [];
    for (const day of days) {
      const summary = summaries.find(s => s.work_date === day);
      if (summary) {
        out.push({
          date: day,
          hours: Number(summary.total_hours),
          overtime: Number(summary.overtime_hours),
          isLate: summary.is_late,
          isEarly: summary.is_early_departure,
        });
        continue;
      }
      const dayLogs = logs.filter(l => l.punch_time.slice(0, 10) === day).sort((a, b) => a.punch_time.localeCompare(b.punch_time));
      if (dayLogs.length === 0) continue;
      const live = computeDayStatus(dayLogs, shift);
      out.push({
        date: day,
        hours: live.totalMinutes / 60,
        overtime: live.overtimeMinutes / 60,
        isLate: live.isLate,
        isEarly: live.isEarly,
        pending: true,
      });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }, [summaries, logs, employee, shifts, start, end]);

  const totals = useMemo(() => {
    const totalHours = dayRows.reduce((s, r) => s + r.hours, 0);
    const overtimeHours = dayRows.reduce((s, r) => s + r.overtime, 0);
    const lateDays = dayRows.filter(r => r.isLate).length;
    return { totalHours, overtimeHours, presentDays: dayRows.length, lateDays };
  }, [dayRows]);

  const daysInMonth = daysInCurrentMonth();
  const received = employee?.salary != null ? Math.round((employee.salary / daysInMonth) * totals.presentDays) : null;
  const remaining = employee?.salary != null && received != null ? Math.max(0, employee.salary - received) : null;

  return (
    <EmployeeShell title="Payroll">
      {loading ? (
        <p className="text-center text-sm text-slate-400">Loading…</p>
      ) : !employeeId ? (
        <p className="mt-10 text-center text-sm text-warning-text">Your account isn&apos;t linked to an employee record yet.</p>
      ) : (
        <>
          {employee?.salary != null && (
            <div className="mb-5 grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-good-bg p-3 text-center">
                <div className="text-[10px] font-medium uppercase text-good-text">Salary</div>
                <div className="text-sm font-bold text-ink">{employee.salary.toLocaleString()}</div>
              </div>
              <div className="rounded-xl bg-info-bg p-3 text-center">
                <div className="text-[10px] font-medium uppercase text-info-text">Received</div>
                <div className="text-sm font-bold text-ink">{received != null ? received.toLocaleString() : '—'}</div>
              </div>
              <div className="rounded-xl bg-warning-bg p-3 text-center">
                <div className="text-[10px] font-medium uppercase text-warning-text">Remaining</div>
                <div className="text-sm font-bold text-ink">{remaining != null ? remaining.toLocaleString() : '—'}</div>
              </div>
            </div>
          )}

          <div className="mb-4 flex items-center justify-between">
            <button onClick={() => setOffset(o => o - 1)} className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50">
              ←
            </button>
            <span className="text-sm font-semibold text-ink">{label}</span>
            <button onClick={() => setOffset(o => o + 1)} className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50">
              →
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-good-bg p-4">
              <div className="text-xs font-medium text-good-text">Total Hours</div>
              <div className="mt-1 text-xl font-bold text-ink">{totals.totalHours.toFixed(1)} hrs</div>
            </div>
            <div className="rounded-xl bg-info-bg p-4">
              <div className="text-xs font-medium text-info-text">Overtime</div>
              <div className="mt-1 text-xl font-bold text-ink">{totals.overtimeHours.toFixed(1)} hrs</div>
            </div>
            <div className="rounded-xl bg-good-bg p-4">
              <div className="text-xs font-medium text-good-text">Present Days</div>
              <div className="mt-1 text-xl font-bold text-ink">{totals.presentDays}</div>
            </div>
            <div className="rounded-xl bg-warning-bg p-4">
              <div className="text-xs font-medium text-warning-text">Late Days</div>
              <div className="mt-1 text-xl font-bold text-ink">{totals.lateDays}</div>
            </div>
          </div>

          <h2 className="mb-3 mt-6 text-sm font-semibold text-ink">Daily Breakdown</h2>
          {dayRows.length === 0 ? (
            <p className="mt-2 text-center text-sm text-slate-400">No attendance records for this month yet.</p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {dayRows.map(row => (
                <div key={row.date} className="px-4 py-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-medium text-ink">
                      {formatAdDate(row.date, system)}
                      {row.pending && <span className="ml-1 text-[10px] font-normal text-slate-400">(live)</span>}
                    </span>
                    <span className="text-sm font-semibold text-ink">{row.hours.toFixed(1)} hrs</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {row.isLate && <Badge tone="warning">Late</Badge>}
                    {row.isEarly && <Badge tone="critical">Early Out</Badge>}
                    {row.overtime > 0 && <Badge tone="info">OT {row.overtime.toFixed(1)}h</Badge>}
                    {!row.isLate && !row.isEarly && row.overtime === 0 && <Badge tone="good">On Time</Badge>}
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
