-- One employee record can be linked to at most one login account (multiple
-- profiles with employee_id = null, e.g. admin accounts, are unaffected — a
-- unique constraint treats nulls as distinct). Prevents two different people
-- from registering against the same employee and sharing that employee's
-- attendance/leave identity. Run once after schema.sql.

alter table profiles add constraint uq_profiles_employee unique (employee_id);
