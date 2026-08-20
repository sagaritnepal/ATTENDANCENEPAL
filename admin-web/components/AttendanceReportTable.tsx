'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Badge from '@/components/Badge';
import DateRangePicker from '@/components/DateRangePicker';
import TableExportBar, { downloadExcelWorkbook } from '@/components/TableExportBar';
import { formatAdDate } from '@/lib/calendar';
import { useCalendarSystem } from '@/lib/calendarSystem';
import {
  applyOvernightShiftCorrection,
  buildWeeklyPatternByEmployee,
  computeDayStatusForResolvedShift,
  formatHoursMinutes,
  isWeekOff,
  nepalTodayIso,
  resolveShiftForDate,
  shiftDurationHours,
  type DailyShiftByDate,
} from '@/lib/shift';
import { fetchMyCompanyWeekOffConfig, leaveDatesByEmployee, weekOffDatesInRange } from '@/lib/weekOff';
import type { AttendanceLog, CompanyHoliday, Device, Employee, LeaveRequest, PayrollSummary, Shift } from '@/lib/types';

type Row = {
  key: string;
  date: string;
  employeeId: string;
  enrollId: string;
  employeeName: string;
  device: string;
  shiftLabel: string;
  /** Hours the resolved shift actually spans (0 for Week Off) — used to
   * total up "expected hours" per employee for the Hours Summary export,
   * independent of whether they actually showed up that day. */
  shiftHours: number;
  checkIn: string | null;
  checkOut: string | null;
  hours: number;
  status: 'Present' | 'Late' | 'Absent' | 'Upcoming' | 'Week Off' | 'Leave' | 'Exempt';
  lateMinutes: number;
  earlyMinutes: number;
  overtime: number;
  /** No payroll_summaries row yet (only computed by the nightly job or
   * "Recalculate month" on the Payroll page) — late/early/hours/overtime
   * here are computed live client-side from the raw punches (same math,
   * see lib/shift.ts) rather than left blank until that job runs. */
  pending?: boolean;
};

/** Compact per-cell code for the Attendance matrix (employees as rows, dates
 * as columns) — '' means Upcoming, rendered as a blank cell since the day
 * simply hasn't happened yet, not a status worth a code of its own. */
type StatusCode = 'P' | 'LT' | 'A' | 'WO' | 'L' | 'EX' | '';
const STATUS_CODE: Record<Row['status'], StatusCode> = {
  Present: 'P',
  Late: 'LT',
  Absent: 'A',
  'Week Off': 'WO',
  Leave: 'L',
  Exempt: 'EX',
  Upcoming: '',
};
const STATUS_CODE_LABEL: Record<StatusCode, string> = {
  P: 'Present',
  LT: 'Late',
  A: 'Absent',
  WO: 'Week Off',
  L: 'Leave',
  EX: 'Exempt',
  '': '',
};

type MatrixEmployeeRow = {
  employeeId: string;
  enrollId: string;
  employeeName: string;
  cellsByDate: Map<string, StatusCode>;
  counts: Record<Exclude<StatusCode, ''>, number>;
};

type HoursSummaryRow = {
  employeeId: string;
  enrollId: string;
  employeeName: string;
  /** Present + Late days — days they actually punched. */
  daysWorked: number;
  /** Present + Late + Absent — days they were actually expected to work,
   * excluding Week Off/Leave and an exempt employee's unpunched days. */
  workingDays: number;
  hoursWorked: number;
  expectedHours: number;
  overtimeHours: number;
};

/** Decimal hours -> "Xh Ym". */
function fmtHrs(hours: number) {
  return formatHoursMinutes(Math.round(hours * 60));
}

