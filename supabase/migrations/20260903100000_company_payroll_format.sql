-- One customer (ASHADEEP) runs a fixed-salary "Staff Salary Sheet" instead of
-- the standard attendance-based Payroll report: flat basic + a flat dearness
-- allowance + a 20%/11% SSF gross-up, with NO attendance proration at all.
-- It contradicts the standard report in almost every way and suits no one
-- else, so it is gated per company rather than offered as an option.
--
--   payroll_format = 'staff_salary_sheet'  -> the Payroll Report page renders
--     <StaffSalarySheet> instead of the standard report.
--   dearness_allowance                     -> the flat monthly allowance added
--     to every employee's basic in that sheet.
--
-- New columns follow companies' existing RLS (read own / admin update own,
-- 20260814180000_companies_rls_policies.sql), same as the OT/contribution
-- settings before them. After this runs, flip the one customer:
--
--   update companies
--   set payroll_format = 'staff_salary_sheet', dearness_allowance = 7380
--   where name = 'ASHADEEP';

alter table companies add column if not exists payroll_format text not null default 'standard'
  check (payroll_format in ('standard', 'staff_salary_sheet'));
alter table companies add column if not exists dearness_allowance numeric not null default 0;
