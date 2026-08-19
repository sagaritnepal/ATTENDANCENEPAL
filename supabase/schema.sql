-- Attendance Management System v2 — Supabase (Postgres) schema
-- Run via `supabase db push` or paste into the SQL editor of a new Supabase project.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------

create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  branch_code text unique not null,
  latitude double precision not null,
  longitude double precision not null,
  radius_meters integer not null default 150,
  created_at timestamptz not null default now()
);

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text unique not null,
  name text not null,
  email text unique,
  department text,
  branch_id uuid references branches(id),
  fingerprint_id text unique,
  profile_photo_url text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);

-- 1:1 with auth.users; role drives RLS everywhere else.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  employee_id uuid references employees(id),
  role text not null default 'employee' check (role in ('admin', 'employee')),
  created_at timestamptz not null default now()
);

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  branch_id uuid not null references branches(id),
  ip_address text not null default '192.168.1.201',
  port integer not null default 4370,
  status text not null default 'offline' check (status in ('online', 'offline')),
  last_sync timestamptz
);
create index if not exists idx_devices_branch_status on devices(branch_id, status);

create table if not exists shifts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'fixed' check (type in ('fixed', 'flexible', 'rotational')),
  start_time time not null,
  end_time time not null,
  grace_minutes integer not null default 10,
  department text,
  employee_id uuid references employees(id)
);

create table if not exists qr_tokens (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  token text unique not null default encode(gen_random_bytes(16), 'hex'),
  expires_at timestamptz not null default (now() + interval '60 seconds'),
  created_at timestamptz not null default now()
);
create index if not exists idx_qr_tokens_branch on qr_tokens(branch_id);

create table if not exists attendance_logs (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  device_id uuid references devices(id),
  punch_time timestamptz not null,
  punch_type text not null check (punch_type in ('0', '1')), -- 0 = in, 1 = out
  method text not null default 'zkteco' check (method in ('zkteco', 'gps', 'qr', 'selfie')),
  verification_mode text default '1',
  lat double precision,
  lng double precision,
  accuracy_m double precision,
  qr_token_id uuid references qr_tokens(id),
  selfie_url text,
  match_score double precision,
  created_at timestamptz not null default now(),
  unique (employee_id, punch_time)
);
create index if not exists idx_logs_employee_time on attendance_logs(employee_id, punch_time);

create table if not exists payroll_summaries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  work_date date not null,
  shift_name text,
  check_in timestamptz,
  check_out timestamptz,
  total_hours numeric(6,2) not null default 0,
  is_late boolean not null default false,
  late_minutes integer not null default 0,
  is_early_departure boolean not null default false,
  early_departure_minutes integer not null default 0,
  overtime_hours numeric(6,2) not null default 0,
  computed_at timestamptz not null default now(),
  unique (employee_id, work_date)
);

-- ---------------------------------------------------------------------------
-- Server-side geofence guard: re-validates GPS punches so a modified client
-- can't fake presence by sending arbitrary lat/lng.
-- ---------------------------------------------------------------------------

create or replace function enforce_geofence()
returns trigger as $$
declare
  b branches%rowtype;
  emp employees%rowtype;
  dist_meters double precision;
begin
  if new.method = 'gps' then
    select * into emp from employees where id = new.employee_id;
    select * into b from branches where id = emp.branch_id;
    if b.id is null then
      raise exception 'Employee has no assigned branch for geofence check';
    end if;
    -- haversine distance in meters
    dist_meters := 6371000 * acos(
      cos(radians(b.latitude)) * cos(radians(new.lat)) *
      cos(radians(new.lng) - radians(b.longitude)) +
      sin(radians(b.latitude)) * sin(radians(new.lat))
    );
    if dist_meters > b.radius_meters then
      raise exception 'Punch rejected: outside branch geofence (% m > % m)', dist_meters, b.radius_meters;
    end if;
  end if;

  if new.method = 'qr' then
    if not exists (
      select 1 from qr_tokens
      where id = new.qr_token_id and expires_at > now()
    ) then
      raise exception 'Punch rejected: QR token expired or invalid';
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_enforce_geofence on attendance_logs;
create trigger trg_enforce_geofence
  before insert on attendance_logs
  for each row execute function enforce_geofence();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table profiles enable row level security;
alter table employees enable row level security;
alter table branches enable row level security;
alter table devices enable row level security;
alter table shifts enable row level security;
alter table qr_tokens enable row level security;
alter table attendance_logs enable row level security;
alter table payroll_summaries enable row level security;

create or replace function is_admin()
returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql stable security definer;

create policy "profiles: self or admin read" on profiles
  for select using (id = auth.uid() or is_admin());
create policy "profiles: self update" on profiles
  for update using (id = auth.uid());

create policy "employees: admin full access" on employees
  for all using (is_admin());
create policy "employees: self read" on employees
  for select using (
    id = (select employee_id from profiles where id = auth.uid())
  );

create policy "branches/devices/shifts/qr: admin full access" on branches
  for all using (is_admin());
create policy "branches: employee read" on branches
  for select using (true);

create policy "devices: admin full access" on devices
  for all using (is_admin());

create policy "shifts: admin full access" on shifts
  for all using (is_admin());
create policy "shifts: employee read own or dept" on shifts
  for select using (true);

create policy "qr_tokens: admin full access" on qr_tokens
  for all using (is_admin());
create policy "qr_tokens: employee read active" on qr_tokens
  for select using (expires_at > now());

create policy "attendance_logs: admin full access" on attendance_logs
  for all using (is_admin());
create policy "attendance_logs: employee insert own" on attendance_logs
  for insert with check (
    employee_id = (select employee_id from profiles where id = auth.uid())
  );
create policy "attendance_logs: employee read own" on attendance_logs
  for select using (
    employee_id = (select employee_id from profiles where id = auth.uid())
  );

create policy "payroll_summaries: admin full access" on payroll_summaries
  for all using (is_admin());
create policy "payroll_summaries: employee read own" on payroll_summaries
  for select using (
    employee_id = (select employee_id from profiles where id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Payroll calculation (compute_payroll_summaries, a plpgsql port of calc.js)
-- lives in supabase/payroll.sql — run that file next.
-- ---------------------------------------------------------------------------
