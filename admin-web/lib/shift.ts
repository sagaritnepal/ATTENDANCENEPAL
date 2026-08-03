import type { AttendanceLog, Employee, Shift } from './types';

const DEFAULT_SHIFT: Pick<Shift, 'id' | 'name' | 'start_time' | 'end_time' | 'grace_minutes'> = {
  id: 'default',
  name: 'Default',
  start_time: '09:00',
  end_time: '18:00',
  grace_minutes: 10,
};

// Mirrors find_employee_shift() in supabase/payroll.sql: employee's own shift,
// else their department's, else the default.
export function resolveShift(employee: Employee, shifts: Shift[]) {
  const own = shifts.find(s => s.employee_id === employee.id);
  if (own) return own;
  const dept = shifts.find(s => s.employee_id === null && s.department === employee.department);
  if (dept) return dept;
  return DEFAULT_SHIFT;
}

export function formatShiftHours(shift: Pick<Shift, 'start_time' | 'end_time'>) {
  const hh = (t: string) => t.slice(0, 2);
  return `${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)} (${hh(shift.start_time)}-${hh(shift.end_time)})`;
}

export type DayStatus = {
  hasIn: boolean;
  hasOut: boolean;
  isLate: boolean;
  isEarly: boolean;
};

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

/** Minute-of-day for a punch, read the same way calc.js / calc_payroll_fields()
 * in supabase/payroll.sql do (UTC hours/minutes of the stored timestamptz) —
 * keeps late/early here agreeing with what payroll ends up computing. */
function punchMinuteOfDay(iso: string) {
  const d = new Date(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** One calendar day's punches -> attendance state for that day. Mirrors
 * calculateDailyRecord() in calc.js: first check-in (or earliest punch) is
 * "in", last check-out (or latest punch, if there's more than one) is "out". */
export function computeDayStatus(
  logs: AttendanceLog[],
  shift: Pick<Shift, 'start_time' | 'end_time' | 'grace_minutes'>
): DayStatus {
  const sorted = [...logs].sort((a, b) => a.punch_time.localeCompare(b.punch_time));
  const checkIn = sorted.find(l => l.punch_type === '0') ?? sorted[0];
  const outCandidates = sorted.filter(l => l.punch_type === '1');
  const checkOut = outCandidates.length
    ? outCandidates[outCandidates.length - 1]
    : sorted.length > 1
      ? sorted[sorted.length - 1]
      : null;
  const hasOut = !!checkOut && checkOut !== checkIn;

  const shiftStartMin = toMinutes(shift.start_time);
  const shiftEndMin = toMinutes(shift.end_time);
  const isLate = punchMinuteOfDay(checkIn.punch_time) > shiftStartMin + shift.grace_minutes;
  const isEarly = hasOut ? punchMinuteOfDay(checkOut!.punch_time) < shiftEndMin : false;

  return { hasIn: true, hasOut, isLate, isEarly };
}
