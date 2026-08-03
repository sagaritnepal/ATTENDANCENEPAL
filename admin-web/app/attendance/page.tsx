'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import DatePicker from '@/components/DatePicker';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import type { AttendanceLog, Employee, PayrollSummary } from '@/lib/types';

type DayEntry = {
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  hours: number;
  overtime: number;
  lateMinutes: number;
  earlyMinutes: number;
  status: 'Present' | 'Late' | 'Absent';
  pending?: boolean;
};

type EmployeeStat = {
  id: string;
  name: string;
  salary: number | null;
  presentDays: number;
  pendingDays: number;
  lateDays: number;
  lateMinutes: number;
  earlyDays: number;
  earlyMinutes: number;
  absentDays: number;
  hours: number;
  overtime: number;
  days: DayEntry[];
};

function isoDaysAgo(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function isoWeekStart() {
  const d = new Date();
  const day = d.getUTCDay(); // 0 = Sun … 6 = Sat
  const diff = (day === 0 ? -6 : 1) - day; // shift back to Monday
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diff);
  return monday.toISOString().slice(0, 10);
}

function isoMonthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

/** Days in the *current* real calendar month — salary is a monthly figure,
 * so Received/Remaining prorate against this regardless of what date range
 * is currently selected in the filters above (which may be a week, a
 * custom range, etc.). */
function daysInCurrentMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}

const PRESETS = [
  { key: 'today', label: 'Today', from: () => isoDaysAgo(0), to: () => isoDaysAgo(0) },
  { key: 'week', label: 'This Week', from: isoWeekStart, to: () => isoDaysAgo(0) },
  { key: 'month', label: 'This Month', from: isoMonthStart, to: () => isoDaysAgo(0) },
] as const;

export default function AttendancePage() {
  return (
    <Suspense fallback={null}>
      <AttendanceView />
    </Suspense>
  );
}

