'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import AppShell from '@/components/AppShell';
import Badge from '@/components/Badge';
import {
  buildPeriodOptions,
  currentSystemYearMonth,
  formatAdDate,
  formatDdMmYyyy,
  systemPeriod,
  type CalendarPeriod,
} from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import { computeDayStatus, formatMinutes, resolveShift } from '@/lib/shift';
import type { AttendanceLog, Employee, PayrollSummary, Shift } from '@/lib/types';

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

type DayDetail = {
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

export default function PayrollPage() {
  const { system } = useCalendarSystem();
  const [period, setPeriod] = useState<CalendarPeriod>(() => {
    const { year, month } = currentSystemYearMonth(system);
    return systemPeriod(system, year, month);
  });
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
  const [dataRange, setDataRange] = useState<{ earliest: Date; latest: Date } | null>(null);
  // Overtime pay is optional per employee (some employees just aren't paid
  // extra for it) — on by default, toggled off per row.
  const [overtimeEnabled, setOvertimeEnabled] = useState<Record<string, boolean>>({});
  // Which employee's day-1-to-day-31 breakdown is open in the detail modal.
  const [detailEmployeeId, setDetailEmployeeId] = useState<string | null>(null);

  const { start, end } = period;

  // The oldest/newest punch on record — bounds the period dropdown to
  // months that actually have data instead of listing years of empty ones.
  useEffect(() => {
    Promise.all([
      supabase.from('attendance_logs').select('punch_time').order('punch_time', { ascending: true }).limit(1),
      supabase.from('attendance_logs').select('punch_time').order('punch_time', { ascending: false }).limit(1),
    ]).then(([earliestRes, latestRes]) => {
      const earliest = earliestRes.data?.[0]?.punch_time;
      const latest = latestRes.data?.[0]?.punch_time;
      if (!earliest || !latest) {
        setDataRange(null);
        return;
      }
      setDataRange({ earliest: new Date(earliest), latest: new Date(latest) });
    });
  }, []);

  // Picking a period is switching to whichever calendar's real months — BS
  // Shrawan, Bhadra, ... in BS mode, AD January, February, ... in AD mode —
  // each option's start/end is that month's own true day-1-to-last-day span
  // (see Period/monthDateRange), never an AD month wearing a BS label.
  // Toggling AD/BS resets to "this month" in the newly active system, since
  // the previously selected month rarely has an equivalent boundary in the
  // other system.
  useEffect(() => {
    const { year, month } = currentSystemYearMonth(system);
    setPeriod(systemPeriod(system, year, month));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system]);

  // One flat list of every period this dropdown can jump to, instead of a
  // separate Month select + Year select — picking a period is then one
  // selection instead of two. Bounded to where actual data exists (capped
  // to a max of 12 months back even if data goes further), but "now" is
  // always included so you can jump to the current month before any of its
  // data exists yet.
  const periodOptions = useMemo(() => buildPeriodOptions(system, dataRange, period), [system, dataRange, period]);

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
    if (days.length === 0) {
      setRecalculating(false);
      alert('Nothing to recalculate — this period has no days up to today yet.');
      return;
    }
    // rpc() never throws, it resolves { error } — the old version didn't
    // check that, so a failing call (e.g. not signed in as admin/HR) just
    // silently did nothing and the button looked broken.
    const failedDays: string[] = [];
    for (const day of days) {
      const { error } = await supabase.rpc('compute_payroll_summaries', { p_work_date: day });
      if (error) failedDays.push(day);
    }
    setRecalculating(false);
    if (failedDays.length > 0) {
      alert(`Recalculated ${days.length - failedDays.length}/${days.length} days. Failed: ${failedDays.join(', ')}`);
    } else {
      alert(`Recalculated ${days.length} day${days.length === 1 ? '' : 's'}.`);
    }
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

  // Day 1 through the period's last day for one employee — the detail
  // modal's content. Same summary/live-compute-from-punches fallback as
  // byEmployee above and the Attendance Report page, just per-day instead
  // of aggregated, and only computed for whichever employee's modal is open.
  function employeeDayRows(employeeId: string): DayDetail[] {
    const emp = employees.find(e => e.id === employeeId);
    if (!emp) return [];
    const shift = resolveShift(emp, shifts);
    const days: string[] = [];
    const cur = new Date(start + 'T00:00:00Z');
    const endDate = new Date(end + 'T00:00:00Z');
    while (cur <= endDate) {
      days.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    return days.map(day => {
      const summary = summaries.find(s => s.employee_id === employeeId && s.work_date === day);
      if (summary) {
        return {
          date: day,
          checkIn: summary.check_in,
          checkOut: summary.check_out,
          hours: Number(summary.total_hours),
          overtime: Number(summary.overtime_hours),
          lateMinutes: summary.is_late ? summary.late_minutes : 0,
          earlyMinutes: summary.is_early_departure ? summary.early_departure_minutes : 0,
          status: summary.is_late ? 'Late' : 'Present',
        };
      }
      const dayLogs = logs
        .filter(l => l.employee_id === employeeId && l.punch_time.slice(0, 10) === day)
        .sort((a, b) => a.punch_time.localeCompare(b.punch_time));
      if (dayLogs.length === 0) {
        return { date: day, checkIn: null, checkOut: null, hours: 0, overtime: 0, lateMinutes: 0, earlyMinutes: 0, status: 'Absent' };
      }
      const live = computeDayStatus(dayLogs, shift);
      return {
        date: day,
        checkIn: live.checkIn.punch_time,
        checkOut: live.checkOut?.punch_time ?? null,
        hours: live.totalMinutes / 60,
        overtime: live.overtimeMinutes / 60,
        lateMinutes: live.lateMinutes,
        earlyMinutes: live.earlyMinutes,
        status: live.isLate ? 'Late' : 'Present',
        pending: true,
      };
    });
  }

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
      if (r.salary == null || r.overtime <= 0 || !(overtimeEnabled[r.id] ?? true)) return s;
      const hourlyRate = r.salary / (daysInRange * otHoursPerDay);
      return s + hourlyRate * otMultiplier * r.overtime;
    }, 0);
    return { totalHours, overtimeHours, attendancePct, totalEmployeeSalary, totalSalaryPayable, totalOvertimeSalary };
  }, [byEmployee, employees, daysInRange, otHoursPerDay, otMultiplier, overtimeEnabled]);

  function calculatedSalary(row: { salary: number | null; days: number }): number | null {
    if (row.salary == null) return null;
    return Math.round((row.salary / daysInRange) * row.days);
  }

  function overtimeSalary(row: { id: string; salary: number | null; overtime: number }): number | null {
    if (row.salary == null) return null;
    if (row.overtime <= 0 || !(overtimeEnabled[row.id] ?? true)) return 0;
    const hourlyRate = row.salary / (daysInRange * otHoursPerDay);
    return Math.round(hourlyRate * otMultiplier * row.overtime);
  }

  function totalSalary(row: { id: string; salary: number | null; days: number; overtime: number }): number | null {
    const calculated = calculatedSalary(row);
    if (calculated == null) return null;
    return calculated + (overtimeSalary(row) ?? 0);
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

  // Plain functions returning JSX (not components) so the same edit-in-place
  // markup can be reused by both the desktop table and the mobile card list
  // below without wrapping it in a nested component — a nested component
  // would get a fresh identity every render and remount (losing focus on
  // the salary input while typing).
  function salaryCellContent(row: (typeof byEmployee)[number]) {
    return editingSalaryId === row.id ? (
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
        <button onClick={() => setEditingSalaryId(row.id)} title="Edit salary" className="text-slate-400 hover:text-accent">
          <EditIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  function overtimeCellContent(row: (typeof byEmployee)[number]) {
    const otOn = overtimeEnabled[row.id] ?? true;
    return (
      <div className="flex items-center justify-start gap-3">
        <button
          type="button"
          onClick={() => setOvertimeEnabled(m => ({ ...m, [row.id]: !otOn }))}
          title={otOn ? 'Overtime pay counted for this employee' : 'Overtime pay not counted for this employee'}
          className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${otOn ? 'bg-good' : 'bg-slate-300'}`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              otOn ? 'translate-x-[18px]' : 'translate-x-0.5'
            }`}
          />
        </button>
        <span className={`tabular-nums ${otOn ? 'text-ink' : 'text-slate-400'}`}>
          {overtimeSalary(row) != null ? overtimeSalary(row)!.toLocaleString() : '—'}
        </span>
      </div>
    );
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

  const detailEmployee = detailEmployeeId ? employees.find(e => e.id === detailEmployeeId) ?? null : null;
  const detailRow = detailEmployeeId ? byEmployee.find(r => r.id === detailEmployeeId) ?? null : null;
  const detailRows = detailEmployee ? employeeDayRows(detailEmployee.id) : [];
  const detailOtOn = detailEmployeeId ? overtimeEnabled[detailEmployeeId] ?? true : true;
  // Each worked day's slice of the monthly Salary — same proration
  // calculatedSalary()/overtimeSalary() use for the whole period, just for
  // one day, so the per-day figures always add up to the row's totals.
  const detailHourlyRate = detailEmployee?.salary != null ? detailEmployee.salary / (daysInRange * otHoursPerDay) : null;
  function dailySalaryEarning(d: DayDetail) {
    if (detailEmployee?.salary == null) return null;
    const base = d.status === 'Absent' ? 0 : detailEmployee.salary / daysInRange;
    const overtime = detailOtOn && d.overtime > 0 && detailHourlyRate != null ? detailHourlyRate * otMultiplier * d.overtime : 0;
    return { base, overtime, total: base + overtime };
  }

  return (
    <AppShell title="Attendance-based Payroll Controller">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <select
            value={period.key}
            onChange={e => {
              const found = periodOptions.find(o => o.key === e.target.value);
              if (found) setPeriod(found);
            }}
            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-600"
          >
            {periodOptions.map(o => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
            <CalendarIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
            {formatDdMmYyyy(start, system)} to {formatDdMmYyyy(end, system)}
            <span className="text-slate-400">({daysInRange}d)</span>
          </div>
        </div>
        <button
          onClick={recalculateMonth}
          disabled={recalculating}
          className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60 sm:w-auto"
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
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <h2 className="mb-2 text-base font-semibold text-ink sm:mb-4">Overtime awaiting approval</h2>
          <div className="divide-y divide-slate-100 md:hidden">
            {pendingOvertime.map(s => (
              <div key={s.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{employeeName(s.employee_id)}</div>
                  <div className="text-xs text-slate-500">
                    {formatAdDate(s.work_date, system)} · {Number(s.overtime_hours).toFixed(1)} hrs
                  </div>
                </div>
                <button
                  onClick={() => approveOvertime(s.id)}
                  className="shrink-0 rounded-md bg-good px-3 py-1.5 text-xs font-semibold text-white hover:bg-good/90"
                >
                  Approve
                </button>
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
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

      <div className="mt-6 rounded-xl border border-slate-200 bg-white pb-2 shadow-sm">
        <h2 className="px-4 pt-4 text-base font-semibold text-ink sm:px-6 sm:pt-6">This Month Salary Report</h2>

        {/* Phones get one card per employee — the 10-column table below
            would otherwise need horizontal scrolling to read anything. */}
        <div className="mt-3 divide-y divide-slate-100 md:hidden">
          {byEmployee.map(row => (
            <div key={row.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <button
                    onClick={() => setDetailEmployeeId(row.id)}
                    className="truncate font-medium text-ink hover:text-accent hover:underline"
                  >
                    {row.name}
                  </button>
                  <div className="text-xs text-slate-500">
                    ID {row.enrollId} · {row.days} days · {row.lateDays} late
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[11px] uppercase tracking-wide text-slate-400">Total Salary</div>
                  <div className="text-base font-bold text-ink">
                    {totalSalary(row) != null ? totalSalary(row)!.toLocaleString() : '—'}
                  </div>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 text-sm">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-slate-400">Total Hours</dt>
                  <dd className="text-ink">{row.hours.toFixed(1)} hrs</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-slate-400">Overtime</dt>
                  <dd className="text-ink">{row.overtime.toFixed(1)} hrs</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-slate-400">Salary</dt>
                  <dd>{salaryCellContent(row)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-slate-400">Calculated Salary</dt>
                  <dd className="text-ink">{calculatedSalary(row) != null ? calculatedSalary(row)!.toLocaleString() : '—'}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[11px] uppercase tracking-wide text-slate-400">Overtime Salary</dt>
                  <dd className="mt-1">{overtimeCellContent(row)}</dd>
                </div>
              </dl>
            </div>
          ))}
          {byEmployee.length === 0 && <p className="p-8 text-center text-sm text-slate-400">No active employees.</p>}
        </div>

        <div className="mt-4 hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-y border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 font-medium">Employee</th>
              <th className="px-4 py-3 font-medium">Worked Days</th>
              <th className="px-4 py-3 font-medium">Total Hours</th>
              <th className="px-4 py-3 font-medium">Overtime</th>
              <th className="px-4 py-3 font-medium">Late Days</th>
              <th className="px-4 py-3 font-medium">Salary</th>
              <th className="px-4 py-3 font-medium">Calculated Salary</th>
              <th className="pl-2 pr-4 py-3 font-medium">Overtime Salary</th>
              <th className="px-4 py-3 font-medium">Total Salary</th>
            </tr>
          </thead>
          <tbody>
            {byEmployee.map(row => (
              <tr key={row.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3 text-slate-600">{row.enrollId}</td>
                <td className="px-4 py-3 font-medium text-ink">
                  <button onClick={() => setDetailEmployeeId(row.id)} className="hover:text-accent hover:underline">
                    {row.name}
                  </button>
                </td>
                <td className="px-4 py-3 text-slate-600">{row.days}</td>
                <td className="px-4 py-3 text-slate-600">{row.hours.toFixed(1)} hrs</td>
                <td className="px-4 py-3 text-slate-600">{row.overtime.toFixed(1)} hrs</td>
                <td className="px-4 py-3 text-slate-600">{row.lateDays}</td>
                <td className="px-4 py-3">{salaryCellContent(row)}</td>
                <td className="px-4 py-3 text-slate-600">
                  {calculatedSalary(row) != null ? calculatedSalary(row)!.toLocaleString() : '—'}
                </td>
                <td className="pl-2 pr-4 py-3 text-slate-600">{overtimeCellContent(row)}</td>
                <td className="px-4 py-3 font-medium text-ink">
                  {totalSalary(row) != null ? totalSalary(row)!.toLocaleString() : '—'}
                </td>
              </tr>
            ))}
            {byEmployee.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-slate-400">No active employees.</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {detailEmployee && (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setDetailEmployeeId(null)}
        >
          <div
            className="flex w-full min-w-0 max-w-4xl max-h-[85vh] flex-col rounded-xl bg-white shadow-lg"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4 sm:p-6">
              <div>
                <h3 className="text-lg font-semibold text-ink">{detailEmployee.name}</h3>
                <p className="text-xs text-slate-500">
                  ID {detailEmployee.fingerprint_id ?? '—'} · {formatDdMmYyyy(start, system)} to {formatDdMmYyyy(end, system)} (
                  {daysInRange}d)
                </p>
              </div>
              <button
                onClick={() => setDetailEmployeeId(null)}
                aria-label="Close"
                className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 min-w-0 flex-1">
              {/* Phones: same card list as before, its own vertical-only
                  scroll. Desktop: the table gets ONE bounded scroll region
                  (both axes together, sized to the visible modal body) —
                  nesting a y-scroll outside an x-scroll instead put the
                  horizontal scrollbar at the bottom of all 31 rows, so the
                  Overtime/Total Salary columns were unreachable without
                  scrolling all the way down first. */}
              <div className="h-full overflow-y-auto p-4 md:hidden">
                {detailRows.map(d => {
                  const earning = dailySalaryEarning(d);
                  return (
                    <div key={d.date} className="border-b border-slate-100 py-2.5 last:border-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-ink">{formatAdDate(d.date, system)}</span>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Badge tone={d.status === 'Present' ? 'good' : d.status === 'Late' ? 'warning' : 'critical'}>{d.status}</Badge>
                          {d.status !== 'Present' && d.checkIn && d.checkOut && <Badge tone="good">Present</Badge>}
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>
                          {d.checkIn ? fmtTime(d.checkIn) : '–:–'} – {d.checkOut ? fmtTime(d.checkOut) : '–:–'}
                        </span>
                        <span>
                          {d.hours.toFixed(1)}h{d.pending && ' (live)'}
                        </span>
                        {d.overtime > 0 && <span className="font-medium text-info-text">OT {d.overtime.toFixed(1)}h</span>}
                        {d.lateMinutes > 0 && <span className="font-medium text-warning-text">Late {formatMinutes(d.lateMinutes)}</span>}
                        {d.earlyMinutes > 0 && <span className="font-medium text-warning-text">Early {formatMinutes(d.earlyMinutes)}</span>}
                      </div>
                      {earning && (
                        <div className="mt-1.5 flex items-center justify-between text-xs">
                          <span className="text-slate-400">
                            Salary {Math.round(earning.base).toLocaleString()}
                            {earning.overtime > 0 && ` + OT ${Math.round(earning.overtime).toLocaleString()}`}
                          </span>
                          <span className="font-semibold text-ink">{Math.round(earning.total).toLocaleString()}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
                {detailRows.length === 0 && <p className="py-8 text-center text-sm text-slate-400">No days in this period.</p>}
              </div>

              <div className="hidden h-full overflow-auto md:block">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <th className="whitespace-nowrap px-4 py-2.5 font-medium">Date</th>
                      <th className="whitespace-nowrap px-4 py-2.5 font-medium">Check-In</th>
                      <th className="whitespace-nowrap px-4 py-2.5 font-medium">Check-Out</th>
                      <th className="whitespace-nowrap px-4 py-2.5 font-medium">Total Hours</th>
                      <th className="whitespace-nowrap px-4 py-2.5 font-medium">Overtime</th>
                      <th className="whitespace-nowrap px-4 py-2.5 font-medium">Late By</th>
                      <th className="whitespace-nowrap px-4 py-2.5 font-medium">Status</th>
                      <th className="whitespace-nowrap px-4 py-2.5 font-medium">Calculated Salary</th>
                      <th className="whitespace-nowrap px-4 py-2.5 font-medium">Overtime Salary</th>
                      <th className="whitespace-nowrap px-4 py-2.5 font-medium">Total Salary</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailRows.map(d => {
                      const earning = dailySalaryEarning(d);
                      return (
                        <tr key={d.date} className="border-b border-slate-100 last:border-0">
                          <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">{formatAdDate(d.date, system)}</td>
                          <td className="px-4 py-2.5 text-slate-600">{d.checkIn ? fmtTime(d.checkIn) : '–:–'}</td>
                          <td className="px-4 py-2.5 text-slate-600">{d.checkOut ? fmtTime(d.checkOut) : '–:–'}</td>
                          <td className="px-4 py-2.5 text-slate-600">
                            {d.hours.toFixed(1)} hrs{d.pending && <span className="ml-1 text-[10px] text-slate-400">(live)</span>}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">{d.overtime.toFixed(1)} hrs</td>
                          <td className="px-4 py-2.5">
                            {d.lateMinutes > 0 ? (
                              <span className="font-medium text-warning-text">{formatMinutes(d.lateMinutes)}</span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-wrap gap-1.5">
                              <Badge tone={d.status === 'Present' ? 'good' : d.status === 'Late' ? 'warning' : 'critical'}>{d.status}</Badge>
                              {d.status !== 'Present' && d.checkIn && d.checkOut && <Badge tone="good">Present</Badge>}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">{earning ? Math.round(earning.base).toLocaleString() : '—'}</td>
                          <td className="px-4 py-2.5 text-slate-600">
                            {earning ? Math.round(earning.overtime).toLocaleString() : '—'}
                          </td>
                          <td className="px-4 py-2.5 font-medium text-ink">
                            {earning ? Math.round(earning.total).toLocaleString() : '—'}
                          </td>
                        </tr>
                      );
                    })}
                    {detailRows.length === 0 && (
                      <tr>
                        <td colSpan={10} className="px-4 py-8 text-center text-slate-400">
                          No days in this period.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {detailRow && (
              <div className="border-t border-slate-200 bg-slate-50 p-4 sm:p-6">
                <div className="grid grid-cols-3 gap-3 text-center sm:grid-cols-6">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">Days</div>
                    <div className="text-sm font-semibold text-ink">{detailRow.days}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">Hours</div>
                    <div className="text-sm font-semibold text-ink">{detailRow.hours.toFixed(1)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">Overtime</div>
                    <div className="text-sm font-semibold text-ink">{detailRow.overtime.toFixed(1)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">Salary</div>
                    <div className="text-sm font-semibold text-ink">
                      {calculatedSalary(detailRow) != null ? calculatedSalary(detailRow)!.toLocaleString() : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">OT Salary</div>
                    <div className="text-sm font-semibold text-ink">
                      {overtimeSalary(detailRow) != null ? overtimeSalary(detailRow)!.toLocaleString() : '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">Total</div>
                    <div className="text-base font-bold text-accent">
                      {totalSalary(detailRow) != null ? totalSalary(detailRow)!.toLocaleString() : '—'}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
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

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
