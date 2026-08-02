-- Departments: a small reference list so Department fields become a
-- dropdown instead of free text, plus which departments apply to which
-- branch (a department can span more than one branch).

create table if not exists departments (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists branch_departments (
  branch_id uuid not null references branches(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  primary key (branch_id, department_id)
);

alter table departments enable row level security;
alter table branch_departments enable row level security;

drop policy if exists "departments: admin full access" on departments;
create policy "departments: admin full access" on departments
  for all using (is_admin()) with check (is_admin());
drop policy if exists "departments: read" on departments;
create policy "departments: read" on departments
  for select using (true);

drop policy if exists "branch_departments: admin full access" on branch_departments;
create policy "branch_departments: admin full access" on branch_departments
  for all using (is_admin()) with check (is_admin());
drop policy if exists "branch_departments: read" on branch_departments;
create policy "branch_departments: read" on branch_departments
  for select using (true);
