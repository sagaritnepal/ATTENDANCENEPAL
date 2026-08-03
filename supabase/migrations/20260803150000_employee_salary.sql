-- Adds a salary field Admin/HR set on an employee's record (edited from the
-- Employees > employee detail page) and the employee can see on their own
-- Profile tab. RLS needs no changes: "employees: admin full access" already
-- covers the write, and "employees: self read" is a row-level (not
-- column-level) policy, so an employee reading their own row already gets
-- this column too, same as every other employee column.

alter table employees add column if not exists salary numeric;
