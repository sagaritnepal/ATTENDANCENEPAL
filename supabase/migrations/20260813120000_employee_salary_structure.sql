-- Salary breakdown fields, per employee — feeds the split salary header on
-- the employee portal (My Payroll, web + mobile): Basic Salary (existing
-- `salary` column) + Allowance = Total, minus PF/SSF/TDS (each a percentage
-- of Basic Salary), plus OT = Total Salary. Rates default to the common
-- Nepal statutory figures (PF 10%, SSF 11%) but are editable per employee
-- since actual contribution/tax terms vary by company and individual.
-- No RLS changes needed: same columns-follow-row-policy reasoning as
-- pan_no/ssf_no (20260805150000).

alter table employees add column if not exists allowance numeric default 0;
alter table employees add column if not exists pf_rate numeric default 10;
alter table employees add column if not exists ssf_rate numeric default 11;
alter table employees add column if not exists tds_rate numeric default 0;
