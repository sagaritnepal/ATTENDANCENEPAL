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

/** employeeId -> work_date (YYYY-MM-DD) -> shift_id, from employee_daily_shifts.
 * A `null` value means an explicit Week Off row exists for that date. No entry
 * for a date at all means "not on the roster" — falls back to resolveShift(). */
export type DailyShiftByDate = Map<string, Map<string, string | null>>;

/** employeeId -> weekday (0=Sunday..6=Saturday) -> shift_id, from
 * employee_weekly_pattern (20260818100000) — only ever meaningful when the
 * company's roster_mode is 'weekly'; callers in 'monthly' mode (the default)
 * pass undefined here and resolution behaves exactly as it always has. Same
 * null-means-Week-Off convention as DailyShiftByDate. */
export type WeeklyPatternByEmployee = Map<string, Map<number, string | null>>;

export function buildWeeklyPatternByEmployee(
  rows: { employee_id: string; weekday: number; shift_id: string | null }[]
): WeeklyPatternByEmployee {
  const map: WeeklyPatternByEmployee = new Map();
  for (const r of rows) {
    let perWeekday = map.get(r.employee_id);
    if (!perWeekday) {
      perWeekday = new Map();
      map.set(r.employee_id, perWeekday);
    }
    perWeekday.set(r.weekday, r.shift_id);
  }
  return map;
}

/** Sentinel for "explicitly no shift today" (Week Off), distinct from a day
 * with no roster entry at all (which still resolves via resolveShift()). */
export const WEEK_OFF = { id: 'week-off', name: 'Week Off' } as const;
export type ResolvedShift = Shift | typeof DEFAULT_SHIFT | typeof WEEK_OFF;

export function isWeekOff(shift: ResolvedShift): shift is typeof WEEK_OFF {
  return shift === WEEK_OFF;
}

/** Mirrors find_employee_shift_for_date() in the roster migration: an
 * employee_daily_shifts row for this exact date wins (its shift, or
 * WEEK_OFF if shift_id is null) — a deliberate, specific override, so it
 * beats everything else including a company-wide Week-off below. No roster
 * row at all falls through, in 'weekly' roster_mode companies only, to a
 * matching weekday in employee_weekly_pattern (20260818100000) — same
 * override-wins priority as the exact-date roster, since it's the same kind
 * of deliberate assignment, just recurring instead of one-off. After that,
 * falls through to a company-wide Week-off date (weeklyOffDay or a
 * company_holidays row, passed in by the caller — see lib/weekOff.ts) if
 * this date is one, and only then to the normal own-shift/department/
 * default chain — companies using none of these features see no change. */
export function resolveShiftForDate(
  employee: Employee,
  shifts: Shift[],
  date: string,
  dailyShiftByDate?: DailyShiftByDate,
  companyWeekOffDates?: Set<string>,
  weeklyPattern?: WeeklyPatternByEmployee
): ResolvedShift {
  const perDate = dailyShiftByDate?.get(employee.id);
  if (perDate?.has(date)) {
    const shiftId = perDate.get(date);
    if (shiftId === null) return WEEK_OFF;
    const shift = shifts.find(s => s.id === shiftId);
    if (shift) return shift;
  }
  const perWeekday = weeklyPattern?.get(employee.id);
  if (perWeekday?.size) {
    const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
    if (perWeekday.has(weekday)) {
      const shiftId = perWeekday.get(weekday);
      if (shiftId === null) return WEEK_OFF;
      const shift = shifts.find(s => s.id === shiftId);
      if (shift) return shift;
    }
  }
  if (companyWeekOffDates?.has(date)) return WEEK_OFF;
  return resolveShift(employee, shifts);
}

function isOvernightShift(shift: Pick<Shift, 'start_time' | 'end_time'>) {
  return toMinutes(shift.end_time) <= toMinutes(shift.start_time);
}

export function formatShiftHours(shift: Pick<Shift, 'start_time' | 'end_time'>) {
  const hh = (t: string) => t.slice(0, 2);
  return `${shift.start_time.slice(0, 5)}–${shift.end_time.slice(0, 5)} (${hh(shift.start_time)}-${hh(shift.end_time)})`;
}

/** How many hours a resolved shift actually spans — 0 for WEEK_OFF, same
 * overnight-safe math computeDayStatus() uses internally for its own
 * shiftDurationMin, exposed here so a "how many hours was this employee
 * expected to work" total (e.g. a payroll/attendance export's hours
 * summary) doesn't have to recompute or duplicate that logic. */