function isoDaysAgo(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function statusBadge(r: Row) {
  if (r.checkIn) return <Badge tone="good">Present</Badge>;
  if (r.status === 'Week Off') return <Badge tone="neutral">Week Off</Badge>;
  if (r.status === 'Leave') return <Badge tone="info">Leave</Badge>;
  if (r.status === 'Upcoming') return <Badge tone="neutral">Upcoming</Badge>;
  if (r.status === 'Exempt') return <Badge tone="neutral">Excused</Badge>;
  return <Badge tone="critical">Absent</Badge>;
}

export default function AttendanceReportTable({ initialEmployeeId }: { initialEmployeeId?: string | null }) {
  const { system } = useCalendarSystem();
  const [from, setFrom] = useState(isoDaysAgo(0));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [status, setStatus] = useState<'All' | 'Present' | 'Late' | 'Early' | 'Absent' | 'Week Off' | 'Leave' | 'Exempt'>('All');
  const [employeeId, setEmployeeId] = useState<string>(initialEmployeeId ?? 'all');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [dailyShiftRows, setDailyShiftRows] = useState<{ employee_id: string; work_date: string; shift_id: string | null }[]>([]);
  const [weeklyOffDay, setWeeklyOffDay] = useState<number | null>(null);
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [weeklyPatternRows, setWeeklyPatternRows] = useState<{ employee_id: string; weekday: number; shift_id: string | null }[]>([]);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('employees').select('*').eq('status', 'active').order('name').then(({ data }) => setEmployees(data ?? []));
    supabase.from('shifts').select('*').then(({ data }) => setShifts(data ?? []));
    supabase.from('devices').select('*').then(({ data }) => setDevices(data ?? []));
    fetchMyCompanyWeekOffConfig().then(({ companyName, weeklyOffDay, rosterMode }) => {
      setCompanyName(companyName);
      setWeeklyOffDay(weeklyOffDay);
      // Not date-scoped (a pattern applies to every week), and only ever
      // relevant in 'weekly' roster_mode — see resolveShiftForDate().
      if (rosterMode === 'weekly') {
        supabase
          .from('employee_weekly_pattern')
          .select('employee_id, weekday, shift_id')
          .then(({ data }) => setWeeklyPatternRows(data ?? []));
      }
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      supabase.from('payroll_summaries').select('*').gte('work_date', from).lte('work_date', to),
      supabase.from('attendance_logs').select('*').gte('punch_time', `${from}T00:00:00Z`).lte('punch_time', `${to}T23:59:59Z`),
      supabase.from('employee_daily_shifts').select('employee_id, work_date, shift_id').gte('work_date', from).lte('work_date', to),
      supabase.from('company_holidays').select('*').gte('holiday_date', from).lte('holiday_date', to),
      supabase.from('leave_requests').select('*').eq('status', 'approved').lte('start_date', to).gte('end_date', from),
    ]).then(([summariesRes, logsRes, rosterRes, holidaysRes, leaveRes]) => {
      setSummaries(summariesRes.data ?? []);
      setLogs(logsRes.data ?? []);
      setDailyShiftRows(rosterRes.data ?? []);
      setHolidays(holidaysRes.data ?? []);
      setLeaveRequests(leaveRes.data ?? []);
      setLoading(false);
    });
  }, [from, to]);

  const scopedEmployees = useMemo(
    () => (employeeId === 'all' ? employees : employees.filter(e => e.id === employeeId)),
    [employees, employeeId]
  );

  const dailyShiftByDate: DailyShiftByDate = useMemo(() => {
    const map: DailyShiftByDate = new Map();
    for (const r of dailyShiftRows) {
      let perDate = map.get(r.employee_id);
      if (!perDate) {
        perDate = new Map();
        map.set(r.employee_id, perDate);
      }
      perDate.set(r.work_date, r.shift_id);
    }
    return map;
  }, [dailyShiftRows]);

  const weekOffDateSet = useMemo(() => weekOffDatesInRange(from, to, weeklyOffDay, holidays), [from, to, weeklyOffDay, holidays]);
  const leaveByEmployee = useMemo(() => leaveDatesByEmployee(leaveRequests), [leaveRequests]);
  const weeklyPattern = useMemo(() => buildWeeklyPatternByEmployee(weeklyPatternRows), [weeklyPatternRows]);

  // Every date in the picked range — hoisted out of the row-building memo
  // below so the Attendance-grid export/print view can lay dates out as
  // columns without recomputing (or drifting from) the same list.
  const days: string[] = useMemo(() => {
    const out: string[] = [];
    const cur = new Date(from + 'T00:00:00Z');
    const end = new Date(to + 'T00:00:00Z');
    while (cur <= end) {
      out.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
  }, [from, to]);

  // Unfiltered, one row per employee×date — the on-screen detailed table
  // below (`rows`) filters/sorts this for display, but the Attendance-grid
  // export and its Hours Summary sheet need every day regardless of the
  // Status filter, so they read from this instead.
  const allRows: Row[] = useMemo(() => {
    const deviceName = (id: string | null) => devices.find(d => d.id === id)?.name ?? 'Mobile / QR / Selfie';
    const today = nepalTodayIso();

    // Per-employee: raw same-date bucketing, corrected for any day whose
    // resolved shift crosses midnight (Night Duty/Day & Night Duty) — done
    // once per employee up front (not inside the day×employee loop below)
    // since applyOvernightShiftCorrection needs a whole date range at once.
    const logsByEmployeeDay = new Map<string, Map<string, AttendanceLog[]>>();
    for (const emp of scopedEmployees) {
      const empLogs = logs.filter(l => l.employee_id === emp.id);
      const byDate = new Map<string, AttendanceLog[]>();
      for (const day of days) {
        const dayLogs = empLogs.filter(l => l.punch_time.slice(0, 10) === day);
        if (dayLogs.length > 0) byDate.set(day, dayLogs);
      }
      applyOvernightShiftCorrection(byDate, empLogs, emp, shifts, dailyShiftByDate, weekOffDateSet, weeklyPattern);
      logsByEmployeeDay.set(emp.id, byDate);
    }

    const out: Row[] = [];
    for (const day of days) {
      for (const emp of scopedEmployees) {
        // Today's own row can still gain punches (e.g. a checkout) after a
        // payroll_summaries row for it was already computed — that row is
        // never re-run until tomorrow's nightly job, so trusting it here
        // would freeze today's attendance at whatever it looked like the
        // moment it was last computed. Always compute today live instead;
        // past days' summaries are final and safe to trust.
        const summary = day === today ? undefined : summaries.find(s => s.employee_id === emp.id && s.work_date === day);
        const dayLogs = (logsByEmployeeDay.get(emp.id)?.get(day) ?? []).sort((a, b) => a.punch_time.localeCompare(b.punch_time));
        const resolved = resolveShiftForDate(emp, shifts, day, dailyShiftByDate, weekOffDateSet, weeklyPattern);
        const shiftLabel = isWeekOff(resolved)
          ? 'Week Off'
          : `${resolved.name} (${resolved.start_time.slice(0, 5)}–${resolved.end_time.slice(0, 5)})`;

        const shiftHours = shiftDurationHours(resolved);

        if (summary) {
          out.push({
            key: `${emp.id}-${day}`,
            date: day,
            employeeId: emp.id,
            enrollId: emp.fingerprint_id ?? '—',
            employeeName: emp.name,
            device: deviceName(dayLogs[0]?.device_id ?? null),
            shiftLabel,
            shiftHours,
            checkIn: summary.check_in,
            checkOut: summary.check_out,
            hours: summary.total_hours,
            status: summary.is_late && !emp.attendance_exempt ? 'Late' : 'Present',
            lateMinutes: summary.is_late && !emp.attendance_exempt ? summary.late_minutes : 0,
            earlyMinutes: summary.is_early_departure && !emp.attendance_exempt ? summary.early_departure_minutes : 0,
            overtime: summary.overtime_hours,
          });
        } else if (dayLogs.length > 0) {
          // Not yet processed by compute_payroll_summaries() (runs nightly
          // for the previous day, or manually via "Recalculate month" on
          // Payroll) — compute late/early/hours/overtime live from the raw
          // punches (same math payroll itself uses, see lib/shift.ts)
          // instead of leaving them blank until that job runs.
          const live = computeDayStatusForResolvedShift(dayLogs, resolved);
          out.push({
            key: `${emp.id}-${day}`,
            date: day,
            employeeId: emp.id,
            enrollId: emp.fingerprint_id ?? '—',
            employeeName: emp.name,
            device: deviceName(dayLogs[0].device_id ?? null),
            shiftLabel,
            shiftHours,
            checkIn: live.checkIn.punch_time,
            checkOut: live.checkOut?.punch_time ?? null,
            hours: live.totalMinutes / 60,
            status: live.isLate && !emp.attendance_exempt ? 'Late' : 'Present',
            lateMinutes: emp.attendance_exempt ? 0 : live.lateMinutes,
            earlyMinutes: emp.attendance_exempt ? 0 : live.earlyMinutes,
            overtime: live.overtimeMinutes / 60,
            pending: true,
          });
        } else {
          // A company Week-off, a per-employee roster Week Off, or an
          // approved Leave day is a known, paid day off — takes priority
          // over the Upcoming/Absent distinction below, whether it's
          // already passed or not. A requested (and approved) Leave keeps
          // its own label even on a day that's also a Week Off — it's still
          // paid the same either way. `resolved` (computed above for the
          // Shift column) already reflects the per-employee roster
          // regardless of roster_mode, so this only needs to check it
          // alongside the company-wide set instead of duplicating that
          // resolution — the previous version checked weekOffDateSet only,
          // which meant an employee with a roster Week Off (but no
          // company-wide off day) still showed "Absent" here even though
          // the Shift column on the same row already said "Week Off".
          const isOnLeave = leaveByEmployee.get(emp.id)?.has(day);
          const isOnWeekOff = weekOffDateSet.has(day) || isWeekOff(resolved);
          out.push({
            key: `${emp.id}-${day}`,
            date: day,
            employeeId: emp.id,
            enrollId: emp.fingerprint_id ?? '—',
            employeeName: emp.name,
            device: 'N/A',
            shiftLabel,
            shiftHours,
            checkIn: null,
            checkOut: null,
            hours: 0,
            // A day that hasn't happened yet isn't "Absent" — it just
            // hasn't occurred (only relevant if the picked range runs past
            // today).
            status: isOnLeave
              ? 'Leave'
              : isOnWeekOff
                ? 'Week Off'
                : day > today
                  ? 'Upcoming'
                  : emp.attendance_exempt
                    ? 'Exempt'
                    : 'Absent',
            lateMinutes: 0,
            earlyMinutes: 0,
            overtime: 0,
          });
        }
      }
    }
    return out;
  }, [scopedEmployees, summaries, logs, devices, shifts, days, dailyShiftByDate, weekOffDateSet, leaveByEmployee, weeklyPattern]);

  // The on-screen detailed log applies the Status filter and the ID sort —
  // the Attendance-grid export/print view below reads allRows directly
  // instead, since it always needs every day regardless of that filter.
  const rows: Row[] = useMemo(
    () =>
      allRows
        .filter(r => status === 'All' || (status === 'Early' ? r.earlyMinutes > 0 : r.status === status))
        .sort((a, b) => {
          const aId = a.enrollId ?? '';
          const bId = b.enrollId ?? '';
          if (!aId && !bId) return 0;
          if (!aId) return 1;
          if (!bId) return -1;
          return aId.localeCompare(bId, undefined, { numeric: true, sensitivity: 'base' });
        }),
    [allRows, status]
  );

  const totals = useMemo(() => {
    const workHours = rows.reduce((sum, r) => sum + r.hours, 0);
    const overtimeHours = rows.reduce((sum, r) => sum + r.overtime, 0);
    const lateMinutes = rows.reduce((sum, r) => sum + r.lateMinutes, 0);
    const earlyMinutes = rows.reduce((sum, r) => sum + r.earlyMinutes, 0);
    const presentDays = rows.filter(r => r.checkIn).length;
    const absentDays = rows.filter(r => !r.checkIn && r.status !== 'Upcoming' && r.status !== 'Exempt').length;
    return { workHours, overtimeHours, lateMinutes, earlyMinutes, presentDays, absentDays };
  }, [rows]);

  // Matrix export/print view: employees as rows, every date in range as its
  // own column, then running Present/Late/Absent/Week Off/Leave/Exempt
  // totals — built from allRows (not the Status-filtered/sorted `rows`),
  // since the export always wants the whole picture regardless of that
  // on-screen filter.
  const matrix = useMemo<MatrixEmployeeRow[]>(() => {
    const byEmployee = new Map<string, MatrixEmployeeRow>();
    for (const emp of scopedEmployees) {
      byEmployee.set(emp.id, {
        employeeId: emp.id,
        enrollId: emp.fingerprint_id ?? '—',
        employeeName: emp.name,
        cellsByDate: new Map(),
        counts: { P: 0, LT: 0, A: 0, WO: 0, L: 0, EX: 0 },
      });
    }
    for (const r of allRows) {
      const row = byEmployee.get(r.employeeId);
      if (!row) continue;
      const code = STATUS_CODE[r.status];
      row.cellsByDate.set(r.date, code);
      if (code) row.counts[code]++;
    }
    return Array.from(byEmployee.values());
  }, [scopedEmployees, allRows]);

  // Hours Summary: "expected hours" only counts a day the employee was
  // actually meant to work (Present/Late/Absent — not Week Off/Leave, and
  // not a day an exempt employee simply didn't punch), so an employee with
  // more Week Off/Leave days correctly ends up with fewer expected hours,
  // not "short" by comparison to someone who had none.
  const hoursSummary = useMemo<HoursSummaryRow[]>(() => {
    const byEmployee = new Map<string, HoursSummaryRow>();
    for (const emp of scopedEmployees) {
      byEmployee.set(emp.id, {
        employeeId: emp.id,
        enrollId: emp.fingerprint_id ?? '—',
        employeeName: emp.name,
        daysWorked: 0,
        workingDays: 0,
        hoursWorked: 0,
        expectedHours: 0,
        overtimeHours: 0,
      });
    }
    for (const r of allRows) {
      const row = byEmployee.get(r.employeeId);
      if (!row) continue;
      if (r.status === 'Present' || r.status === 'Late' || r.status === 'Absent') {
        row.workingDays++;
        row.expectedHours += r.shiftHours;
      }
      if (r.status === 'Present' || r.status === 'Late') {
        row.daysWorked++;
        row.hoursWorked += r.hours;
        row.overtimeHours += r.overtime;
      }
    }
    return Array.from(byEmployee.values());
  }, [scopedEmployees, allRows]);

  function exportWorkbook() {
    const periodLabel = from === to ? formatAdDate(from, system) : `${formatAdDate(from, system)} – ${formatAdDate(to, system)}`;
    const title = [companyName ?? 'Attendance Report', 'Monthly Attendance Report', periodLabel];

    const attendanceHeaders = ['Employee', 'ID', ...days.map(d => formatAdDate(d, system)), 'Present', 'Late', 'Absent', 'Week Off', 'Leave', 'Exempt'];
    const attendanceRows = matrix.map(m => [
      m.employeeName,
      m.enrollId,
      ...days.map(d => STATUS_CODE_LABEL[m.cellsByDate.get(d) ?? ''] ?? ''),
      m.counts.P,
      m.counts.LT,
      m.counts.A,
      m.counts.WO,
      m.counts.L,
      m.counts.EX,
    ]);

    const hoursHeaders = ['Employee', 'ID', 'Days Worked', 'Working Days', 'Hours Worked', 'Expected Hours', 'Overtime', 'Difference'];
    const hoursRows = hoursSummary.map(h => [
      h.employeeName,
      h.enrollId,
      h.daysWorked,
      h.workingDays,
      h.hoursWorked.toFixed(1),
      h.expectedHours.toFixed(1),
      h.overtimeHours.toFixed(1),
      (h.hoursWorked - h.expectedHours).toFixed(1),
    ]);

    downloadExcelWorkbook(`attendance_${from}_to_${to}.xlsx`, [
      { name: 'Attendance', title, headers: attendanceHeaders, rows: attendanceRows },
      { name: 'Hours Summary', title, headers: hoursHeaders, rows: hoursRows },
    ]);
  }

  return (
    <>
      <div className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm print:hidden">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Employee</label>
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <PersonIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-accent" />
                <select
                  value={employeeId}
                  onChange={e => setEmployeeId(e.target.value)}
                  className="min-w-[10rem] rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-2.5 text-xs shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="all">All Employees</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>
                      {e.name} (ID {e.fingerprint_id ?? '—'})
                    </option>
                  ))}
                </select>
              </div>
              {employeeId !== 'all' && (
                <button onClick={() => setEmployeeId('all')} className="text-[11px] font-medium text-accent hover:underline">
                  Clear
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Status</label>
            <div className="relative">
              <StatusIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-accent" />
              <select
                value={status}
                onChange={e => setStatus(e.target.value as typeof status)}
                className="rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-2.5 text-xs shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              >
                <option value="All">All Logs</option>
                <option value="Present">Present</option>
                <option value="Absent">Absent</option>
                <option value="Late">Late</option>
                <option value="Early">Early</option>
                <option value="Week Off">Week Off</option>
                <option value="Leave">Leave</option>
                <option value="Exempt">Excused</option>
              </select>
            </div>
          </div>

          <div className="hidden h-8 w-px bg-slate-200 sm:block" />

          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Date Range</label>
            <div className="w-48">
              <DateRangePicker from={from} to={to} onChange={(f, t) => {
                setFrom(f);
                setTo(t);
              }} />
            </div>
          </div>

          <TableExportBar onExportCsv={exportWorkbook} />
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm print:hidden">
        {/* Same left-to-right table on every screen size, including phones —
            horizontal scroll instead of a condensed/truncated mobile layout,
            so it always matches the desktop web view exactly. Print gets the
            full table instead of just the scrolled-into-view slice. */}
        <div className="max-h-[65vh] overflow-auto rounded-lg print:max-h-none print:overflow-visible">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <th className="whitespace-nowrap px-2 py-1.5 font-medium">Date</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium">ID</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium">Employee</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium">Shift</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium">In / Out</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium">Late / Early</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium">Work Hours</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium">Overtime</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium">Status</th>
              <th className="whitespace-nowrap px-2 py-1.5 font-medium">Device</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="whitespace-nowrap px-2 py-1 text-slate-600">{formatAdDate(r.date, system)}</td>
                <td className="whitespace-nowrap px-2 py-1 text-slate-600">{r.enrollId}</td>
                <td className="whitespace-nowrap px-2 py-1 font-medium text-ink">{r.employeeName}</td>
                <td className="px-2 py-1 whitespace-nowrap text-slate-600">{r.shiftLabel}</td>
                <td className="whitespace-nowrap px-2 py-1 text-slate-600">
                  {r.checkIn ? new Date(r.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '–:–'}
                  {' – '}
                  {r.checkOut ? new Date(r.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '–:–'}
                </td>
                <td className="whitespace-nowrap px-2 py-1">
                  {r.lateMinutes === 0 && r.earlyMinutes === 0 && <span className="text-slate-400">—</span>}
                  {r.lateMinutes > 0 && (
                    <span className="font-medium text-warning-text">L {formatHoursMinutes(r.lateMinutes)}</span>
                  )}
                  {r.lateMinutes > 0 && r.earlyMinutes > 0 && ' · '}
                  {r.earlyMinutes > 0 && (
                    <span className="font-medium text-critical-text">E {formatHoursMinutes(r.earlyMinutes)}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-1 text-slate-600">
                  {fmtHrs(r.hours)}
                  {r.pending && <span className="ml-1 text-[9px] text-slate-400">(live)</span>}
                </td>
                <td className="whitespace-nowrap px-2 py-1 text-slate-600">
                  {fmtHrs(r.overtime)}
                  {r.pending && <span className="ml-1 text-[9px] text-slate-400">(live)</span>}
                </td>
                <td className="whitespace-nowrap px-2 py-1">
                  {statusBadge(r)}
                </td>
                <td className="whitespace-nowrap px-2 py-1 text-slate-600">{r.device}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-slate-400">
                  {loading ? 'Loading…' : 'No records in this range.'}
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="sticky bottom-0 border-t-2 border-slate-200 bg-slate-50 text-xs font-bold text-ink">
                <td colSpan={4} className="whitespace-nowrap px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Total
                </td>
                <td />
                <td className="whitespace-nowrap px-2 py-1.5 text-[10px]">
                  {totals.lateMinutes > 0 && <span className="text-warning-text">L {formatHoursMinutes(totals.lateMinutes)}</span>}
                  {totals.lateMinutes > 0 && totals.earlyMinutes > 0 && ' · '}
                  {totals.earlyMinutes > 0 && <span className="text-critical-text">E {formatHoursMinutes(totals.earlyMinutes)}</span>}
                  {totals.lateMinutes === 0 && totals.earlyMinutes === 0 && '—'}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5">{fmtHrs(totals.workHours)}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{fmtHrs(totals.overtimeHours)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-[10px] font-semibold">
                  <span className="text-good-text">{totals.presentDays} present</span>
                  {' · '}
                  <span className="text-critical-text">{totals.absentDays} absent</span>
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
        </div>
      </div>

      {/* Print/PDF-only view — employees as rows, dates as columns, running
          totals, plus a separate Hours Summary. Hidden on screen; the
          detailed punch-by-punch log above is print:hidden instead, so
          only one of the two ever actually prints. */}
      <div className="hidden print:block">
        <div className="mb-4 border-b border-slate-300 pb-3 text-center">
          <div className="text-lg font-bold text-ink">{companyName ?? 'Attendance Report'}</div>
          <div className="mx-auto my-2 h-px w-9 bg-ink" />
          <div className="text-sm font-semibold text-ink">Monthly Attendance Report</div>
          <div className="text-xs font-semibold text-accent">
            {from === to ? formatAdDate(from, system) : `${formatAdDate(from, system)} – ${formatAdDate(to, system)}`}
          </div>
        </div>

        <div className="mb-3 flex flex-wrap gap-3 text-[10px] text-slate-600">
          <span><b>P</b> Present</span>
          <span><b>LT</b> Late</span>
          <span><b>A</b> Absent</span>
          <span><b>WO</b> Week Off</span>
          <span><b>L</b> Leave</span>
          <span><b>EX</b> Exempt</span>
        </div>

        <table className="w-full border-collapse text-left text-[9px]">
          <thead>
            <tr className="border-b border-slate-400">
              <th className="whitespace-nowrap border-r border-slate-300 px-1.5 py-1 font-semibold">Employee</th>
              {days.map(d => (
                <th key={d} className="whitespace-nowrap px-1 py-1 text-center font-medium">
                  {formatAdDate(d, system)}
                </th>
              ))}
              <th className="whitespace-nowrap border-l border-slate-300 px-1.5 py-1 text-center font-semibold">P</th>
              <th className="whitespace-nowrap px-1.5 py-1 text-center font-semibold">LT</th>
              <th className="whitespace-nowrap px-1.5 py-1 text-center font-semibold">A</th>
              <th className="whitespace-nowrap px-1.5 py-1 text-center font-semibold">WO</th>
              <th className="whitespace-nowrap px-1.5 py-1 text-center font-semibold">L</th>
              <th className="whitespace-nowrap px-1.5 py-1 text-center font-semibold">EX</th>
            </tr>
          </thead>
          <tbody>
            {matrix.map(m => (
              <tr key={m.employeeId} className="border-b border-slate-200">
                <td className="whitespace-nowrap border-r border-slate-300 px-1.5 py-1 font-medium">
                  {m.employeeName} <span className="text-slate-400">#{m.enrollId}</span>
                </td>
                {days.map(d => (
                  <td key={d} className="whitespace-nowrap px-1 py-1 text-center">
                    {m.cellsByDate.get(d) || '–'}
                  </td>
                ))}
                <td className="border-l border-slate-300 px-1.5 py-1 text-center font-semibold">{m.counts.P}</td>
                <td className="px-1.5 py-1 text-center font-semibold">{m.counts.LT}</td>
                <td className="px-1.5 py-1 text-center font-semibold">{m.counts.A}</td>
                <td className="px-1.5 py-1 text-center font-semibold">{m.counts.WO}</td>
                <td className="px-1.5 py-1 text-center font-semibold">{m.counts.L}</td>
                <td className="px-1.5 py-1 text-center font-semibold">{m.counts.EX}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mb-2 mt-8 text-sm font-semibold text-ink">Hours Summary</div>
        <table className="w-full border-collapse text-left text-[10px]">
          <thead>
            <tr className="border-b border-slate-400">
              <th className="px-1.5 py-1 font-semibold">Employee</th>
              <th className="px-1.5 py-1 text-right font-semibold">Days Worked</th>
              <th className="px-1.5 py-1 text-right font-semibold">Hours Worked</th>
              <th className="px-1.5 py-1 text-right font-semibold">Expected Hours</th>
              <th className="px-1.5 py-1 text-right font-semibold">Overtime</th>
              <th className="px-1.5 py-1 text-right font-semibold">Difference</th>
            </tr>
          </thead>
          <tbody>
            {hoursSummary.map(h => {
              const diff = h.hoursWorked - h.expectedHours;
              return (
                <tr key={h.employeeId} className="border-b border-slate-200">
                  <td className="px-1.5 py-1 font-medium">{h.employeeName}</td>
                  <td className="px-1.5 py-1 text-right">
                    {h.daysWorked} / {h.workingDays}
                  </td>
                  <td className="px-1.5 py-1 text-right">{h.hoursWorked.toFixed(1)}</td>
                  <td className="px-1.5 py-1 text-right">{h.expectedHours.toFixed(1)}</td>
                  <td className="px-1.5 py-1 text-right">{h.overtimeHours.toFixed(1)}</td>
                  <td className={`px-1.5 py-1 text-right font-semibold ${diff < 0 ? 'text-critical-text' : 'text-good-text'}`}>
                    {diff >= 0 ? '+' : ''}
                    {diff.toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
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
