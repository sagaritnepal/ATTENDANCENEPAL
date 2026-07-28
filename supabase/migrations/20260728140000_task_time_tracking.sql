-- Lets employees create their own tasks (in addition to HR-assigned ones)
-- and track hours worked via a live start/stop timer. Run once after
-- 20260728130000_tasks_and_rewards.sql.

alter table tasks add column if not exists source text not null default 'assigned' check (source in ('assigned', 'self'));

-- The only way a self-created task can't be used to self-award: forced to
-- zero points and pending status at insert; HR decides the real point value
-- at approval time (tasks page's Approve action now takes a points input).
create policy "tasks: employee create own" on tasks
  for insert with check (
    assigned_to = (select employee_id from profiles where id = auth.uid())
    and source = 'self'
    and points = 0
    and status = 'pending'
  );

create table if not exists task_time_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id),
  employee_id uuid not null references employees(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_task_time_logs_task on task_time_logs(task_id);
create index if not exists idx_task_time_logs_employee on task_time_logs(employee_id);

alter table task_time_logs enable row level security;

create policy "task_time_logs: admin or hr full access" on task_time_logs
  for all using (is_admin_or_hr());

create policy "task_time_logs: employee read own" on task_time_logs
  for select using (
    employee_id = (select employee_id from profiles where id = auth.uid())
  );

-- No employee insert/update policy here either — same reasoning as tasks
-- itself. These two functions do the only two employee-initiated
-- transitions, with ownership/one-running-timer checks hardcoded in the
-- function body.

create or replace function start_task_timer(p_task_id uuid)
returns uuid as $$
declare
  emp_id uuid;
  task_status text;
  new_log_id uuid;
begin
  select employee_id into emp_id from profiles where id = auth.uid();
  if emp_id is null then
    raise exception 'No employee linked to this account';
  end if;

  select status into task_status from tasks where id = p_task_id and assigned_to = emp_id;
  if task_status is null then
    raise exception 'Task not found';
  end if;
  if task_status not in ('pending', 'in_progress') then
    raise exception 'This task is no longer active';
  end if;

  if exists (select 1 from task_time_logs where employee_id = emp_id and ended_at is null) then
    raise exception 'Stop your currently running timer before starting another task';
  end if;

  if task_status = 'pending' then
    update tasks set status = 'in_progress' where id = p_task_id;
  end if;

  insert into task_time_logs (task_id, employee_id, started_at)
  values (p_task_id, emp_id, now())
  returning id into new_log_id;

  return new_log_id;
end;
$$ language plpgsql security definer;

create or replace function stop_task_timer(p_log_id uuid)
returns void as $$
declare
  emp_id uuid;
begin
  select employee_id into emp_id from profiles where id = auth.uid();
  update task_time_logs set ended_at = now()
  where id = p_log_id and employee_id = emp_id and ended_at is null;
  if not found then
    raise exception 'Timer not found or already stopped';
  end if;
end;
$$ language plpgsql security definer;

-- Redefined (not by editing 20260728130000_tasks_and_rewards.sql) to also
-- auto-stop a running timer, so "Mark as done" always leaves a clean
-- stopped state even if the employee forgot to stop it themselves.
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

  update task_time_logs set ended_at = now()
  where task_id = p_task_id and employee_id = emp_id and ended_at is null;
end;
$$ language plpgsql security definer;
