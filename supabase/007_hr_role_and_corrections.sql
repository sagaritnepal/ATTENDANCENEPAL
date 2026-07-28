-- Adds an HR role (same access as admin except Devices and Shift templates,
-- which stay admin-only) and a "missed punch" attendance-correction request
-- flow (mirrors leave_requests). Run once after 004_leave_management.sql and
-- 005_employee_extras.sql.

-- ---------------------------------------------------------------------------
-- HR role
-- ---------------------------------------------------------------------------

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('admin', 'hr', 'employee'));

create or replace function is_admin_or_hr()
returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role in ('admin', 'hr')
  );
$$ language sql stable security definer;

-- Widen these three admin-only policies to admin-or-hr. Devices/Shifts/
-- branches/qr_tokens policies deliberately keep using is_admin() — that's
-- the HR restriction the user asked for.
drop policy if exists "employees: admin full access" on employees;
create policy "employees: admin or hr full access" on employees
  for all using (is_admin_or_hr());

drop policy if exists "leave_requests: admin full access" on leave_requests;
create policy "leave_requests: admin or hr full access" on leave_requests
  for all using (is_admin_or_hr());

drop policy if exists "payroll_summaries: admin full access" on payroll_summaries;
create policy "payroll_summaries: admin or hr full access" on payroll_summaries
  for all using (is_admin_or_hr());

-- ---------------------------------------------------------------------------
-- Attendance correction requests ("I forgot to punch in/out")
-- ---------------------------------------------------------------------------

create table if not exists attendance_correction_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  work_date date not null,
  requested_check_in timestamptz,
  requested_check_out timestamptz,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (requested_check_in is not null or requested_check_out is not null)
);
create index if not exists idx_correction_requests_employee on attendance_correction_requests(employee_id);
create index if not exists idx_correction_requests_status on attendance_correction_requests(status);

alter table attendance_correction_requests enable row level security;

create policy "corrections: admin or hr full access" on attendance_correction_requests
  for all using (is_admin_or_hr());

create policy "corrections: employee read own" on attendance_correction_requests
  for select using (
    employee_id = (select employee_id from profiles where id = auth.uid())
  );

create policy "corrections: employee insert own pending" on attendance_correction_requests
  for insert with check (
    employee_id = (select employee_id from profiles where id = auth.uid())
    and status = 'pending'
  );

create policy "corrections: employee cancel own pending" on attendance_correction_requests
  for delete using (
    employee_id = (select employee_id from profiles where id = auth.uid())
    and status = 'pending'
  );

-- ---------------------------------------------------------------------------
-- payroll_summaries additions: track manual overrides so a later automatic
-- recompute never silently overwrites them (see payroll.sql).
-- ---------------------------------------------------------------------------

alter table payroll_summaries add column if not exists manually_corrected boolean not null default false;
alter table payroll_summaries add column if not exists overtime_approved boolean not null default false;
