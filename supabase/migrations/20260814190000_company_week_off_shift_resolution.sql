-- find_employee_shift_for_date() (20260806110000_roster_driven_payroll.sql)
-- only ever checked the PER-EMPLOYEE roster (employee_daily_shifts) for
-- Week Off — it had no awareness of the company-wide Week-off (companies.
-- weekly_off_day / company_holidays) at all. So someone who actually punched
-- on a company-wide off day fell through to their normal own-shift/
-- department/default chain and got evaluated as an ordinary working day:
-- late/early flags applied against their regular shift, hours split into
-- regular-vs-overtime against their regular shift's duration — exactly the
-- inconsistency a per-employee roster Week Off never had, since THAT one
-- already resolves to a 0-scheduled-hours Week Off with every worked hour
-- counted as bonus/overtime and never late (see calc_payroll_fields' i
-- s_week_off branch). This is the server-side half of that same fix —
-- mirrors resolveShiftForDate() in admin-web/mobile-app's lib/shift.ts,
-- which does the identical fallback client-side.
--
-- Priority order (matches the client): an explicit per-employee roster row
-- for this exact date always wins (a deliberate, specific override) → then
-- a company-wide Week-off date if there's no roster row → then the normal
-- own-shift/department/default chain.

create or replace function find_employee_shift_for_date(emp_id uuid, p_work_date date)
returns table(shift_name text, start_time time, end_time time, grace_minutes integer, is_week_off boolean) as $$
declare
  v_company_id uuid;
  v_weekly_off_day integer;
begin
  if exists (select 1 from employee_daily_shifts where employee_id = emp_id and work_date = p_work_date) then
    return query
      select s.name, s.start_time, s.end_time, s.grace_minutes, false
      from employee_daily_shifts eds
      join shifts s on s.id = eds.shift_id
      where eds.employee_id = emp_id and eds.work_date = p_work_date;
    if found then
      return;
    end if;
    -- A roster row exists for this date but shift_id is null: Week Off.
    return query select 'Week Off'::text, null::time, null::time, 0, true;
    return;
  end if;

  -- No roster entry for this date: fall back to a company-wide Week-off
  -- before the normal own-shift/department/default chain.
  select company_id into v_company_id from employees where id = emp_id;
  if v_company_id is not null then
    select weekly_off_day into v_weekly_off_day from companies where id = v_company_id;
    if v_weekly_off_day is not null and extract(dow from p_work_date) = v_weekly_off_day then
      return query select 'Week Off'::text, null::time, null::time, 0, true;
      return;
    end if;
    if exists (select 1 from company_holidays where company_id = v_company_id and holiday_date = p_work_date) then
      return query select 'Week Off'::text, null::time, null::time, 0, true;
      return;
    end if;
  end if;

  -- find_employee_shift_for_date is untouched — still the correct fallback
  -- for a day with no roster entry and no company-wide Week-off either.
  return query
    select f.shift_name, f.start_time, f.end_time, f.grace_minutes, false
    from find_employee_shift(emp_id) f;
end;
$$ language plpgsql stable;
