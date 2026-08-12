import type { AttendanceLog, Employee, PayrollSummary, Shift } from './types';
import {
  applyOvernightShiftCorrection,
  computeDayStatusForResolvedShift,
  nepalTodayIso,
  resolveShiftForDate,
  type DailyShiftByDate,
} from './shift';

export type DayDetail = {
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  hours: number;
  overtime: number;
  lateMinutes: number;
  earlyMinutes: number;
  status: 'Present' | 'Late' | 'Absent' | 'Upcoming' | 'Week Off';
  /** No payroll_summaries row yet (only computed by the nightly job or
   * "Recalculate month" on the Payroll page) — computed live client-side
   * from the raw punches instead of left blank until that job runs. */
  pending?: boolean;
  /** True for a company-wide Week-off or approved-Leave day with no punch —
   * still earns a full day's pay (see dailySalaryEarning), distinct from a
   * genuine Absent. */
  paidOff?: boolean;
};

/** Day 1 through `end`, for one employee — same payroll_summaries-or-live-
 * computed-from-punches fallback the Payroll page's own totals and the
 * Attendance Report page use, just per-day instead of aggregated. Shared
 * by the Payroll page and the per-employee detail page so both agree. */
export function buildEmployeeDayRows(
  employee: Employee,
  shifts: Shift[],
  summaries: PayrollSummary[],
  logs: AttendanceLog[],
  start: string,
  end: string,
  dailyShiftByDate?: DailyShiftByDate,
  /** Company-wide Week-off dates (weekOffDatesInRange()) and this employee's
   * own approved-Leave dates — a punchless day matching either is 'Week Off'
   * (paid), not 'Absent'/'Upcoming'. */
  paidOffDates?: Set<string>
): DayDetail[] {
  const days: string[] = [];
  const cur = new Date(start + 'T00:00:00Z');
  const endDate = new Date(end + 'T00:00:00Z');
  while (cur <= endDate) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  // Raw same-date bucketing first (unchanged for normal shifts), then
  // corrected for any day whose resolved shift crosses midnight (Night
  // Duty/Day & Night Duty) — see applyOvernightShiftCorrection().
  const employeeLogs = logs.filter(l => l.employee_id === employee.id);
  const byDate = new Map<string, AttendanceLog[]>();
  for (const day of days) {
    const dayLogs = employeeLogs.filter(l => l.punch_time.slice(0, 10) === day);
    if (dayLogs.length > 0) byDate.set(day, dayLogs);
  }
  applyOvernightShiftCorrection(byDate, employeeLogs, employee, shifts, dailyShiftByDate);

  const today = nepalTodayIso();
  return days.map(day => {
    // Today can still gain punches after its payroll_summaries row was
    // computed (not re-run until tomorrow's nightly job), so always compute
    // today live instead of trusting a possibly-stale summary.
    const summary = day === today ? undefined : summaries.find(s => s.employee_id === employee.id && s.work_date === day);
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
    const dayLogs = (byDate.get(day) ?? []).sort((a, b) => a.punch_time.localeCompare(b.punch_time));
    if (dayLogs.length === 0) {
      // A company Week-off or approved Leave day is a known, paid day off
      // regardless of whether it's already passed — takes priority over the
      // Upcoming/Absent distinction below.
      if (paidOffDates?.has(day)) {
        return { date: day, checkIn: null, checkOut: null, hours: 0, overtime: 0, lateMinutes: 0, earlyMinutes: 0, status: 'Week Off', paidOff: true };
      }
      // A day that hasn't happened yet isn't "Absent" — it just hasn't
      // occurred. Only mark days up to and including today that way.
      const status = day > today ? ('Upcoming' as const) : ('Absent' as const);
      return { date: day, checkIn: null, checkOut: null, hours: 0, overtime: 0, lateMinutes: 0, earlyMinutes: 0, status };
    }
    const resolved = resolveShiftForDate(employee, shifts, day, dailyShiftByDate);
    const live = computeDayStatusForResolvedShift(dayLogs, resolved);
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

/** One day's slice of the monthly Salary — same hourly proration the
 * Payroll page's calculatedSalary()/overtimeSalary() use for the whole
 * period, just for one day, so per-day figures always add up to the period
 * total. Pay is earned per hour actually worked, not a flat day rate — a
 * day worked for 2 hours pays 2 hours, not a full day. `d.hours` already
 * includes any overtime portion (see computeDayStatus), so it's subtracted
 * back out here and paid separately at the overtime multiplier instead of
 * twice at the regular rate. */
export function dailySalaryEarning(
  d: DayDetail,
  salary: number | null,
  daysInRange: number,
  otHoursPerDay: number,
  otMultiplier: number,
  otOn: boolean
): { base: number; overtime: number; total: number } | null {
  if (salary == null) return null;
  const hourlyRate = salary / (daysInRange * otHoursPerDay);
  // A paid Week-off/Leave day has no punches to derive hours from — credit
  // one full standard day (hourlyRate * otHoursPerDay = salary / daysInRange)
  // instead of the usual per-hour math.
  if (d.paidOff) return { base: hourlyRate * otHoursPerDay, overtime: 0, total: hourlyRate * otHoursPerDay };
  const regularHours = Math.max(0, d.hours - d.overtime);
  const base = hourlyRate * regularHours;
  const overtime = otOn && d.overtime > 0 ? hourlyRate * otMultiplier * d.overtime : 0;
  return { base, overtime, total: base + overtime };
}
