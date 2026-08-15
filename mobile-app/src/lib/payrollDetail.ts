import type { AttendanceLog, Employee, PayrollSummary, Shift } from '../types';
import { applyOvernightShiftCorrection, computeDayStatusForResolvedShift, nepalTodayIso, resolveShiftForDate, type DailyShiftByDate } from './shift';

export type DayDetail = {
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  hours: number;
  overtime: number;
  lateMinutes: number;
  earlyMinutes: number;
  status: 'Present' | 'Late' | 'Absent' | 'Upcoming' | 'Week Off';
  pending?: boolean;
  /** True for a company-wide Week-off or approved-Leave day with no punch —
   * still earns a full day's pay (see dailySalaryEarning), distinct from a
   * genuine Absent. */
  paidOff?: boolean;
};

export function buildEmployeeDayRows(
  employee: Employee,
  shifts: Shift[],
  summaries: PayrollSummary[],
  logs: AttendanceLog[],
  start: string,
  end: string,
  dailyShiftByDate?: DailyShiftByDate,
  /** Company-wide Week-off dates and this employee's own approved-Leave
   * dates — a punchless day matching either is 'Week Off' (paid). */
  paidOffDates?: Set<string>
): DayDetail[] {
  const days: string[] = [];
  const cur = new Date(start + 'T00:00:00Z');
  const endDate = new Date(end + 'T00:00:00Z');
  while (cur <= endDate) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  const employeeLogs = logs.filter(l => l.employee_id === employee.id);
  const byDate = new Map<string, AttendanceLog[]>();
  for (const day of days) {
    const dayLogs = employeeLogs.filter(l => l.punch_time.slice(0, 10) === day);
    if (dayLogs.length > 0) byDate.set(day, dayLogs);
  }
  applyOvernightShiftCorrection(byDate, employeeLogs, employee, shifts, dailyShiftByDate, paidOffDates);

  const today = nepalTodayIso();
  return days.map(day => {
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
        status: summary.is_late ? ('Late' as const) : ('Present' as const),
      };
    }
    const dayLogs = (byDate.get(day) ?? []).sort((a, b) => a.punch_time.localeCompare(b.punch_time));
    if (dayLogs.length === 0) {
      if (paidOffDates?.has(day)) {
        return { date: day, checkIn: null, checkOut: null, hours: 0, overtime: 0, lateMinutes: 0, earlyMinutes: 0, status: 'Week Off' as const, paidOff: true };
      }
      const status = day > today ? ('Upcoming' as const) : ('Absent' as const);
      return { date: day, checkIn: null, checkOut: null, hours: 0, overtime: 0, lateMinutes: 0, earlyMinutes: 0, status };
    }
    const resolved = resolveShiftForDate(employee, shifts, day, dailyShiftByDate, paidOffDates);
    const live = computeDayStatusForResolvedShift(dayLogs, resolved);
    return {
      date: day,
      checkIn: live.checkIn.punch_time,
      checkOut: live.checkOut?.punch_time ?? null,
      hours: live.totalMinutes / 60,
      overtime: live.overtimeMinutes / 60,
      lateMinutes: live.lateMinutes,
      earlyMinutes: live.earlyMinutes,
      status: live.isLate ? ('Late' as const) : ('Present' as const),
      pending: true,
    };
  });
}

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
  if (d.paidOff) return { base: hourlyRate * otHoursPerDay, overtime: 0, total: hourlyRate * otHoursPerDay };
  const regularHours = Math.max(0, d.hours - d.overtime);
  const base = hourlyRate * regularHours;
  const overtime = otOn && d.overtime > 0 ? hourlyRate * otMultiplier * d.overtime : 0;
  return { base, overtime, total: base + overtime };
}
