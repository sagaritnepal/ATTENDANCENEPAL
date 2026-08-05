-- PAN (tax) number and SSF (Social Security Fund) number, per employee —
-- distinct from profiles.pan_no (20260804100000), which is a field on the
-- login-account's own admin-managed "company details" popup, not on the
-- employee HR record itself. RLS needs no changes: "employees: admin or hr
-- full access" already covers the write, and "employees: self read" is a
-- row-level (not column-level) policy, so an employee reading their own row
-- already gets these columns too, same as salary.

alter table employees add column if not exists pan_no text;
alter table employees add column if not exists ssf_no text;
