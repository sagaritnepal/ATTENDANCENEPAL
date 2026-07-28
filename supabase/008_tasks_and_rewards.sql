-- Task assignment + points reward system. Run once after
-- 007_hr_role_and_corrections.sql.

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  assigned_to uuid not null references employees(id),
  assigned_by uuid references profiles(id),
  points integer not null default 10 check (points >= 0),
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'submitted', 'approved', 'rejected')),
  due_date date,
  work_notes text,
  review_note text,
  submitted_at timestamptz,
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_tasks_assigned_to on tasks(assigned_to);
create index if not exists idx_tasks_status on tasks(status);

alter table tasks enable row level security;

create policy "tasks: admin or hr full access" on tasks
  for all using (is_admin_or_hr());

create policy "tasks: employee read own" on tasks
  for select using (
    assigned_to = (select employee_id from profiles where id = auth.uid())
  );

-- Deliberately no employee insert/update policy: RLS filters rows, not
-- columns, so a direct UPDATE grant would let an employee rewrite `points`
-- or set status = 'approved' themselves in the same request. These two
-- functions do the two employee-initiated transitions instead, with the
-- allowed column set and ownership/status checks hardcoded in the function
-- body (same trust model schema.sql's is_admin() already uses).

create or replace function start_task(p_task_id uuid)
returns void as $$
declare
  emp_id uuid;
begin
  select employee_id into emp_id from profiles where id = auth.uid();
  update tasks set status = 'in_progress'
  where id = p_task_id and assigned_to = emp_id and status = 'pending';
  if not found then
    raise exception 'Task not found or not eligible to start';
  end if;
end;
$$ language plpgsql security definer;

create or replace function submit_task(p_task_id uuid, p_work_notes text default null)
returns void as $$
declare
  emp_id uuid;
begin
  select employee_id into emp_id from profiles where id = auth.uid();
  update tasks set status = 'submitted', work_notes = p_work_notes, submitted_at = now()
  where id = p_task_id and assigned_to = emp_id and status in ('pending', 'in_progress');
  if not found then
    raise exception 'Task not found or not eligible to submit';
  end if;
end;
$$ language plpgsql security definer;

-- Company-wide leaderboard. `employees: self read` (schema.sql) limits a
-- plain employee to their own row, so a client-side join across all
-- employees wouldn't work for a leaderboard — this bypasses that RLS the
-- same way is_admin() bypasses profiles' RLS, but only ever exposes
-- name/department/points, never full employee records, and explicitly
-- requires a real session (security definer doesn't gate on auth by
-- itself the way RLS does).
create or replace function get_leaderboard()
returns table(employee_id uuid, name text, department text, total_points bigint, tasks_completed bigint) as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  return query
    select
      e.id,
      e.name,
      e.department,
      coalesce(sum(t.points) filter (where t.status = 'approved'), 0)::bigint,
      count(*) filter (where t.status = 'approved')::bigint
    from employees e
    left join tasks t on t.assigned_to = e.id
    where e.status = 'active'
    group by e.id, e.name, e.department
    order by 4 desc, e.name asc;
end;
$$ language plpgsql stable security definer;
