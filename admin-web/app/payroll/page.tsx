'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { computeDayStatus, resolveShift } from '@/lib/shift';
import type { AttendanceLog, Employee, PayrollSummary, Shift } from '@/lib/types';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function monthBounds(year: number, month: number) {
  const d = new Date(Date.UTC(year, month, 1));
  const start = d.toISOString().slice(0, 10);
  const end = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  return { start, end };
}

function currentAnchor() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

export default function PayrollPage() {
  const { system } = useCalendarSystem();
  const [anchor, setAnchor] = useState(currentAnchor);
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [recalculating, setRecalculating] = useState(false);
  const [pendingSalary, setPendingSalary] = useState<Record<string, string>>({});
  const [savingRowId, setSavingRowId] = useState<string | null>(null);
  const [editingSalaryId, setEditingSalaryId] = useState<string | null>(null);
  // Overtime pay isn't tracked anywhere as an hourly rate — derived from the
  // monthly Salary against an assumed standard workday, both editable since
  // "8 hours" and "1.5x" are defaults, not a stored policy.
  const [otHoursPerDay, setOtHoursPerDay] = useState(8);
  const [otMultiplier, setOtMultiplier] = useState(1.5);

  const { start, end } = monthBounds(anchor.year, anchor.month);

  function stepMonth(delta: number) {
    setAnchor(a => {
      const d = new Date(a.year, a.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  const yearOptions = useMemo(() => {
    const thisYear = new Date().getFullYear();
    const years = new Set([thisYear, anchor.year]);
    for (let y = thisYear - 4; y <= thisYear + 1; y++) years.add(y);
    return Array.from(years).sort((a, b) => a - b);
  }, [anchor.year]);

  // Same data + same live-calc fallback the Attendance Report page uses
  // (payroll_summaries where the nightly job has run, computeDayStatus()
  // against raw punches where it hasn't) — so a day shows up here exactly
  // when it shows up there, with the same numbers.
  function reload() {
    supabase.from('payroll_summaries').select('*').gte('work_date', start).lte('work_date', end).then(({ data }) => setSummaries(data ?? []));
    supabase
      .from('attendance_logs')
      .select('*')
      .gte('punch_time', `${start}T00:00:00Z`)
      .lte('punch_time', `${end}T23:59:59Z`)
      .then(({ data }) => setLogs(data ?? []));
    supabase.from('shifts').select('*').then(({ data }) => setShifts(data ?? []));
    supabase.from('employees').select('*').eq('status', 'active').then(({ data }) => setEmployees(data ?? []));
  }

  useEffect(reload, [start, end]);

  async function recalculateMonth() {
    setRecalculating(true);
    const days: string[] = [];
    const cur = new Date(start + 'T00:00:00Z');
    const endDate = new Date(end + 'T00:00:00Z');
    const today = new Date().toISOString().slice(0, 10);
    while (cur.toISOString().slice(0, 10) <= end && cur <= endDate) {
      const day = cur.toISOString().slice(0, 10);
      if (day <= today) days.push(day);
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    for (const day of days) {
      await supabase.rpc('compute_payroll_summaries', { p_work_date: day });
    }
    setRecalculating(false);
    reload();
  }

  const daysInRange = useMemo(() => (new Date(end).getTime() - new Date(start).getTime()) / 86400000 + 1, [start, end]);

  const byEmployee = useMemo(() => {
    const days: string[] = [];
    const cur = new Date(start + 'T00:00:00Z');
    const endDate = new Date(end + 'T00:00:00Z');
    while (cur <= endDate) {
      days.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    const map = new Map<
      string,
      { id: string; enrollId: string; name: string; salary: number | null; days: number; hours: number; overtime: number; lateDays: number }
    >();
    for (const emp of employees) {
      map.set(emp.id, {
        id: emp.id,
        enrollId: emp.fingerprint_id ?? '—',
        name: emp.name,
        salary: emp.salary,
        days: 0,
        hours: 0,
        overtime: 0,
        lateDays: 0,
      });
    }

    for (const day of days) {
      for (const emp of employees) {
        const row = map.get(emp.id);
        if (!row) continue;
        const summary = summaries.find(s => s.employee_id === emp.id && s.work_date === day);
        if (summary) {
          row.days += 1;
          row.hours += Number(summary.total_hours);
          row.overtime += Number(summary.overtime_hours);
          if (summary.is_late) row.lateDays += 1;
          continue;
        }
        const dayLogs = logs
          .filter(l => l.employee_id === emp.id && l.punch_time.slice(0, 10) === day)
          .sort((a, b) => a.punch_time.localeCompare(b.punch_time));
        if (dayLogs.length === 0) continue;
        // Not yet processed by compute_payroll_summaries() — compute live
        // from the raw punches, same as the Attendance Report page does.
        const live = computeDayStatus(dayLogs, resolveShift(emp, shifts));
        row.days += 1;
        row.hours += live.totalMinutes / 60;
        row.overtime += live.overtimeMinutes / 60;
        if (live.isLate) row.lateDays += 1;
      }
    }
    return Array.from(map.values());
  }, [summaries, logs, shifts, employees, start, end]);

  const totals = useMemo(() => {
    const totalHours = byEmployee.reduce((s, r) => s + r.hours, 0);
    const overtimeHours = byEmployee.reduce((s, r) => s + r.overtime, 0);
    const workedDays = byEmployee.reduce((s, r) => s + r.days, 0);
    const possibleDays = employees.length * daysInRange;
    const attendancePct = possibleDays ? Math.round((workedDays / possibleDays) * 1000) / 10 : 0;
    const totalEmployeeSalary = byEmployee.reduce((s, r) => s + (r.salary ?? 0), 0);
    const totalSalaryPayable = byEmployee.reduce(
      (s, r) => (r.salary == null ? s : s + Math.round((r.salary / daysInRange) * r.days)),
      0
    );
    const totalOvertimeSalary = byEmployee.reduce((s, r) => {
      if (r.salary == null || r.overtime <= 0) return s;
      const hourlyRate = r.salary / (daysInRange * otHoursPerDay);
      return s + hourlyRate * otMultiplier * r.overtime;
    }, 0);
    return { totalHours, overtimeHours, attendancePct, totalEmployeeSalary, totalSalaryPayable, totalOvertimeSalary };
  }, [byEmployee, employees, daysInRange, otHoursPerDay, otMultiplier]);

  function calculatedSalary(row: { salary: number | null; days: number }): number | null {
    if (row.salary == null) return null;
    return Math.round((row.salary / daysInRange) * row.days);
  }

  async function applySalaryChange(employeeId: string, salary: string) {
    const { error } = await supabase.from('employees').update({ salary: salary ? Number(salary) : null }).eq('id', employeeId);
    return error;
  }

  // Each row saves/cancels on its own — no single bulk "save everything"
  // button, so one row's edit can't accidentally carry another row's
  // half-finished edit along with it.
  function hasPendingSalaryChange(row: { id: string; salary: number | null }): boolean {
    const draft = pendingSalary[row.id];
    if (draft === undefined) return false;
    return draft !== (row.salary != null ? String(row.salary) : '');
  }

  async function saveSalaryRow(employeeId: string) {
    const draft = pendingSalary[employeeId];
    if (draft === undefined) return;
    setSavingRowId(employeeId);
    const error = await applySalaryChange(employeeId, draft);
    setSavingRowId(null);
    if (error) {
      alert(`Could not save: ${error.message}`);
      return;
    }
    setPendingSalary(p => {
      const next = { ...p };
      delete next[employeeId];
      return next;
    });
    setEditingSalaryId(null);
    reload();
  }

  function cancelSalaryRow(employeeId: string) {
    setPendingSalary(p => {
      const next = { ...p };
      delete next[employeeId];
      return next;
    });
    setEditingSalaryId(null);
  }

  const employeeName = (id: string) => employees.find(e => e.id === id)?.name ?? 'Unknown';
  const pendingOvertime = useMemo(
    () => summaries.filter(s => Number(s.overtime_hours) > 0 && !s.overtime_approved).sort((a, b) => a.work_date.localeCompare(b.work_date)),
    [summaries]
  );

  async function approveOvertime(id: string) {
    await supabase.from('payroll_summaries').update({ overtime_approved: true }).eq('id', id);
    reload();
  }

  return (
    <AppShell title="Attendance-based Payroll Controller">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => stepMonth(-1)} className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50">←</button>
          <span className="font-semibold text-ink">
            {formatAdDate(start, system)} – {formatAdDate(end, system)}
          </span>
          <button onClick={() => stepMonth(1)} className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:bg-slate-50">→</button>
          <select
            value={anchor.month}
            onChange={e => setAnchor(a => ({ ...a, month: Number(e.target.value) }))}
            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-600"
          >
            {MONTH_NAMES.map((name, i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={anchor.year}
            onChange={e => setAnchor(a => ({ ...a, year: Number(e.target.value) }))}
            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-600"
          >
            {yearOptions.map(y => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={recalculateMonth}
          disabled={recalculating}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
        >
          {recalculating ? 'Recalculating…' : 'Recalculate month'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <span className="text-xs text-slate-500">Overtime Salary</span>
          <div className="mt-1 text-base font-bold text-ink">
            {totals.totalOvertimeSalary.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </div>
          <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
            <input
              type="number"
              min="0"
              step="0.5"
              value={otHoursPerDay}
              onChange={e => setOtHoursPerDay(Number(e.target.value) || 0)}
              title="Standard hours per day"
              className="w-10 rounded border border-slate-200 px-1 py-0.5 text-center"
            />
            h/day ×
            <input
              type="number"
              min="0"
              step="0.1"
              value={otMultiplier}
              onChange={e => setOtMultiplier(Number(e.target.value) || 0)}
              title="Overtime rate multiplier"
              className="w-10 rounded border border-slate-200 px-1 py-0.5 text-center"
            />
            x
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <span className="text-xs text-slate-500">Total Salary Payable</span>
          <div className="mt-1 text-base font-bold text-ink">{totals.totalSalaryPayable.toLocaleString()}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">Earned so far this period</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <span className="text-xs text-slate-500">Total Employees Salary</span>
          <div className="mt-1 text-base font-bold text-ink">{totals.totalEmployeeSalary.toLocaleString()}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">Full monthly salary, all staff</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <span className="text-xs text-slate-500">Overtime Tracked</span>
          <div className="mt-1 text-base font-bold text-ink">{totals.overtimeHours.toFixed(1)} hrs</div>
          <div className="mt-0.5 text-[11px] text-slate-500">This period</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <span className="text-xs text-slate-500">Total Payable Hours</span>
          <div className="mt-1 text-base font-bold text-ink">{totals.totalHours.toFixed(1)} hrs</div>
          <div className="mt-0.5 text-[11px] text-slate-500">Across {employees.length} staff</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <span className="text-xs text-slate-500">Average Attendance</span>
          <div className="mt-1 text-base font-bold text-ink">{totals.attendancePct}%</div>
          <div className="mt-0.5 text-[11px] text-slate-500">Worked days vs possible</div>
        </div>
      </div>

      {pendingOvertime.length > 0 && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-ink">Overtime awaiting approval</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 font-medium">Employee</th>
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 font-medium">Overtime</th>
                  <th className="py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {pendingOvertime.map(s => (
                  <tr key={s.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2.5 font-medium text-ink">{employeeName(s.employee_id)}</td>
                    <td className="py-2.5 text-slate-600">{formatAdDate(s.work_date, system)}</td>
                    <td className="py-2.5 text-slate-600">{Number(s.overtime_hours).toFixed(1)} hrs</td>
                    <td className="py-2.5">
                      <button
                        onClick={() => approveOvertime(s.id)}
                        className="rounded-md bg-good px-3 py-1 text-xs font-semibold text-white hover:bg-good/90"
                      >
                        Approve
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-ink">This Month Salary Report</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 font-medium">ID</th>
              <th className="py-2 font-medium">Employee</th>
              <th className="py-2 font-medium">Worked Days</th>
              <th className="py-2 font-medium">Total Hours</th>
              <th className="py-2 font-medium">Overtime</th>
              <th className="py-2 font-medium">Late Days</th>
              <th className="py-2 font-medium">Salary</th>
              <th className="py-2 font-medium">Calculated Salary</th>
            </tr>
          </thead>
          <tbody>
            {byEmployee.map(row => (
              <tr key={row.id} className="border-b border-slate-100 last:border-0">
                <td className="py-2.5 text-slate-600">{row.enrollId}</td>
                <td className="py-2.5 font-medium text-ink">{row.name}</td>
                <td className="py-2.5 text-slate-600">{row.days}</td>
                <td className="py-2.5 text-slate-600">{row.hours.toFixed(1)} hrs</td>
                <td className="py-2.5 text-slate-600">{row.overtime.toFixed(1)} hrs</td>
                <td className="py-2.5 text-slate-600">{row.lateDays}</td>
                <td className="py-2.5">
                  {editingSalaryId === row.id ? (
                    <>
                      <input
                        autoFocus
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="—"
                        value={pendingSalary[row.id] ?? (row.salary != null ? String(row.salary) : '')}
                        onChange={e => setPendingSalary(p => ({ ...p, [row.id]: e.target.value }))}
                        className="w-28 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600"
                      />
                      {hasPendingSalaryChange(row) && (
                        <div className="mt-1 flex gap-2">
                          <button
                            onClick={() => cancelSalaryRow(row.id)}
                            disabled={savingRowId === row.id}
                            className="text-xs font-medium text-slate-500 hover:underline disabled:opacity-60"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => saveSalaryRow(row.id)}
                            disabled={savingRowId === row.id}
                            className="text-xs font-semibold text-accent hover:underline disabled:opacity-60"
                          >
                            {savingRowId === row.id ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-ink">{row.salary != null ? row.salary.toLocaleString() : '—'}</span>
                      <button
                        onClick={() => setEditingSalaryId(row.id)}
                        title="Edit salary"
                        className="text-slate-400 hover:text-accent"
                      >
                        <EditIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </td>
                <td className="py-2.5 text-slate-600">
                  {calculatedSalary(row) != null ? calculatedSalary(row)!.toLocaleString() : '—'}
                </td>
              </tr>
            ))}
            {byEmployee.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-400">No active employees.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
