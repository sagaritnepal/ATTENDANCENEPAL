-- Real multi-tenancy, part 2 of 4: backfill existing data into the two real
-- companies, lock company_id to NOT NULL everywhere, and swap the global
-- uniqueness constraints that would otherwise collide across tenants for
-- composite (company_id, ...) ones.
--
-- Only two real companies exist today. This is hand-rolled against the
-- specific accounts involved, not a generic distinct-company_name insert,
-- because 4 of 7 profiles have company_name = null (they were created by
-- the admin-created-login flow, which never captured it) and one auth user
-- has no profiles row at all — a name-driven backfill can't distinguish
-- any of that correctly.

do $$
declare
  v_chandan_id uuid;
  v_ashadeep_id uuid;
begin
  insert into companies (name, created_by)
  values ('HAMRO G&G AUTO ENTERPRISES', 'fa3cf288-bf86-470d-a27f-bdd77c0a8860')
  returning id into v_chandan_id;

  insert into companies (name, created_by)
  values ('ASHADEEP FOUNDATION', '4265e496-a95e-4e67-951d-7d9e6e4001c2')
  returning id into v_ashadeep_id;

  -- The two named profiles get their own company explicitly. Ashadeep is
  -- promoted to admin of their own (currently empty) company here, per the
  -- new self-registration behavior this whole migration exists to support.
  update profiles set company_id = v_chandan_id where id = 'fa3cf288-bf86-470d-a27f-bdd77c0a8860';
  update profiles set company_id = v_ashadeep_id, role = 'admin' where id = '4265e496-a95e-4e67-951d-7d9e6e4001c2';

  -- Every other existing profile (admin-created teammates, company_name
  -- null) belongs to Chandan's company — catch-all on whatever's still
  -- null. sagaritnepal@gmail.com has no profiles row today, so this simply
  -- has nothing to match for it — left untouched, as intended.
  update profiles set company_id = v_chandan_id where company_id is null;

  update employees set company_id = v_chandan_id where company_id is null;
  update branches set company_id = v_chandan_id where company_id is null;
  update devices set company_id = v_chandan_id where company_id is null;
  update shifts set company_id = v_chandan_id where company_id is null;
  update qr_tokens set company_id = v_chandan_id where company_id is null;
  update departments set company_id = v_chandan_id where company_id is null;
  update branch_departments set company_id = v_chandan_id where company_id is null;
  update device_sync_events set company_id = v_chandan_id where company_id is null;
  update attendance_logs set company_id = v_chandan_id where company_id is null;
  update payroll_summaries set company_id = v_chandan_id where company_id is null;
  update leave_requests set company_id = v_chandan_id where company_id is null;
  update attendance_correction_requests set company_id = v_chandan_id where company_id is null;
  update attendance_gps_requests set company_id = v_chandan_id where company_id is null;
  update tasks set company_id = v_chandan_id where company_id is null;
  update task_time_logs set company_id = v_chandan_id where company_id is null;
  update point_redemptions set company_id = v_chandan_id where company_id is null;
  update employee_education set company_id = v_chandan_id where company_id is null;
  update employee_work_experience set company_id = v_chandan_id where company_id is null;
end $$;

alter table profiles alter column company_id set not null;
alter table employees alter column company_id set not null;
alter table branches alter column company_id set not null;
alter table devices alter column company_id set not null;
alter table shifts alter column company_id set not null;
alter table qr_tokens alter column company_id set not null;
alter table departments alter column company_id set not null;
alter table branch_departments alter column company_id set not null;
alter table device_sync_events alter column company_id set not null;
alter table attendance_logs alter column company_id set not null;
alter table payroll_summaries alter column company_id set not null;
alter table leave_requests alter column company_id set not null;
alter table attendance_correction_requests alter column company_id set not null;
alter table attendance_gps_requests alter column company_id set not null;
alter table tasks alter column company_id set not null;
alter table task_time_logs alter column company_id set not null;
alter table point_redemptions alter column company_id set not null;
alter table employee_education alter column company_id set not null;
alter table employee_work_experience alter column company_id set not null;

-- Composite unique constraints, replacing global ones that would now
-- collide across tenants. Everything else keyed off employee_id (shifts,
-- attendance_logs, payroll_summaries, profiles.employee_id) stays as-is —
-- one employee_id can only ever belong to one company, so no cross-tenant
-- collision is possible there. qr_tokens.token also stays globally unique
-- on purpose: it's a random bearer secret, and global uniqueness is
-- stronger isolation, not weaker.

alter table branches drop constraint if exists branches_branch_code_key;
alter table branches add constraint uq_branches_company_code unique (company_id, branch_code);

alter table departments drop constraint if exists departments_name_key;
alter table departments add constraint uq_departments_company_name unique (company_id, name);

alter table employees drop constraint if exists employees_employee_code_key;
alter table employees add constraint uq_employees_company_code unique (company_id, employee_code);

alter table employees drop constraint if exists employees_email_key;
alter table employees add constraint uq_employees_company_email unique (company_id, email);

alter table employees drop constraint if exists employees_fingerprint_id_key;
alter table employees add constraint uq_employees_company_fingerprint unique (company_id, fingerprint_id);

-- The existing "profiles: self update" policy (schema.sql) is `using (id =
-- auth.uid())` with no column restriction — RLS filters rows, not columns,
-- so as written it lets any signed-in user set their OWN role or (now)
-- company_id via a direct client-side update() call, e.g. self-promoting
-- to admin or jumping into another company's tenant. This was already a
-- privilege-escalation bug before this migration; it becomes a direct
-- bypass of every company_id check just added if not closed now. Fixed the
-- standard Postgres way — column-level GRANT composes with RLS's row-level
-- filter, restricting self-update to genuinely-safe display columns only.
revoke update on profiles from authenticated;
grant update (full_name, company_name, pan_no, location) on profiles to authenticated;
