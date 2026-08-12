import { supabase } from './supabase';
import type { CompanyHoliday } from './types';

/** Company-wide Week-off: a recurring weekly day (0=Sunday..6=Saturday, from
 * companies.weekly_off_day) plus ad-hoc dates (company_holidays). Applies to
 * every employee at once — distinct from the per-employee roster Week Off
 * (employee_daily_shifts.shift_id = null, see lib/shift.ts's WEEK_OFF). */
export type CompanyWeekOffConfig = {
  companyId: string | null;
  weeklyOffDay: number | null;
};

/** The current user's own company_id + weekly_off_day. `companies` has no
 * RLS of its own (see 20260805090000_companies_and_tenant_columns.sql), so
 * this goes through `profiles` (RLS-scoped to the caller's own row) first
 * rather than trusting an unfiltered `companies` select. */
export async function fetchMyCompanyWeekOffConfig(): Promise<CompanyWeekOffConfig> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { companyId: null, weeklyOffDay: null };
  const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', auth.user.id).single();
  const companyId = profile?.company_id ?? null;
  if (!companyId) return { companyId: null, weeklyOffDay: null };
  const { data: company } = await supabase.from('companies').select('weekly_off_day').eq('id', companyId).single();
  return { companyId, weeklyOffDay: company?.weekly_off_day ?? null };
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
 * request, expanded across each request's start_date..end_date. */
export function leaveDatesByEmployee(leaveRequests: { employee_id: string; start_date: string; end_date: string }[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const req of leaveRequests) {
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
