-- calc_payroll_fields() compared each punch's UTC clock-of-day against the
-- shift's 09:00-18:00 as if the shift times were also UTC. They aren't —
-- shifts are entered and displayed in Nepal local time, and punch_time is a
-- real UTC instant, so a perfectly on-time 18:54 checkout (Nepal time) was
-- read as 13:09 and scored as leaving ~4h51m "early". Converting to
-- Asia/Kathmandu instead of utc fixes both late-in and early-out. The
-- matching client-side fix is in admin-web/lib/shift.ts's punchMinuteOfDay().
--
-- Run this, then re-run "Recalculate month" on the Payroll page (or
-- select compute_payroll_summaries('<date>') for specific days) to correct
-- any payroll_summaries rows already computed with the old, wrong numbers.

create or replace function calc_payroll_fields(
  emp_id uuid,
  p_check_in timestamptz,
  p_check_out timestamptz
)
returns table(
  shift_name text,
  total_hours numeric,
  is_late boolean,
  late_minutes integer,
  is_early_departure boolean,
  early_departure_minutes integer,
  overtime_hours numeric
) as $$
declare
  shift record;
  shift_start_min integer;
  shift_end_min integer;
  shift_duration_min integer;
  in_min_of_day integer;
  out_min_of_day integer;
  total_minutes integer := 0;
  late_minutes_v integer := 0;
  early_minutes_v integer := 0;
  overtime_minutes integer := 0;
  is_late_v boolean := false;
  is_early_v boolean := false;
begin
  select * into shift from find_employee_shift(emp_id);

  shift_start_min := extract(hour from shift.start_time)::integer * 60 + extract(minute from shift.start_time)::integer;
  shift_end_min := extract(hour from shift.end_time)::integer * 60 + extract(minute from shift.end_time)::integer;
  shift_duration_min := case when shift_end_min > shift_start_min
    then shift_end_min - shift_start_min
    else (24 * 60 - shift_start_min + shift_end_min)
  end;

  if p_check_in is not null then
    in_min_of_day := extract(hour from (p_check_in at time zone 'Asia/Kathmandu'))::integer * 60
      + extract(minute from (p_check_in at time zone 'Asia/Kathmandu'))::integer;
    is_late_v := in_min_of_day > (shift_start_min + shift.grace_minutes);
    late_minutes_v := case when is_late_v then in_min_of_day - shift_start_min else 0 end;
  end if;

  if p_check_in is not null and p_check_out is not null then
    total_minutes := round(extract(epoch from (p_check_out - p_check_in)) / 60);
    out_min_of_day := extract(hour from (p_check_out at time zone 'Asia/Kathmandu'))::integer * 60
      + extract(minute from (p_check_out at time zone 'Asia/Kathmandu'))::integer;
    if out_min_of_day < shift_end_min then
      is_early_v := true;
      early_minutes_v := shift_end_min - out_min_of_day;
    end if;
    if total_minutes > shift_duration_min then
      overtime_minutes := total_minutes - shift_duration_min;
    end if;
  end if;

  return query select
    shift.shift_name,
    round((total_minutes / 60.0)::numeric, 2),
    is_late_v,
    late_minutes_v,
    is_early_v,
    early_minutes_v,
    round((overtime_minutes / 60.0)::numeric, 2);
end;
$$ language plpgsql stable;
