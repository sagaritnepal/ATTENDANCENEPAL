-- Real multi-tenancy, part 1 of 4: the `companies` table, a nullable
-- `company_id` on every tenant-scoped table, and the trigger family that
-- stamps it on insert so almost no existing app code needs to change.
--
-- Company_id is never trusted from the caller where a row already chains
-- back to something that has one (an employee, a branch, a device) — it's
-- always re-derived server-side from that reference instead, closing a
-- spoofing class where a client could otherwise claim company_id = mine
-- while employee_id points at someone else's employee. Only "root" rows
-- with no such chain (branches, employees themselves, departments) fall
-- back to the inserting user's own company_id via my_company_id().
--
-- This migration only ADDS nullable columns and triggers — it does not
-- backfill, does not set NOT NULL, and does not touch RLS. See parts 2-4.

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table profiles add column if not exists company_id uuid references companies(id);
alter table employees add column if not exists company_id uuid references companies(id);
alter table branches add column if not exists company_id uuid references companies(id);
alter table devices add column if not exists company_id uuid references companies(id);
alter table shifts add column if not exists company_id uuid references companies(id);
alter table qr_tokens add column if not exists company_id uuid references companies(id);
alter table departments add column if not exists company_id uuid references companies(id);
alter table branch_departments add column if not exists company_id uuid references companies(id);
alter table device_sync_events add column if not exists company_id uuid references companies(id);
alter table attendance_logs add column if not exists company_id uuid references companies(id);
alter table payroll_summaries add column if not exists company_id uuid references companies(id);
alter table leave_requests add column if not exists company_id uuid references companies(id);
alter table attendance_correction_requests add column if not exists company_id uuid references companies(id);
alter table attendance_gps_requests add column if not exists company_id uuid references companies(id);
alter table tasks add column if not exists company_id uuid references companies(id);
alter table task_time_logs add column if not exists company_id uuid references companies(id);
alter table point_redemptions add column if not exists company_id uuid references companies(id);
alter table employee_education add column if not exists company_id uuid references companies(id);
alter table employee_work_experience add column if not exists company_id uuid references companies(id);

create or replace function my_company_id()
returns uuid as $$
  select company_id from profiles where id = auth.uid();
$$ language sql stable security definer set search_path = public;

-- Root tables: no FK chain to derive a company from, so fall back to the
-- inserting user's own company. (profiles is deliberately NOT in this
-- group — its one and only insert path is handle_new_user(), which always
-- sets company_id explicitly itself; see part 4.)
create or replace function stamp_company_id_root()
returns trigger as $$
begin
  if new.company_id is null then
    new.company_id := my_company_id();
  end if;
  if new.company_id is null then
    raise exception 'company_id could not be determined for this insert';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_stamp_company_id on branches;
create trigger trg_stamp_company_id before insert on branches
  for each row execute function stamp_company_id_root();

drop trigger if exists trg_stamp_company_id on employees;
create trigger trg_stamp_company_id before insert on employees
  for each row execute function stamp_company_id_root();

drop trigger if exists trg_stamp_company_id on departments;
create trigger trg_stamp_company_id before insert on departments
  for each row execute function stamp_company_id_root();

-- Branch-chained: always overwrite from branches.company_id, never trust
-- the caller.
create or replace function stamp_company_id_from_branch()
returns trigger as $$
begin
  new.company_id := (select company_id from branches where id = new.branch_id);
  if new.company_id is null then
    raise exception 'No such branch, or branch has no company_id';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_stamp_company_id on devices;
create trigger trg_stamp_company_id before insert on devices
  for each row execute function stamp_company_id_from_branch();

drop trigger if exists trg_stamp_company_id on qr_tokens;
create trigger trg_stamp_company_id before insert on qr_tokens
  for each row execute function stamp_company_id_from_branch();

drop trigger if exists trg_stamp_company_id on branch_departments;
create trigger trg_stamp_company_id before insert on branch_departments
  for each row execute function stamp_company_id_from_branch();

-- Device-chained: device_sync_events always references an existing device.
create or replace function stamp_company_id_from_device()
returns trigger as $$
begin
  new.company_id := (select company_id from devices where id = new.device_id);
  if new.company_id is null then
    raise exception 'No such device, or device has no company_id';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_stamp_company_id on device_sync_events;
create trigger trg_stamp_company_id before insert on device_sync_events
  for each row execute function stamp_company_id_from_device();

-- Employee-chained: always overwrite from employees.company_id, never
-- trust the caller. This needs no auth.uid() at all, which is why
-- zkteco-bridge's attendance_logs upsert (service-role, no session) needs
-- no code changes to stay correctly scoped.
create or replace function stamp_company_id_from_employee()
returns trigger as $$
begin
  new.company_id := (select company_id from employees where id = new.employee_id);
  if new.company_id is null then
    raise exception 'No such employee, or employee has no company_id';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_stamp_company_id on attendance_logs;
create trigger trg_stamp_company_id before insert on attendance_logs
  for each row execute function stamp_company_id_from_employee();

drop trigger if exists trg_stamp_company_id on payroll_summaries;
create trigger trg_stamp_company_id before insert on payroll_summaries
  for each row execute function stamp_company_id_from_employee();

drop trigger if exists trg_stamp_company_id on leave_requests;
create trigger trg_stamp_company_id before insert on leave_requests
  for each row execute function stamp_company_id_from_employee();

drop trigger if exists trg_stamp_company_id on task_time_logs;
create trigger trg_stamp_company_id before insert on task_time_logs
  for each row execute function stamp_company_id_from_employee();

drop trigger if exists trg_stamp_company_id on point_redemptions;
create trigger trg_stamp_company_id before insert on point_redemptions
  for each row execute function stamp_company_id_from_employee();

drop trigger if exists trg_stamp_company_id on employee_education;
create trigger trg_stamp_company_id before insert on employee_education
  for each row execute function stamp_company_id_from_employee();

drop trigger if exists trg_stamp_company_id on employee_work_experience;
create trigger trg_stamp_company_id before insert on employee_work_experience
  for each row execute function stamp_company_id_from_employee();

drop trigger if exists trg_stamp_company_id on attendance_correction_requests;
create trigger trg_stamp_company_id before insert on attendance_correction_requests
  for each row execute function stamp_company_id_from_employee();

drop trigger if exists trg_stamp_company_id on attendance_gps_requests;
create trigger trg_stamp_company_id before insert on attendance_gps_requests
  for each row execute function stamp_company_id_from_employee();

-- Assignee-chained: tasks keys off assigned_to instead of employee_id.
create or replace function stamp_company_id_from_assignee()
returns trigger as $$
begin
  new.company_id := (select company_id from employees where id = new.assigned_to);
  if new.company_id is null then
    raise exception 'No such employee, or employee has no company_id';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_stamp_company_id on tasks;
create trigger trg_stamp_company_id before insert on tasks
  for each row execute function stamp_company_id_from_assignee();

-- Hybrid: shifts.employee_id is nullable (department-template rows have it
-- null) — derive from the employee when present, else fall back like a
-- root table.
create or replace function stamp_company_id_shifts()
returns trigger as $$
begin
  if new.employee_id is not null then
    new.company_id := (select company_id from employees where id = new.employee_id);
  else
    new.company_id := coalesce(new.company_id, my_company_id());
  end if;
  if new.company_id is null then
    raise exception 'company_id could not be determined for this shift';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_stamp_company_id on shifts;
create trigger trg_stamp_company_id before insert on shifts
  for each row execute function stamp_company_id_shifts();
