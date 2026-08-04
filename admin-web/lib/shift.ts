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

/** Minutes -> "Xh Ym" — used everywhere a duration (late-by, early-by, total
 * hours, overtime) is shown, so every table reads the same way. */
export function formatHoursMinutes(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
  return h * 60 + m;
}

/** Asia/Kathmandu is a fixed UTC+5:45 offset (no DST) — same value
 * calc_payroll_fields() in supabase/payroll.sql converts to via
 * `at time zone 'Asia/Kathmandu'`. */
const NEPAL_OFFSET_MINUTES = 5 * 60 + 45;

/** Today's date, in Nepal local time, as "YYYY-MM-DD" — computed from the
 * viewer's real UTC instant plus the fixed Nepal offset, not the viewer's own
 * system clock/timezone. Used to tell whether a payroll_summaries row for a
 * given work_date can still change (the day isn't over yet in Nepal, so more
 * punches — like a checkout — can still land after that row was computed). */
export function nepalTodayIso() {
  const d = new Date(Date.now() + NEPAL_OFFSET_MINUTES * 60000);
  return d.toISOString().slice(0, 10);
}

/** Minute-of-day for a punch, in Nepal local time — computed from the punch's
 * real UTC instant plus the fixed Nepal offset, NOT the viewer's own system
 * clock. This used to read the browser's local time (via Date#getHours()),
 * which only produced correct Late/Early numbers when the person looking at
 * the screen happened to have their computer set to Nepal time too — anyone
 * viewing from a different timezone got systematically wrong late/early
 * minutes for every "live" (not yet in payroll_summaries) row, while
 * finalized rows (computed server-side with the fixed Asia/Kathmandu
 * conversion) were correct. Must keep agreeing with that server-side
 * conversion for live and finalized numbers to match. */
function punchMinuteOfDay(iso: string) {
  const d = new Date(iso);
  const utcMinutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return (((utcMinutes + NEPAL_OFFSET_MINUTES) % 1440) + 1440) % 1440;
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
