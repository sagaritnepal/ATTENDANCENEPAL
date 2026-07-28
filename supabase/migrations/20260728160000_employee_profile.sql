-- Employee self-service profile: address/joining-date fields, a point
-- redemption request flow, and a security-definer function for the only
-- columns an employee may edit on their own row (never a raw RLS UPDATE
-- policy -- see the comment below on why). Run once after
-- 20260728150000_correction_location.sql.

alter table employees add column if not exists address text;
alter table employees add column if not exists date_of_joining date;
alter table employees add column if not exists resigned_at date;

-- ---------------------------------------------------------------------------
-- Point redemptions ("I want to cash in N points")
-- ---------------------------------------------------------------------------

create table if not exists point_redemptions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  points_requested integer not null check (points_requested > 0),
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_point_redemptions_employee on point_redemptions(employee_id);
create index if not exists idx_point_redemptions_status on point_redemptions(status);

alter table point_redemptions enable row level security;

create policy "point_redemptions: admin or hr full access" on point_redemptions
  for all using (is_admin_or_hr());

create policy "point_redemptions: employee read own" on point_redemptions
  for select using (
    employee_id = (select employee_id from profiles where id = auth.uid())
  );

create policy "point_redemptions: employee insert own pending" on point_redemptions
  for insert with check (
    employee_id = (select employee_id from profiles where id = auth.uid())
    and status = 'pending'
  );

-- ---------------------------------------------------------------------------
-- Self-service profile update. There is deliberately no "employees: self
-- update" RLS policy: RLS filters rows, not columns, so a direct UPDATE
-- grant on their own row would also let an employee rewrite branch_id
-- (spoofing which branch's geofence they're checked against),
-- fingerprint_id, or status. This function hardcodes the only three
-- columns an employee can ever touch on themselves, same trust model as
-- start_task_timer()/submit_task().
-- ---------------------------------------------------------------------------

create or replace function update_my_profile(p_phone text, p_address text, p_photo_url text)
returns void as $$
declare
  emp_id uuid;
begin
  select employee_id into emp_id from profiles where id = auth.uid();
  if emp_id is null then
    raise exception 'No employee linked to this account';
  end if;

  update employees
  set phone = p_phone, address = p_address, profile_photo_url = p_photo_url
  where id = emp_id;
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------------------------
-- Leaderboard now reflects current balance (earned minus redeemed), and
-- includes the photo so it can be shown next to each row. Redefined here
-- rather than editing 20260728130000_tasks_and_rewards.sql, same as
-- submit_task() was redefined in 20260728140000_task_time_tracking.sql.
-- ---------------------------------------------------------------------------

create or replace function get_leaderboard()
returns table(employee_id uuid, name text, department text, total_points bigint, tasks_completed bigint, profile_photo_url text) as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  return query
    select
      e.id,
      e.name,
      e.department,
      coalesce(sum(t.points) filter (where t.status = 'approved'), 0)::bigint
        - coalesce((select sum(pr.points_requested) from point_redemptions pr where pr.employee_id = e.id and pr.status = 'approved'), 0)::bigint,
      count(*) filter (where t.status = 'approved')::bigint,
      e.profile_photo_url
    from employees e
    left join tasks t on t.assigned_to = e.id
    where e.status = 'active'
    group by e.id, e.name, e.department, e.profile_photo_url
    order by 4 desc, e.name asc;
end;
$$ language plpgsql stable security definer;
