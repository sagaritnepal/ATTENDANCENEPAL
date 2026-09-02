-- How an absent day cuts pay, per company. Until now the Salary Structure
-- employee page hard-coded one model: monthly salary ÷ calendar days, prorated
-- per hour actually worked, on Basic only. These columns make it configurable
-- and let the same rule drive the Payroll report and My Payroll.
--
-- Defaults reproduce the previous hard-coded behaviour exactly, so no
-- company's payroll figures move until an admin changes the policy.
--
--   absence_divisor  what the per-day value divides by:
--                    'calendar' = days in that month (28-31)  [current]
--                    'thirty'   = always 30
--                    'working'  = calendar - weekly offs - holidays
--   absence_basis    what shrinks on an absent day: 'basic' [current] | 'gross' (basic + allowance)
--   absence_partial  'hourly'  = pay per hour worked, so a short day loses only the missing hours [current]
--                    'full_day' = an absent day is a full leave-without-pay day
--   half_day_hours   in 'full_day' mode, worked < this many hours on a working day = half-day deduction (0 = off)
--
-- No RLS change — columns follow companies' existing policies, same as
-- 20260901120000_company_contribution_rates.sql.

alter table companies add column if not exists absence_divisor text not null default 'calendar'
  check (absence_divisor in ('calendar', 'thirty', 'working'));
alter table companies add column if not exists absence_basis text not null default 'basic'
  check (absence_basis in ('basic', 'gross'));
alter table companies add column if not exists absence_partial text not null default 'hourly'
  check (absence_partial in ('hourly', 'full_day'));
alter table companies add column if not exists half_day_hours numeric not null default 0;
