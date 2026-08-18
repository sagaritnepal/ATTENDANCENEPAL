-- Server-side half of the recurring weekly pattern (20260818100000) and
-- roster_mode switch (20260818110000) — mirrors the same new tier being
-- added to resolveShiftForDate() in admin-web/mobile-app's lib/shift.ts.
-- Without this, the nightly payroll job (compute_payroll_summaries(), via
-- find_employee_shift_for_date()) would silently disagree with what the
-- live client-side UI shows for a weekly-mode company — the same class of
-- bug 20260814190000 already fixed once for company-wide Week-off.
--
-- Priority order (matches the client, and matches 20260814190000's own
-- priority comment): an explicit per-employee exact-date roster row always
-- wins first (unchanged) → then, only in 'weekly' roster_mode, a matching
-- weekday in employee_weekly_pattern → then a company-wide Week-off date →
-- then the normal own-shift/department/default chain. In 'monthly' mode
-- (the default for every existing company), this function behaves exactly
-- as it did before this migration.

create or replace function find_employee_shift_for_date(emp_id uuid, p_work_date date)
returns table(shift_name text, start_time time, end_time time, grace_minutes integer, is_week_off boolean) as $$
declare
  v_company_id uuid;
  v_weekly_off_day integer;
  v_roster_mode text;
  v_pattern_exists boolean;
  v_pattern_shift_id uuid;
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

  select company_id into v_company_id from employees where id = emp_id;
  if v_company_id is not null then
    select roster_mode, weekly_off_day into v_roster_mode, v_weekly_off_day
      from companies where id = v_company_id;

    if v_roster_mode = 'weekly' then
      select exists(
        select 1 from employee_weekly_pattern
        where employee_id = emp_id and weekday = extract(dow from p_work_date)
      ) into v_pattern_exists;

      if v_pattern_exists then
        select shift_id into v_pattern_shift_id from employee_weekly_pattern
          where employee_id = emp_id and weekday = extract(dow from p_work_date);
        if v_pattern_shift_id is null then
          return query select 'Week Off'::text, null::time, null::time, 0, true;
          return;
        end if;
        return query
          select s.name, s.start_time, s.end_time, s.grace_minutes, false
          from shifts s where s.id = v_pattern_shift_id;
        if found then
          return;
        end if;
      end if;
    end if;

    if v_weekly_off_day is not null and extract(dow from p_work_date) = v_weekly_off_day then
      return query select 'Week Off'::text, null::time, null::time, 0, true;
      return;
    end if;
    if exists (select 1 from company_holidays where company_id = v_company_id and holiday_date = p_work_date) then
      return query select 'Week Off'::text, null::time, null::time, 0, true;
      return;
    end if;
  end if;

  return query
    select f.shift_name, f.start_time, f.end_time, f.grace_minutes, false
    from find_employee_shift(emp_id) f;
end;
$$ language plpgsql stable;
