-- Company-wide "Week-off": a recurring weekly non-working day (e.g. every
-- Saturday) plus ad-hoc holiday dates, set by the admin only, distinct from
-- the existing PER-EMPLOYEE roster Week Off (employee_daily_shifts.shift_id
-- = null). This one applies to the whole company at once and is meant to be
-- genuinely paid (see payroll/page.tsx and lib/payrollDetail.ts changes),
-- not just a status label.

alter table companies add column if not exists weekly_off_day integer
  check (weekly_off_day between 0 and 6); -- 0=Sunday..6=Saturday, matches JS Date#getDay(); null = none set

create table if not exists company_holidays (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  holiday_date date not null,
  name text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (company_id, holiday_date)
);

create index if not exists idx_company_holidays_company_date
  on company_holidays(company_id, holiday_date);

alter table company_holidays enable row level security;

drop trigger if exists trg_stamp_company_id on company_holidays;
create trigger trg_stamp_company_id before insert on company_holidays
  for each row execute function stamp_company_id_root();

drop policy if exists "company_holidays: admin full access" on company_holidays;
create policy "company_holidays: admin full access" on company_holidays
  for all using (is_admin() and company_id = my_company_id());

drop policy if exists "company_holidays: employee read own company" on company_holidays;
create policy "company_holidays: employee read own company" on company_holidays
  for select using (company_id = my_company_id());

-- Expo push tokens, one row per employee (a second login on a new device
-- just overwrites the token via upsert — one active device per employee is
-- enough for this app's notification needs).
create table if not exists push_tokens (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  company_id uuid references companies(id),
  expo_push_token text not null,
  updated_at timestamptz not null default now(),
  unique (employee_id)
);

alter table push_tokens enable row level security;

drop trigger if exists trg_stamp_company_id on push_tokens;
create trigger trg_stamp_company_id before insert on push_tokens
  for each row execute function stamp_company_id_from_employee();

drop policy if exists "push_tokens: employee manage own" on push_tokens;
create policy "push_tokens: employee manage own" on push_tokens
  for all using (employee_id = (select employee_id from profiles where id = auth.uid()))
  with check (employee_id = (select employee_id from profiles where id = auth.uid()));