function AttendanceView() {
  const { system } = useCalendarSystem();
  const searchParams = useSearchParams();
  const initialEmployeeId = searchParams.get('employee');
  const [from, setFrom] = useState(isoDaysAgo(6));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [status, setStatus] = useState<'All' | 'Present' | 'Late' | 'Absent'>('All');
  const [employeeId, setEmployeeId] = useState<string>(initialEmployeeId ?? 'all');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('employees').select('*').eq('status', 'active').order('name').then(({ data }) => setEmployees(data ?? []));
  }, []);

  useEffect(() => {
    supabase
      .from('payroll_summaries')
      .select('*')
      .gte('work_date', from)
      .lte('work_date', to)
      .then(({ data }) => setSummaries(data ?? []));
    supabase
      .from('attendance_logs')
      .select('*')
      .gte('punch_time', `${from}T00:00:00Z`)
      .lte('punch_time', `${to}T23:59:59Z`)
      .then(({ data }) => setLogs(data ?? []));
  }, [from, to]);

  function applyPreset(preset: (typeof PRESETS)[number]) {
    setFrom(preset.from());
    setTo(preset.to());
    setActivePreset(preset.key);
  }

  const scopedEmployees = useMemo(
    () => (employeeId === 'all' ? employees : employees.filter(e => e.id === employeeId)),
    [employees, employeeId]
  );

  const daysInMonth = daysInCurrentMonth();

  // One tile's worth of data per employee, aggregated across the selected
  // range — same payroll_summaries source Payroll's own roster table reads,
  // so Late/Early/Hours here always agree with what Payroll shows. Each
  // employee also keeps its day-by-day entries so the full log is still
  // reachable (expand the tile) instead of disappearing.
  const employeeStats: EmployeeStat[] = useMemo(() => {
    const days: string[] = [];
    const cur = new Date(from + 'T00:00:00Z');
    const end = new Date(to + 'T00:00:00Z');
    while (cur <= end) {
      days.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    const map = new Map<string, EmployeeStat>();
    for (const emp of scopedEmployees) {
      map.set(emp.id, {
        id: emp.id,
        name: emp.name,
        salary: emp.salary,
        presentDays: 0,
        pendingDays: 0,
        lateDays: 0,
        lateMinutes: 0,
        earlyDays: 0,
        earlyMinutes: 0,
        absentDays: 0,
        hours: 0,
        overtime: 0,
        days: [],
      });
    }

    for (const day of days) {
      for (const emp of scopedEmployees) {
        const row = map.get(emp.id)!;
        const summary = summaries.find(s => s.employee_id === emp.id && s.work_date === day);
        if (summary) {
          row.presentDays += 1;
          row.hours += Number(summary.total_hours);
          row.overtime += Number(summary.overtime_hours);
          if (summary.is_late) {
            row.lateDays += 1;
            row.lateMinutes += summary.late_minutes;
          }
          if (summary.is_early_departure) {
            row.earlyDays += 1;
            row.earlyMinutes += summary.early_departure_minutes;
          }
          row.days.push({
            date: day,
            checkIn: summary.check_in,
            checkOut: summary.check_out,
            hours: Number(summary.total_hours),
            overtime: Number(summary.overtime_hours),
            lateMinutes: summary.is_late ? summary.late_minutes : 0,
            earlyMinutes: summary.is_early_departure ? summary.early_departure_minutes : 0,
            status: summary.is_late ? 'Late' : 'Present',
          });
        } else {
          const dayLogs = logs
            .filter(l => l.employee_id === emp.id && l.punch_time.slice(0, 10) === day)
            .sort((a, b) => a.punch_time.localeCompare(b.punch_time));
          if (dayLogs.length > 0) {
            // Not yet processed by compute_payroll_summaries() (runs
            // nightly, or manually via "Recalculate month" on Payroll) —
            // count as present so today's punch isn't shown as an absence,
            // but exclude from hours/late/early until that recompute runs.
            row.presentDays += 1;
            row.pendingDays += 1;
            row.days.push({
              date: day,
              checkIn: dayLogs[0].punch_time,
              checkOut: dayLogs.length > 1 ? dayLogs[dayLogs.length - 1].punch_time : null,
              hours: 0,
              overtime: 0,
              lateMinutes: 0,
              earlyMinutes: 0,
              status: 'Present',
              pending: true,
            });
          } else {
            row.absentDays += 1;
            row.days.push({
              date: day,
              checkIn: null,
              checkOut: null,
              hours: 0,
              overtime: 0,
              lateMinutes: 0,
              earlyMinutes: 0,
              status: 'Absent',
            });
          }
        }
      }
    }

    for (const row of map.values()) row.days.sort((a, b) => b.date.localeCompare(a.date));

    let list = Array.from(map.values());
    if (status === 'Present') list = list.filter(e => e.presentDays > 0);
    else if (status === 'Late') list = list.filter(e => e.lateDays > 0);
    else if (status === 'Absent') list = list.filter(e => e.absentDays > 0);
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }, [scopedEmployees, summaries, logs, from, to, status]);

  function received(emp: EmployeeStat) {
    if (emp.salary == null) return null;
    return Math.round((emp.salary / daysInMonth) * emp.presentDays);
  }

  function remaining(emp: EmployeeStat) {
    const r = received(emp);
    if (emp.salary == null || r == null) return null;
    return Math.max(0, emp.salary - r);
  }

  const overallTotals = useMemo(() => {
    const hours = employeeStats.reduce((sum, e) => sum + e.hours, 0);
    const overtime = employeeStats.reduce((sum, e) => sum + e.overtime, 0);
    return { hours, overtime };
  }, [employeeStats]);

  function exportCsv() {
    const header = [
      'Employee',
      'Present Days',
      'Late Days',
      'Late Minutes',
      'Early Out Days',
      'Early Out Minutes',
      'Absent Days',
      'Total Work Hours',
      'Overtime',
      'Salary',
      'Received',
      'Remaining',
    ];
    const lines = employeeStats.map(e =>
      [
        e.name,
        e.presentDays,
        e.lateDays,
        e.lateMinutes,
        e.earlyDays,
        e.earlyMinutes,
        e.absentDays,
        e.hours.toFixed(1),
        e.overtime.toFixed(1),
        e.salary ?? '',
        received(e) ?? '',
        remaining(e) ?? '',
      ]
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppShell title="Attendance Report">
      <div className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Employee</label>
            <div className="flex items-center gap-2">
              <div className="relative">
                <PersonIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-accent" />
                <select
                  value={employeeId}
                  onChange={e => setEmployeeId(e.target.value)}
                  className="min-w-[11rem] rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="all">All Employees</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </div>
              {employeeId !== 'all' && (
                <button onClick={() => setEmployeeId('all')} className="text-xs font-medium text-accent hover:underline">
                  Clear
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Status</label>
            <div className="relative">
              <StatusIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-accent" />
              <select
                value={status}
                onChange={e => setStatus(e.target.value as typeof status)}
                className="rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              >
                <option value="All">All Employees</option>
                <option value="Present">Present at least once</option>
                <option value="Late">Late at least once</option>
                <option value="Absent">Absent at least once</option>
              </select>
            </div>
          </div>

          <div className="hidden h-10 w-px bg-slate-200 sm:block" />

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Date Range</label>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1.5 rounded-lg bg-slate-100 p-1">
                {PRESETS.map(p => (
                  <button
                    key={p.key}
                    onClick={() => applyPreset(p)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                      activePreset === p.key ? 'bg-accent text-white shadow-sm' : 'text-slate-600 hover:bg-white'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="w-36">
                <DatePicker
                  value={from}
                  onChange={v => {
                    setFrom(v);
                    setActivePreset(null);
                  }}
                />
              </div>
              <span className="text-slate-400">–</span>
              <div className="w-36">
                <DatePicker
                  value={to}
                  onChange={v => {
                    setTo(v);
                    setActivePreset(null);
                  }}
                />
              </div>
            </div>
          </div>

          <button
            onClick={exportCsv}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-accent bg-accent/5 px-4 py-2 text-sm font-semibold text-accent shadow-sm transition-colors hover:bg-accent hover:text-white"
          >
            ⭳ Export CSV
          </button>
        </div>
      </div>

      <p className="mb-3 text-xs text-slate-500">
        {employeeStats.length} employee{employeeStats.length === 1 ? '' : 's'} · {overallTotals.hours.toFixed(1)} total hrs ·{' '}
        {overallTotals.overtime.toFixed(1)} overtime hrs · Tap a row to see its daily log
      </p>

      <div className="flex flex-col gap-3">
        {employeeStats.map(emp => {
          const open = expandedId === emp.id;
          return (
            <div key={emp.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <button
                onClick={() => setExpandedId(open ? null : emp.id)}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left"
              >
                <span className="min-w-[9rem] flex-1 truncate font-semibold text-ink">{emp.name}</span>
                {emp.pendingDays > 0 && <Badge tone="warning">Pending calc</Badge>}
                <span className="text-xs text-slate-500">
                  Salary <b className="text-ink">{emp.salary != null ? emp.salary.toLocaleString() : '—'}</b>
                </span>
                <span className="text-xs text-slate-500">
                  Received <b className="text-ink">{received(emp) != null ? received(emp)!.toLocaleString() : '—'}</b>
                </span>
                <span className="text-xs text-slate-500">
                  Remaining <b className="text-ink">{remaining(emp) != null ? remaining(emp)!.toLocaleString() : '—'}</b>
                </span>
                <Badge tone="warning">{emp.lateDays} late in ({(emp.lateMinutes / 60).toFixed(1)}h)</Badge>
                <Badge tone="critical">{emp.earlyDays} early out ({(emp.earlyMinutes / 60).toFixed(1)}h)</Badge>
                <Badge tone="good">{emp.hours.toFixed(1)} total hrs</Badge>
                {emp.overtime > 0 && <Badge tone="info">{emp.overtime.toFixed(1)} OT</Badge>}
                {emp.absentDays > 0 && <Badge tone="critical">{emp.absentDays} absent</Badge>}
                <ChevronIcon className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>

              {open && (
                <div className="overflow-x-auto border-t border-slate-100">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-4 py-2 font-medium">Date</th>
                        <th className="px-4 py-2 font-medium">Check-In</th>
                        <th className="px-4 py-2 font-medium">Check-Out</th>
                        <th className="px-4 py-2 font-medium">Late By</th>
                        <th className="px-4 py-2 font-medium">Early Out</th>
                        <th className="px-4 py-2 font-medium">Hours</th>
                        <th className="px-4 py-2 font-medium">Overtime</th>
                        <th className="px-4 py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {emp.days.map(d => (
                        <tr key={d.date} className="border-b border-slate-50 last:border-0">
                          <td className="px-4 py-2 text-slate-600">{formatAdDate(d.date, system)}</td>
                          <td className="px-4 py-2 text-slate-600">
                            {d.checkIn ? new Date(d.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–:–'}
                          </td>
                          <td className="px-4 py-2 text-slate-600">
                            {d.checkOut ? new Date(d.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–:–'}
                          </td>
                          <td className="px-4 py-2">
                            {d.lateMinutes > 0 ? <span className="font-medium text-warning-text">{d.lateMinutes} min</span> : <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-4 py-2">
                            {d.earlyMinutes > 0 ? <span className="font-medium text-warning-text">{d.earlyMinutes} min</span> : <span className="text-slate-400">—</span>}
                          </td>
                          <td className="px-4 py-2 text-slate-600">{d.pending ? 'Pending calc' : `${d.hours.toFixed(1)} hrs`}</td>
                          <td className="px-4 py-2 text-slate-600">{d.pending ? '–' : `${d.overtime.toFixed(1)} hr`}</td>
                          <td className="px-4 py-2">
                            <Badge tone={d.status === 'Present' ? 'good' : d.status === 'Late' ? 'warning' : 'critical'}>{d.status}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
        {employeeStats.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-slate-400 shadow-sm">
            No records in this range.
          </div>
        )}
      </div>
    </AppShell>
  );
}

function PersonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="12" cy="8" r="3.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 20c1.2-3.5 4-5.5 7.5-5.5s6.3 2 7.5 5.5" />
    </svg>
  );
}

function StatusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h16M4 5l7 8v6l2 1v-7l7-8" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  );
}
