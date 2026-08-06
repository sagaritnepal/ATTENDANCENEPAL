-- Makes shift resolution date-aware (so employee_daily_shifts, added in
-- 20260806100000, can override the normal own-shift/department/default
-- chain for a specific day) and fixes a real bug this feature would
-- otherwise walk straight into: an overnight shift's check-out lands on a
-- DIFFERENT UTC calendar date than its check-in, so the existing
-- `punch_time::date = target_date` punch selection in
-- compute_payroll_summaries loses a Night Duty / Day & Night Duty shift's
-- hours entirely (the check-in's day sees no matching check-out, and the
-- check-out's own day mislabels itself as a stray "late" check-in).
--
-- Written against the LIVE function bodies (this file's starting point is
-- 20260805120000_tenant_rpc_updates.sql, which already added company_id
-- handling and is what's actually running today — NOT the older copies in
-- supabase/payroll.sql, which are stale: still say `at time zone 'utc'`
-- instead of the 'Asia/Kathmandu' fix from 20260804090000_...).

-- find_employee_shift(emp_id) is untouched — still the correct fallback
-- for a day with no roster entry at all.

create or replace function find_employee_shift_for_date(emp_id uuid, p_work_date date)
returns table(shift_name text, start_time time, end_time time, grace_minutes integer, is_week_off boolean) as $$
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

  -- No roster entry at all for this date: unchanged fallback chain.
  return query
    select f.shift_name, f.start_time, f.end_time, f.grace_minutes, false
    from find_employee_shift(emp_id) f;
end;
$$ language plpgsql stable;

-- Shared by compute_payroll_summaries below (for both target_date and
-- target_date - 1) so the overnight-window math is written once. NULL
-- start/end means "no window" (week off, or no shift resolvable at all).
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

  -- Overnight: window runs from this day's scheduled start, spanning the
  -- shift's duration plus a 2-hour overtime allowance.
  duration_min := 24 * 60 - start_min + end_min;
  return query select
    true,
    (p_work_date::text || ' ' || shift.start_time::text)::timestamp at time zone 'Asia/Kathmandu',
    (p_work_date::text || ' ' || shift.start_time::text)::timestamp at time zone 'Asia/Kathmandu'
      + (duration_min + 120) * interval '1 minute';
end;
$$ language plpgsql stable;

create or replace function calc_payroll_fields(
  emp_id uuid,
  p_check_in timestamptz,
  p_check_out timestamptz,
  p_work_date date
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
  select * into shift from find_employee_shift_for_date(emp_id, p_work_date);

  if shift.is_week_off then
    -- Nothing scheduled: never late/early. Any worked time is entirely
    -- overtime (0 scheduled hours to exceed).
    shift_duration_min := 0;
  else
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
  end if;

  if p_check_in is not null and p_check_out is not null then
    total_minutes := round(extract(epoch from (p_check_out - p_check_in)) / 60);
    if not shift.is_week_off then
      out_min_of_day := extract(hour from (p_check_out at time zone 'Asia/Kathmandu'))::integer * 60
        + extract(minute from (p_check_out at time zone 'Asia/Kathmandu'))::integer;
      if out_min_of_day < shift_end_min then
        is_early_v := true;
        early_minutes_v := shift_end_min - out_min_of_day;
      end if;
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

create or replace function compute_payroll_summaries(p_work_date date default null)
returns integer as $$
declare
  target_date date := coalesce(p_work_date, (now() at time zone 'utc')::date - 1);
  emp record;
  v_first_in timestamptz;
  v_last_out timestamptz;
  v_first_any timestamptz;
  v_last_any timestamptz;
  v_punch_count integer;
  check_in timestamptz;
  check_out timestamptz;
  fields record;
  rows_written integer := 0;
  v_window record;
  v_prev_window record;
begin
  for emp in
    select distinct e.id, e.company_id
    from employees e
    join attendance_logs al on al.employee_id = e.id
    where e.status = 'active' and al.punch_time::date = target_date
  loop
    select * into v_window from shift_window_for_date(emp.id, target_date);

    if v_window.is_overnight then
      select
        min(punch_time) filter (where punch_type = '0'),
        max(punch_time) filter (where punch_type = '1'),
        min(punch_time),
        max(punch_time),
        count(*)
      into v_first_in, v_last_out, v_first_any, v_last_any, v_punch_count
      from attendance_logs
      where employee_id = emp.id
        and punch_time >= v_window.window_start and punch_time < v_window.window_end;
    else
      -- Exclude any punch already claimed by an overnight shift from
      -- YESTERDAY (if yesterday was overnight for this employee) -- a
      -- checkout just after midnight Kathmandu would otherwise also raw-
      -- date-match today and get mislabeled as today's stray check-in.
      select * into v_prev_window from shift_window_for_date(emp.id, target_date - 1);
      select
        min(punch_time) filter (where punch_type = '0'),
        max(punch_time) filter (where punch_type = '1'),
        min(punch_time),
        max(punch_time),
        count(*)
      into v_first_in, v_last_out, v_first_any, v_last_any, v_punch_count
      from attendance_logs
      where employee_id = emp.id and punch_time::date = target_date
        and (not v_prev_window.is_overnight or punch_time >= v_prev_window.window_end);
    end if;

    check_in := coalesce(v_first_in, v_first_any);
    check_out := case when v_punch_count > 1 then coalesce(v_last_out, v_last_any) else null end;
    if check_out = check_in then
      check_out := null;
    end if;

    select * into fields from calc_payroll_fields(emp.id, check_in, check_out, target_date);

    insert into payroll_summaries (
      employee_id, company_id, work_date, shift_name, check_in, check_out, total_hours,
      is_late, late_minutes, is_early_departure, early_departure_minutes,
      overtime_hours, computed_at
    ) values (
      emp.id, emp.company_id, target_date, fields.shift_name, check_in, check_out, fields.total_hours,
      fields.is_late, fields.late_minutes, fields.is_early_departure, fields.early_departure_minutes,
      fields.overtime_hours, now()
    )
    on conflict (employee_id, work_date) do update set
      shift_name = excluded.shift_name,
      check_in = excluded.check_in,
      check_out = excluded.check_out,
      total_hours = excluded.total_hours,
      is_late = excluded.is_late,
      late_minutes = excluded.late_minutes,
      is_early_departure = excluded.is_early_departure,
      early_departure_minutes = excluded.early_departure_minutes,
      overtime_hours = excluded.overtime_hours,
      computed_at = excluded.computed_at
    where payroll_summaries.manually_corrected = false;

    rows_written := rows_written + 1;
  end loop;

  return rows_written;
end;
$$ language plpgsql;

create or replace function approve_attendance_correction(p_request_id uuid)
returns void as $$
declare
  req record;
  fields record;
  reviewer uuid := auth.uid();
begin
  select * into req from attendance_correction_requests where id = p_request_id and status = 'pending';
  if not found then
    raise exception 'Correction request not found or already reviewed';
  end if;

  select * into fields from calc_payroll_fields(req.employee_id, req.requested_check_in, req.requested_check_out, req.work_date);

  insert into payroll_summaries (
    employee_id, company_id, work_date, shift_name, check_in, check_out, total_hours,
    is_late, late_minutes, is_early_departure, early_departure_minutes,
    overtime_hours, manually_corrected, computed_at
  ) values (
    req.employee_id, req.company_id, req.work_date, fields.shift_name, req.requested_check_in, req.requested_check_out,
    fields.total_hours, fields.is_late, fields.late_minutes, fields.is_early_departure,
    fields.early_departure_minutes, fields.overtime_hours, true, now()
  )
  on conflict (employee_id, work_date) do update set
    shift_name = excluded.shift_name,
    check_in = excluded.check_in,
    check_out = excluded.check_out,
    total_hours = excluded.total_hours,
    is_late = excluded.is_late,
    late_minutes = excluded.late_minutes,
    is_early_departure = excluded.is_early_departure,
    early_departure_minutes = excluded.early_departure_minutes,
    overtime_hours = excluded.overtime_hours,
    manually_corrected = true,
    computed_at = excluded.computed_at;

  update attendance_correction_requests
  set status = 'approved', reviewed_by = reviewer, reviewed_at = now()
  where id = p_request_id;
end;
$$ language plpgsql;
