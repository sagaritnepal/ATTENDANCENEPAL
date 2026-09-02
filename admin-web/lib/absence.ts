import type { DayDetail } from './payrollDetail';

/** How an absent day cuts pay, per company (companies.absence_* columns,
 * 20260902140000_company_absence_policy.sql). Defaults reproduce the
 * behaviour that was hard-coded on the Salary Structure employee page. */
export type AbsencePolicy = {
  /** Per-day value divides monthly pay by: 'calendar' = days in that month,
   * 'thirty' = always 30, 'working' = calendar − weekly offs − holidays. */
  divisor: 'calendar' | 'thirty' | 'working';
  /** What shrinks on an absent day: 'basic' or 'gross' (basic + allowance). */
  basis: 'basic' | 'gross';
  /** 'hourly' = pay per hour worked (a short day loses only the missing
   * hours); 'full_day' = an absent day is a full leave-without-pay day. */
  partial: 'hourly' | 'full_day';
  /** 'full_day' mode: worked under this many hours on a working day = half a
   * day deducted. 0 disables it. */
  halfDayHours: number;
};

export const DEFAULT_ABSENCE_POLICY: AbsencePolicy = {
  divisor: 'calendar',
  basis: 'basic',
  partial: 'hourly',
  halfDayHours: 0,
};

/** Attendance totals for a period, the shape `computeAbsenceAdjustment`
 * needs. `paidOffDays` are paid week-off / approved-paid-leave days (never
 * deducted); `absentDays` now includes approved *unpaid* leave. */
/** The per-day value one absent day costs under the policy — `dayBase`
 * (basic, or basic + allowance) divided by the chosen divisor. */
export function absencePerDay(
  salary: number,
  allowance: number,
  policy: AbsencePolicy,
  daysInPeriod: number,
  workingDaysInPeriod: number
): number {
  const divisorDays =
    policy.divisor === 'thirty' ? 30 : policy.divisor === 'working' ? Math.max(1, workingDaysInPeriod) : daysInPeriod;
  const dayBase = policy.basis === 'gross' ? salary + allowance : salary;
  return divisorDays > 0 ? dayBase / divisorDays : 0;
}

export type AttendanceTotals = {
  countedDays: number; // elapsed, non-"Upcoming" days
  paidOffDays: number;
  absentDays: number;
  halfDays: number;
  hoursWorked: number; // regular hours only (overtime excluded)
  overtimeHours: number;
  lateMinutes: number;
  earlyMinutes: number;
};

/** Roll a period's DayDetail rows into the totals above. `halfDayHours` from
 * the policy decides which short worked days count as a half day. */
export function aggregateAttendance(dayRows: DayDetail[], halfDayHours = 0): AttendanceTotals {
  const t: AttendanceTotals = {
    countedDays: 0,
    paidOffDays: 0,
    absentDays: 0,
    halfDays: 0,
    hoursWorked: 0,
    overtimeHours: 0,
    lateMinutes: 0,
    earlyMinutes: 0,
  };
  for (const d of dayRows) {
    if (d.status === 'Upcoming') continue;
    t.countedDays += 1;
    t.lateMinutes += d.lateMinutes;
    t.earlyMinutes += d.earlyMinutes;
    if (d.paidOff) {
      t.paidOffDays += 1;
      continue;
    }
    if (d.status === 'Absent') {
      t.absentDays += 1;
      continue;
    }
    const regular = Math.max(0, d.hours - d.overtime);
    t.hoursWorked += regular;
    t.overtimeHours += d.overtime;
    if (halfDayHours > 0 && regular > 0 && regular < halfDayHours) t.halfDays += 1;
  }
  return t;
}

export type AbsenceAdjustment = {
  perDay: number; // dayBase / divisorDays
  divisorDays: number;
  dayBase: number;
  fullBase: number; // what the counted days would earn at full attendance
  absenceDeduction: number; // ≤ 0
  overtimePay: number; // ≥ 0
  earnedBase: number; // fullBase + absenceDeduction (basis-appropriate)
  earnedBasic: number; // salary portion — PF / SSF / TDS compute on this
  earnedAllowance: number;
};

/** The period's absence deduction and overtime pay under the company policy.
 * With DEFAULT_ABSENCE_POLICY this returns exactly what the old per-hour
 * `salary / daysInMonth` logic produced. */
export function computeAbsenceAdjustment(input: {
  salary: number;
  allowance: number;
  policy: AbsencePolicy;
  daysInPeriod: number;
  workingDaysInPeriod: number;
  totals: AttendanceTotals;
  otHoursPerDay: number;
  otMultiplier: number;
  otOn: boolean;
}): AbsenceAdjustment {
  const { salary, allowance, policy, daysInPeriod, workingDaysInPeriod, totals, otHoursPerDay, otMultiplier, otOn } = input;
  const gross = salary + allowance;

  const divisorDays =
    policy.divisor === 'thirty' ? 30 : policy.divisor === 'working' ? Math.max(1, workingDaysInPeriod) : daysInPeriod;
  const dayBase = policy.basis === 'gross' ? gross : salary;
  const perDay = divisorDays > 0 ? dayBase / divisorDays : 0;

  const fullBase = perDay * totals.countedDays;

  let absenceDeduction: number;
  if (policy.partial === 'full_day') {
    absenceDeduction = -(perDay * totals.absentDays + perDay * 0.5 * totals.halfDays);
  } else {
    // Per-hour: what the worked hours (+ paid-off full days) actually earn,
    // minus what every counted day would have earned in full. Absent days and
    // short days both fall out of this negative.
    const perHour = otHoursPerDay > 0 ? perDay / otHoursPerDay : 0;
    const actualBase = perHour * totals.hoursWorked + perDay * totals.paidOffDays;
    absenceDeduction = actualBase - perDay * totals.countedDays;
  }

  const otHourRate = otHoursPerDay > 0 ? salary / (divisorDays * otHoursPerDay) : 0;
  const overtimePay = otOn && totals.overtimeHours > 0 ? otHourRate * otMultiplier * totals.overtimeHours : 0;

  const earnedBase = fullBase + absenceDeduction;

  let earnedBasic: number;
  let earnedAllowance: number;
  if (policy.basis === 'gross') {
    const frac = gross > 0 ? earnedBase / gross : 1;
    earnedBasic = salary * frac;
    earnedAllowance = allowance * frac;
  } else {
    earnedBasic = earnedBase;
    earnedAllowance = salary > 0 ? allowance * (earnedBasic / salary) : allowance;
  }

  return { perDay, divisorDays, dayBase, fullBase, absenceDeduction, overtimePay, earnedBase, earnedBasic, earnedAllowance };
}
