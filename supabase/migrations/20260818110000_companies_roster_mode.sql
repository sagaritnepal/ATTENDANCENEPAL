-- Which roster drives real employee shifts for this company: the exact-date
-- Weekly/Monthly Roster (employee_daily_shifts, today's only model) or the
-- new recurring employee_weekly_pattern (20260818100000). Mutually
-- exclusive by design — see resolveShiftForDate() in lib/shift.ts and
-- find_employee_shift_for_date() (20260818120000), both of which only
-- consult employee_weekly_pattern when this is 'weekly'.
--
-- Defaults every existing company to 'monthly' — today's exact-date
-- behavior, completely unchanged until an admin explicitly switches modes.
--
-- No new RLS: "companies: admin update own" (20260814180000) already covers
-- writing this column.

alter table companies add column if not exists roster_mode text not null default 'monthly'
  check (roster_mode in ('weekly', 'monthly'));