export function shiftDurationHours(resolved: ResolvedShift): number {
  if (isWeekOff(resolved)) return 0;
  const startMin = toMinutes(resolved.start_time);
  const endMin = toMinutes(resolved.end_time);
  const durationMin = endMin > startMin ? endMin - startMin : 24 * 60 - startMin + endMin;
  return durationMin / 60;
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

/** Same as computeDayStatus(), but for a ResolvedShift that might be
 * WEEK_OFF — a day nothing was scheduled, so never late/early, but any
 * hours actually punched still count (entirely as overtime, since there
 * were 0 scheduled hours to exceed). Mirrors calc_payroll_fields()'s
 * is_week_off branch. */
export function computeDayStatusForResolvedShift(logs: AttendanceLog[], resolved: ResolvedShift): DayStatus {
  if (isWeekOff(resolved)) {
    const { checkIn, checkOut } = selectDayPunches(logs);
    const hasOut = !!checkOut;
    const totalMinutes = hasOut
      ? Math.round((new Date(checkOut!.punch_time).getTime() - new Date(checkIn.punch_time).getTime()) / 60000)
      : 0;
    return {
      hasIn: true,
      hasOut,
      isLate: false,
      isEarly: false,
      checkIn,
      checkOut: hasOut ? checkOut : null,
      lateMinutes: 0,
      earlyMinutes: 0,
      totalMinutes,
      overtimeMinutes: totalMinutes,
    };
  }
  return computeDayStatus(logs, resolved);
}

/** The UTC instant for `time` (HH:MM) on `dateKey` (YYYY-MM-DD), read as
 * Nepal local time — the inverse of punchMinuteOfDay()'s conversion. */
function nepalDateTimeToUtcMs(dateKey: string, time: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = time.slice(0, 5).split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - NEPAL_OFFSET_MINUTES * 60000;
}

/** Corrects a `byDate` grouping (built by each call site the usual way —
 * bucketing raw punches by their own calendar date) for overnight shifts
 * (Night Duty, Day & Night Duty): a shift starting in the evening has its
 * check-out land on the NEXT calendar date, so naive same-date bucketing
 * loses the shift entirely (the start date sees no matching check-out, and
 * the end date mislabels the lone check-out as its own stray check-in).
 * Mirrors shift_window_for_date()/compute_payroll_summaries()'s fix
 * server-side: for any date whose resolved shift crosses midnight, rebuild
 * that date's bucket from a window starting at the shift's scheduled start
 * and spanning its duration plus a 2-hour overtime allowance, then strip
 * whatever punches that window claimed out of neighboring dates' buckets
 * so nothing gets double-counted. Mutates and returns `byDate`. */
export function applyOvernightShiftCorrection(
  byDate: Map<string, AttendanceLog[]>,
  allLogs: AttendanceLog[],
  employee: Employee,
  shifts: Shift[],
  dailyShiftByDate?: DailyShiftByDate,
  companyWeekOffDates?: Set<string>,
  weeklyPattern?: WeeklyPatternByEmployee
): Map<string, AttendanceLog[]> {
  const dates = [...byDate.keys()];
  const claimed = new Set<string>();
  const overnightDates = new Set<string>();

  for (const date of dates) {
    const resolved = resolveShiftForDate(employee, shifts, date, dailyShiftByDate, companyWeekOffDates, weeklyPattern);
    if (isWeekOff(resolved) || !isOvernightShift(resolved)) continue;
    overnightDates.add(date);

    const startMin = toMinutes(resolved.start_time);
    const endMin = toMinutes(resolved.end_time);
    const durationMin = 24 * 60 - startMin + endMin;
    // Window starts at midnight, not the scheduled start minute, so a punch
    // a few minutes early (arriving ahead of shift) isn't excluded.
    const windowStartMs = nepalDateTimeToUtcMs(date, '00:00');
    const windowEndMs = nepalDateTimeToUtcMs(date, resolved.start_time) + (durationMin + 120) * 60000;

    const dayLogs = allLogs.filter(l => {
      const t = new Date(l.punch_time).getTime();
      return t >= windowStartMs && t < windowEndMs;
    });
    for (const l of dayLogs) claimed.add(l.id);
    byDate.set(date, dayLogs);
  }

  if (claimed.size > 0) {
    for (const [date, list] of byDate) {
      if (overnightDates.has(date)) continue;
      const filtered = list.filter(l => !claimed.has(l.id));
      if (filtered.length !== list.length) {
        if (filtered.length > 0) byDate.set(date, filtered);
        else byDate.delete(date);
      }
    }
  }

  return byDate;
}
