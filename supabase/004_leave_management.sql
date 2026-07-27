-- Leave management — the "leaves" piece of the original architecture guide
-- that was never built. Run once after schema.sql / 003_auth_signup.sql.

create table if not exists leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  leave_type text not null default 'casual' check (leave_type in ('sick', 'casual', 'annual', 'unpaid')),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_leave_requests_employee on leave_requests(employee_id);
create index if not exists idx_leave_requests_status on leave_requests(status);
create index if not exists idx_leave_requests_dates on leave_requests(start_date, end_date);

alter table leave_requests enable row level security;

create policy "leave_requests: admin full access" on leave_requests
  for all using (is_admin());

create policy "leave_requests: employee read own" on leave_requests
  for select using (
    employee_id = (select employee_id from profiles where id = auth.uid())
  );

create policy "leave_requests: employee insert own pending" on leave_requests
  for insert with check (
    employee_id = (select employee_id from profiles where id = auth.uid())
    and status = 'pending'
  );

-- Employees can withdraw their own request while it's still pending.
create policy "leave_requests: employee cancel own pending" on leave_requests
  for delete using (
    employee_id = (select employee_id from profiles where id = auth.uid())
    and status = 'pending'
  );

-- Convenience view: which employees are on approved leave today (or any
-- given day), used by the dashboard's "On Leave" stat.
create or replace view employees_on_leave_today as
select employee_id
from leave_requests
where status = 'approved'
  and current_date between start_date and end_date;
