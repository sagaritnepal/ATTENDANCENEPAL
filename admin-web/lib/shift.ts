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
  checkIn: AttendanceLog;
  checkOut: AttendanceLog | null;
  lateMinutes: number;
  earlyMinutes: number;
  /** Worked minutes this day — 0 until there's both an in and an out. */
  totalMinutes: number;
  /** Minutes worked beyond the shift's duration — 0 unless totalMinutes exceeds it. */
  overtimeMinutes: number;
};

/** Minutes -> "H:MM", for late-by / early-by durations. */
export function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Minutes -> "Xh Ym", for larger sums (total hours, overtime) where a
 * clock-style H:MM reads oddly once it crosses 24. */
export function formatHoursMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

/** Minute-of-day for a punch, in the browser's local time — the same time
 * every check-in/check-out column on screen already renders with
 * toLocaleTimeString() (no timeZone override, so it's local too). Using
 * getUTCHours() here instead (as this used to) compared each punch against
 * the shift's 09:00-18:00 as if it were a UTC clock reading, which for a
 * Nepal-local punch is off by the whole UTC+5:45 offset — every on-time
 * checkout after shift end was scored as leaving nearly 5 hours "early".
 * calc_payroll_fields() in supabase/payroll.sql converts at time zone
 * 'Asia/Kathmandu' for the same reason, so this needs to keep agreeing with
 * that (not UTC) for live and finalized numbers to match. */
function punchMinuteOfDay(iso: string) {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/** One calendar day's punches -> the two that actually count: first
 * check-in (or earliest punch) is "in", last check-out (or latest punch, if
 * there's more than one) is "out". Any other punch that day (duplicate
 * ZKTeco taps, etc.) is neither. Mirrors calculateDailyRecord() in calc.js. */
export function selectDayPunches(logs: AttendanceLog[]): { checkIn: AttendanceLog; checkOut: AttendanceLog | null } {
  const sorted = [...logs].sort((a, b) => a.punch_time.localeCompare(b.punch_time));
  const checkIn = sorted.find(l => l.punch_type === '0') ?? sorted[0];
  const outCandidates = sorted.filter(l => l.punch_type === '1');
  const checkOut = outCandidates.length
    ? outCandidates[outCandidates.length - 1]
    : sorted.length > 1
      ? sorted[sorted.length - 1]
      : null;
  return { checkIn, checkOut: checkOut !== checkIn ? checkOut : null };
}

/** One calendar day's punches -> attendance state for that day. */
export function computeDayStatus(
  logs: AttendanceLog[],
  shift: Pick<Shift, 'start_time' | 'end_time' | 'grace_minutes'>
): DayStatus {
  const { checkIn, checkOut } = selectDayPunches(logs);
  const hasOut = !!checkOut;

  const shiftStartMin = toMinutes(shift.start_time);
  const shiftEndMin = toMinutes(shift.end_time);
  const inMin = punchMinuteOfDay(checkIn.punch_time);
  const isLate = inMin > shiftStartMin + shift.grace_minutes;
  const lateMinutes = isLate ? inMin - shiftStartMin : 0;

  const outMin = hasOut ? punchMinuteOfDay(checkOut!.punch_time) : null;
  const isEarly = outMin !== null && outMin < shiftEndMin;
  const earlyMinutes = isEarly ? shiftEndMin - outMin! : 0;

  const shiftDurationMin =
    shiftEndMin > shiftStartMin ? shiftEndMin - shiftStartMin : 24 * 60 - shiftStartMin + shiftEndMin;
  const totalMinutes = hasOut
    ? Math.round((new Date(checkOut!.punch_time).getTime() - new Date(checkIn.punch_time).getTime()) / 60000)
    : 0;
  const overtimeMinutes = totalMinutes > shiftDurationMin ? totalMinutes - shiftDurationMin : 0;

  return {
    hasIn: true,
    hasOut,
    isLate,
    isEarly,
    checkIn,
    checkOut: hasOut ? checkOut : null,
    lateMinutes,
    earlyMinutes,
    totalMinutes,
    overtimeMinutes,
  };
}
