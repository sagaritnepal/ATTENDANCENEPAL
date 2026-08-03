'use client';

import { useEffect, useMemo, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import DatePicker from '@/components/DatePicker';
import type { AttendanceLog, Employee, PayrollSummary } from '@/lib/types';

type EmployeeStat = {
  id: string;
  name: string;
  salary: number | null;
  presentDays: number;
  pendingDays: number;
  lateDays: number;
  earlyDays: number;
  absentDays: number;
  hours: number;
  overtime: number;
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

  // One aggregated stat per employee across the selected date range — this
  // is what payroll's own "Roster hours breakdown" computes too (same
  // payroll_summaries source), so Salary/Received here always agrees with
  // what the Payroll page calculates.
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
        earlyDays: 0,
        absentDays: 0,
        hours: 0,
        overtime: 0,
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
          if (summary.is_late) row.lateDays += 1;
          if (summary.is_early_departure) row.earlyDays += 1;
        } else {
          const hasLogs = logs.some(l => l.employee_id === emp.id && l.punch_time.slice(0, 10) === day);
          if (hasLogs) {
            // Not yet processed by compute_payroll_summaries() (runs
            // nightly, or manually via "Recalculate month" on Payroll) —
            // count as present so today's punch isn't shown as an absence,
            // but exclude from hours/late/early until that recompute runs.
            row.presentDays += 1;
            row.pendingDays += 1;
          } else {
            row.absentDays += 1;
          }
        }
      }
    }

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
      'Early Out Days',
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
        e.earlyDays,
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
        {overallTotals.overtime.toFixed(1)} overtime hrs
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {employeeStats.map(emp => (
          <div key={emp.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="truncate font-semibold text-ink">{emp.name}</span>
              {emp.pendingDays > 0 && <Badge tone="warning">Pending calc</Badge>}
            </div>

            <div className="mb-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-good-bg p-2">
                <div className="text-[10px] font-medium uppercase text-good-text">Salary</div>
                <div className="text-sm font-bold text-ink">{emp.salary != null ? emp.salary.toLocaleString() : '—'}</div>
              </div>
              <div className="rounded-lg bg-info-bg p-2">
                <div className="text-[10px] font-medium uppercase text-info-text">Received</div>
                <div className="text-sm font-bold text-ink">{received(emp) != null ? received(emp)!.toLocaleString() : '—'}</div>
              </div>
              <div className="rounded-lg bg-warning-bg p-2">
                <div className="text-[10px] font-medium uppercase text-warning-text">Remaining</div>
                <div className="text-sm font-bold text-ink">{remaining(emp) != null ? remaining(emp)!.toLocaleString() : '—'}</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <Badge tone="good">{emp.presentDays} present</Badge>
              {emp.lateDays > 0 && <Badge tone="warning">{emp.lateDays} late</Badge>}
              {emp.earlyDays > 0 && <Badge tone="critical">{emp.earlyDays} early out</Badge>}
              {emp.absentDays > 0 && <Badge tone="critical">{emp.absentDays} absent</Badge>}
              <Badge tone="info">{emp.hours.toFixed(1)} hrs</Badge>
              {emp.overtime > 0 && <Badge tone="info">{emp.overtime.toFixed(1)} OT</Badge>}
            </div>
          </div>
        ))}
        {employeeStats.length === 0 && (
          <div className="col-span-full rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-slate-400 shadow-sm">
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
