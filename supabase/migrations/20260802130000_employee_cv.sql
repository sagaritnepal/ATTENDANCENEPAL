-- Employee CV/Profile: emergency contact + skills live directly on
-- employees (small, single-valued), education and work experience are
-- separate tables since an employee can have several of each. Admin/HR-only
-- for now (edited from the new /employees/[id] CV page in the admin
-- console) -- no employee self-service surface yet. Run once after
-- 20260728170000_profile_full_edit.sql.

alter table employees add column if not exists emergency_contact_name text;
alter table employees add column if not exists emergency_contact_relationship text;
alter table employees add column if not exists emergency_contact_phone text;
alter table employees add column if not exists skills text[] not null default '{}';

create table if not exists employee_education (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  degree text not null,
  institution text,
  year integer,
  created_at timestamptz not null default now()
);
create index if not exists idx_employee_education_employee on employee_education(employee_id);

create table if not exists employee_work_experience (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  employer text not null,
  role text,
  start_date date,
  end_date date,
  created_at timestamptz not null default now()
);
create index if not exists idx_employee_work_experience_employee on employee_work_experience(employee_id);

alter table employee_education enable row level security;
alter table employee_work_experience enable row level security;

drop policy if exists "employee_education: admin or hr full access" on employee_education;
create policy "employee_education: admin or hr full access" on employee_education
  for all using (is_admin_or_hr());

drop policy if exists "employee_work_experience: admin or hr full access" on employee_work_experience;
create policy "employee_work_experience: admin or hr full access" on employee_work_experience
  for all using (is_admin_or_hr());
