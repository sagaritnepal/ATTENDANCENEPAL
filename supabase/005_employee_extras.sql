-- Adds phone number to employees, and makes shift assignment per-employee
-- well-defined: at most one shift row per specific employee (department-
-- level template rows, where employee_id is null, are unaffected — a
-- unique constraint treats multiple nulls as distinct). Run once after
-- schema.sql.

alter table employees add column if not exists phone text;

alter table shifts add constraint uq_shifts_employee unique (employee_id);
