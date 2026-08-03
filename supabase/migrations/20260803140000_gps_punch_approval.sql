-- Every GPS (mobile) check-in/check-out now goes into a pending-approval
-- queue instead of landing directly in attendance_logs. Admin/HR review each
-- one (mirrors the existing "Fix a Missed Punch" corrections flow below) and
-- only an approved request produces an actual attendance_logs row that
-- payroll picks up. Requested: employees checking in from their phone should
-- always be reviewable by Admin, not just when they're outside a branch's
-- geofence (see 20260803130000, which already dropped the distance check).

create table if not exists attendance_gps_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  punch_type text not null check (punch_type in ('0', '1')),
  punch_time timestamptz not null,
  lat double precision,
  lng double precision,
  accuracy_m double precision,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_gps_requests_employee on attendance_gps_requests(employee_id);
create index if not exists idx_gps_requests_status on attendance_gps_requests(status);

alter table attendance_gps_requests enable row level security;

create policy "gps_requests: admin or hr full access" on attendance_gps_requests
  for all using (is_admin_or_hr());

create policy "gps_requests: employee read own" on attendance_gps_requests
  for select using (
    employee_id = (select employee_id from profiles where id = auth.uid())
  );

create policy "gps_requests: employee insert own pending" on attendance_gps_requests
  for insert with check (
    employee_id = (select employee_id from profiles where id = auth.uid())
    and status = 'pending'
  );

-- Employees no longer insert attendance_logs rows directly for GPS punches —
-- only approve_attendance_gps_request() does, once Admin/HR approves. Drop
-- the old direct-insert policy so a client can't bypass review; admin still
-- has full access via the existing "attendance_logs: admin full access"
-- policy, and zkteco device sync is unaffected (it doesn't go through RLS).
drop policy if exists "attendance_logs: employee insert own" on attendance_logs;

-- Approves a pending GPS request: inserts the punch into attendance_logs
-- (still subject to the enforce_geofence trigger, which no longer rejects on
-- distance — see 20260803130000) and marks the request reviewed.
-- security definer + an explicit is_admin_or_hr() check, since
-- attendance_logs itself only grants writes to is_admin() and HR must be
-- able to approve too.
create or replace function approve_attendance_gps_request(p_request_id uuid)
returns void as $$
declare
  req record;
  reviewer uuid := auth.uid();
begin
  if not is_admin_or_hr() then
    raise exception 'Not authorized';
  end if;

  select * into req from attendance_gps_requests where id = p_request_id and status = 'pending';
  if not found then
    raise exception 'GPS request not found or already reviewed';
  end if;

  insert into attendance_logs (employee_id, punch_time, punch_type, method, lat, lng, accuracy_m)
  values (req.employee_id, req.punch_time, req.punch_type, 'gps', req.lat, req.lng, req.accuracy_m);

  update attendance_gps_requests
  set status = 'approved', reviewed_by = reviewer, reviewed_at = now()
  where id = p_request_id;
end;
$$ language plpgsql security definer;
