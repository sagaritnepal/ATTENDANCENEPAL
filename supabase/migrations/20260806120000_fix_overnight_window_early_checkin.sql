-- shift_window_for_date (20260806110000_...) anchored the overnight
-- window's START to the exact scheduled start-time minute. Real guards
-- clock in a few minutes early -- their check-in punch then falls just
-- BEFORE window_start and gets excluded entirely, leaving only the
-- next-day checkout punch in the window (1 punch -> check_out stays null
-- -> 0 hours). Widen the window's start to the beginning of that Nepal
-- calendar day instead; window_end (scheduled start + duration + 2h OT
-- allowance) is unchanged.

create or replace function shift_window_for_date(emp_id uuid, p_work_date date)
returns table(is_overnight boolean, window_start timestamptz, window_end timestamptz) as $$
declare
  shift record;
  start_min integer;
  end_min integer;
  duration_min integer;
begin
  select * into shift from find_employee_shift_for_date(emp_id, p_work_date);
  if shift.is_week_off or shift.start_time is null or shift.end_time is null then
    return query select false, null::timestamptz, null::timestamptz;
    return;
  end if;

  start_min := extract(hour from shift.start_time)::integer * 60 + extract(minute from shift.start_time)::integer;
  end_min := extract(hour from shift.end_time)::integer * 60 + extract(minute from shift.end_time)::integer;

  if end_min > start_min then
    return query select false, null::timestamptz, null::timestamptz;
    return;
  end if;

  duration_min := 24 * 60 - start_min + end_min;
  return query select
    true,
    (p_work_date::text || ' 00:00:00')::timestamp at time zone 'Asia/Kathmandu',
    (p_work_date::text || ' ' || shift.start_time::text)::timestamp at time zone 'Asia/Kathmandu'
      + (duration_min + 120) * interval '1 minute';
end;
$$ language plpgsql stable;
