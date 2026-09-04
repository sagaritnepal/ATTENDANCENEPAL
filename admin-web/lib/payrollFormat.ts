import { supabase } from './supabase';

/**
 * Which payroll report the current user's company sees.
 *
 * 'standard' — the attendance-based Payroll report every company gets.
 * 'staff_salary_sheet' — a fixed-salary sheet enabled for exactly one
 *   customer via `update companies set payroll_format = 'staff_salary_sheet'`.
 *
 * Deliberately isolated from lib/weekOff.ts's shared config fetch: only the
 * Payroll Report page calls this, and a not-yet-applied migration (or no
 * company) degrades to 'standard' rather than breaking anything.
 */
export type PayrollFormat = 'standard' | 'staff_salary_sheet';

export async function fetchCompanyPayrollFormat(): Promise<PayrollFormat> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return 'standard';
  const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', auth.user.id).single();
  if (!profile?.company_id) return 'standard';
  const { data } = await supabase.from('companies').select('payroll_format').eq('id', profile.company_id).single();
  return (data?.payroll_format as PayrollFormat) ?? 'standard';
}
