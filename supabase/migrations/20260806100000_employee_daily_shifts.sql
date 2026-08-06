-- Weekly duty roster: one row per (employee, calendar date) saying which
-- shift template applies that day, for companies where staff rotate
-- through different shifts day to day (e.g. a 24/7 guard operation) rather
-- than having one fixed shift. Keyed by actual work_date, not
-- week_start+day_of_week, so it lines up with attendance_logs/
-- payroll_summaries and needs no new date arithmetic at any lookup site —
-- the admin's weekly roster FORM is just a week-at-a-time view over these
-- per-date rows.
--
-- shift_id NULL is a deliberate, distinct state: "Week Off" — the row
-- EXISTS (an explicit assignment was made) but no shift applies that day.
-- That's different from no row at all, which means "nothing assigned for
-- this employee/date" and falls back to the employee's normal shift
-- (own shift -> department shift -> default), unchanged from today.

create table if not exists employee_daily_shifts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  work_date date not null,
  shift_id uuid references shifts(id),
  company_id uuid references companies(id),
  created_at timestamptz not null default now(),
  unique (employee_id, work_date)
);

create index if not exists idx_employee_daily_shifts_company_date
  on employee_daily_shifts(company_id, work_date);

alter table employee_daily_shifts enable row level security;

-- stamp_company_id_from_employee() already exists (20260805090000_...) —
-- same trigger already proven correct under ON CONFLICT DO UPDATE for the
-- shifts-per-employee upsert in employees/page.tsx.
drop trigger if exists trg_stamp_company_id on employee_daily_shifts;
create trigger trg_stamp_company_id before insert on employee_daily_shifts
  for each row execute function stamp_company_id_from_employee();

drop policy if exists "employee_daily_shifts: admin or hr full access" on employee_daily_shifts;
create policy "employee_daily_shifts: admin or hr full access" on employee_daily_shifts
  for all using (is_admin_or_hr() and company_id = my_company_id());

drop policy if exists "employee_daily_shifts: employee read own" on employee_daily_shifts;
create policy "employee_daily_shifts: employee read own" on employee_daily_shifts
  for select using (employee_id = (select employee_id from profiles where id = auth.uid()));
