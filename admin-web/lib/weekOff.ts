import { supabase } from './supabase';
import type { CompanyHoliday } from './types';
import { DEFAULT_ABSENCE_POLICY, type AbsencePolicy } from './absence';

/** Company-wide Week-off: a recurring weekly day (0=Sunday..6=Saturday, from
 * companies.weekly_off_day) plus ad-hoc dates (company_holidays). Applies to
 * every employee at once — distinct from the per-employee roster Week Off
 * (employee_daily_shifts.shift_id = null, see lib/shift.ts's WEEK_OFF). */
export type RosterMode = 'weekly' | 'monthly';

export type CompanyWeekOffConfig = {
  companyId: string | null;
  weeklyOffDay: number | null;
  /** Which roster drives real employee shifts — 'monthly' (the default) is
   * today's exact-date employee_daily_shifts model; 'weekly' means
   * employee_weekly_pattern is consulted instead (see resolveShiftForDate in
   * lib/shift.ts). Defaults to 'monthly' when there's no company yet. */
  rosterMode: RosterMode;
  /** Self-serve per-company toggle (companies.break_enabled,
   * 20260820100000_break_punches.sql) — whether Start Break/End Break
   * buttons show up on the self-checkin screen. Defaults to false when
   * there's no company yet, same as every other flag here. */
  breakEnabled: boolean;
  /** Overtime policy (companies.ot_hours_per_day/ot_multiplier,
   * 20260825160000_company_overtime_settings.sql) — the admin-set default
   * a "standard day" and OT pay rate use everywhere overtime pay is
   * calculated (Payroll page, an employee's own My Payroll page). Defaults
   * to 8h/1.5x, same as the column defaults, when there's no company yet. */
  otHoursPerDay: number;
  otMultiplier: number;
  /** Statutory contribution rates as a percentage of Basic Salary
   * (companies.pf_rate/ssf_rate/tds_rate,
   * 20260901120000_company_contribution_rates.sql) — one figure per company,
   * set on the Salary Structure page, read by every payroll breakdown.
   * Defaults to the common Nepal figures (PF 10%, SSF 11%, TDS 0%) when
   * there's no company yet. */
  pfRate: number;
  ssfRate: number;
  tdsRate: number;
  /** How an absent day cuts pay (companies.absence_*,
   * 20260902140000_company_absence_policy.sql). Defaults reproduce the
   * previously hard-coded per-hour / calendar-days / basic-only model. */
  absencePolicy: AbsencePolicy;
};

const DEFAULT_CONFIG: CompanyWeekOffConfig = {
  companyId: null,
  weeklyOffDay: null,
  rosterMode: 'monthly',
  breakEnabled: false,
  otHoursPerDay: 8,
  otMultiplier: 1.5,
  pfRate: 10,
  ssfRate: 11,
  tdsRate: 0,
  absencePolicy: DEFAULT_ABSENCE_POLICY,
};

/** The current user's own company_id + weekly_off_day + roster_mode +
 * break_enabled + overtime policy. Reads go through `profiles` first
 * (RLS-scoped to the caller's own row) to find company_id, then `companies`
 * itself (RLS-scoped to id = my_company_id(), see
 * 20260814180000_companies_rls_policies.sql). */
export async function fetchMyCompanyWeekOffConfig(): Promise<CompanyWeekOffConfig> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return DEFAULT_CONFIG;
  const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', auth.user.id).single();
  const companyId = profile?.company_id ?? null;
  if (!companyId) return DEFAULT_CONFIG;
  const { data: company } = await supabase
    .from('companies')
    .select(
      'weekly_off_day, roster_mode, break_enabled, ot_hours_per_day, ot_multiplier, pf_rate, ssf_rate, tds_rate, absence_divisor, absence_basis, absence_partial, half_day_hours'
    )
    .eq('id', companyId)
    .single();
  return {
    companyId,
    weeklyOffDay: company?.weekly_off_day ?? null,
    rosterMode: (company?.roster_mode as RosterMode) ?? 'monthly',
    breakEnabled: company?.break_enabled ?? false,
    otHoursPerDay: company?.ot_hours_per_day ?? DEFAULT_CONFIG.otHoursPerDay,
    otMultiplier: company?.ot_multiplier ?? DEFAULT_CONFIG.otMultiplier,
    pfRate: company?.pf_rate ?? DEFAULT_CONFIG.pfRate,
    ssfRate: company?.ssf_rate ?? DEFAULT_CONFIG.ssfRate,
    tdsRate: company?.tds_rate ?? DEFAULT_CONFIG.tdsRate,
    absencePolicy: {
      divisor: (company?.absence_divisor as AbsencePolicy['divisor']) ?? DEFAULT_ABSENCE_POLICY.divisor,
      basis: (company?.absence_basis as AbsencePolicy['basis']) ?? DEFAULT_ABSENCE_POLICY.basis,
      partial: (company?.absence_partial as AbsencePolicy['partial']) ?? DEFAULT_ABSENCE_POLICY.partial,
      halfDayHours: company?.half_day_hours ?? DEFAULT_ABSENCE_POLICY.halfDayHours,
    },
  };
}

/** Dates within [start, end] (inclusive, 'YYYY-MM-DD') that are a company-wide
 * Week-off: either the weekly recurring day or a company_holidays row. */
export function weekOffDatesInRange(
  start: string,
  end: string,
  weeklyOffDay: number | null,
  holidays: Pick<CompanyHoliday, 'holiday_date'>[]
): Set<string> {
  const set = new Set<string>();
  for (const h of holidays) set.add(h.holiday_date);
  if (weeklyOffDay == null) return set;
  const cur = new Date(start + 'T00:00:00Z');
  const endDate = new Date(end + 'T00:00:00Z');
  while (cur <= endDate) {
    if (cur.getUTCDay() === weeklyOffDay) set.add(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return set;
}

/** employee_id -> Set of 'YYYY-MM-DD' dates covered by an approved leave
 * request, expanded across each request's start_date..end_date.
 *
 * `paidOnly` drops `leave_type: 'unpaid'` — a leave-without-pay day must be
 * treated, for pay, exactly like an absent day, so it must not land in the
 * "paid off" set. Callers that only use the result for an attendance *label*
 * (not pay) leave the option off and get every approved leave. */
export function leaveDatesByEmployee(
  leaveRequests: { employee_id: string; start_date: string; end_date: string; leave_type?: string | null }[],
  opts?: { paidOnly?: boolean }
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const req of leaveRequests) {
    if (opts?.paidOnly && req.leave_type === 'unpaid') continue;
    let set = map.get(req.employee_id);
    if (!set) {
      set = new Set();
      map.set(req.employee_id, set);
    }
    const cur = new Date(req.start_date + 'T00:00:00Z');
    const endDate = new Date(req.end_date + 'T00:00:00Z');
    while (cur <= endDate) {
      set.add(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }
  return map;
}

/** Days within [start, end] an employee is expected to work: every date minus
 * company-wide weekly offs and holidays. Feeds the 'working' absence divisor. */
export function workingDaysInRange(
  start: string,
  end: string,
  weeklyOffDay: number | null,
  holidays: Pick<CompanyHoliday, 'holiday_date'>[]
): number {
  const off = weekOffDatesInRange(start, end, weeklyOffDay, holidays);
  let n = 0;
  const cur = new Date(start + 'T00:00:00Z');
  const endDate = new Date(end + 'T00:00:00Z');
  while (cur <= endDate) {
    if (!off.has(cur.toISOString().slice(0, 10))) n += 1;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return n;
}
