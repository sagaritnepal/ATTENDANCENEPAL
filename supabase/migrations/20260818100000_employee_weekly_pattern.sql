-- Recurring weekly shift pattern, per employee — a company can opt an
-- employee's schedule into "the same Sun-Sat pattern every week, forever"
-- instead of the exact-date employee_daily_shifts model. Modeled directly
-- on employee_daily_shifts (20260806100000) — same shape, same trigger,
-- same RLS — just keyed by weekday (0=Sunday..6=Saturday) instead of a real
-- date, since a pattern isn't tied to any one week.
--
-- shift_id NULL is the same deliberate "Week Off" state employee_daily_shifts
-- uses: the row EXISTS (an explicit weekday assignment was made) but no
-- shift applies. No row for a weekday at all means "not part of the
-- pattern" and falls through exactly like employee_daily_shifts does.
--
-- Only consulted by shift resolution when companies.roster_mode = 'weekly'
-- (20260818110000) — see resolveShiftForDate() in lib/shift.ts and
-- find_employee_shift_for_date() (20260818120000).

create table if not exists employee_weekly_pattern (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  weekday integer not null check (weekday between 0 and 6),
  shift_id uuid references shifts(id),
  company_id uuid references companies(id),
  created_at timestamptz not null default now(),
  unique (employee_id, weekday)
);

create index if not exists idx_employee_weekly_pattern_company
  on employee_weekly_pattern(company_id, weekday);

alter table employee_weekly_pattern enable row level security;

-- stamp_company_id_from_employee() already exists (20260805090000) — same
-- trigger employee_daily_shifts already uses.
drop trigger if exists trg_stamp_company_id on employee_weekly_pattern;
create trigger trg_stamp_company_id before insert on employee_weekly_pattern
  for each row execute function stamp_company_id_from_employee();

drop policy if exists "employee_weekly_pattern: admin or hr full access" on employee_weekly_pattern;
create policy "employee_weekly_pattern: admin or hr full access" on employee_weekly_pattern
  for all using (is_admin_or_hr() and company_id = my_company_id());

drop policy if exists "employee_weekly_pattern: employee read own" on employee_weekly_pattern;
create policy "employee_weekly_pattern: employee read own" on employee_weekly_pattern
  for select using (employee_id = (select employee_id from profiles where id = auth.uid()));
