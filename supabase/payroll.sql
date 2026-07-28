-- Payroll calculation engine — Postgres port of calc.js.
-- Run this once after schema.sql. Safe to re-run (create or replace).

-- Mirrors findShiftForEmployee() in calc.js: employee's own shift, else their
-- department's shift, else a 09:00-18:00 / 10 min grace default.
create or replace function find_employee_shift(emp_id uuid)
returns table(shift_name text, start_time time, end_time time, grace_minutes integer) as $$
declare
  emp_dept text;
begin
  return query
    select s.name, s.start_time, s.end_time, s.grace_minutes
    from shifts s where s.employee_id = emp_id
    limit 1;
  if found then
    return;
  end if;

  select department into emp_dept from employees where id = emp_id;

  return query
    select s.name, s.start_time, s.end_time, s.grace_minutes
    from shifts s where s.department = emp_dept and s.employee_id is null
    limit 1;
  if found then
    return;
  end if;

  return query select 'Default'::text, '09:00'::time, '18:00'::time, 10;
end;
$$ language plpgsql stable;

-- Given an employee + a check-in/check-out pair, computes the same fields
-- calculateDailyRecord() in calc.js derives from a day's punches. Shared by
-- compute_payroll_summaries() (raw attendance_logs punches) and
-- approve_attendance_correction() (an admin/HR-approved manual correction) so
-- the payroll math lives in exactly one place.
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
    in_min_of_day := extract(hour from (p_check_in at time zone 'utc'))::integer * 60
      + extract(minute from (p_check_in at time zone 'utc'))::integer;
    is_late_v := in_min_of_day > (shift_start_min + shift.grace_minutes);
    late_minutes_v := case when is_late_v then in_min_of_day - shift_start_min else 0 end;
  end if;

  if p_check_in is not null and p_check_out is not null then
    total_minutes := round(extract(epoch from (p_check_out - p_check_in)) / 60);
    out_min_of_day := extract(hour from (p_check_out at time zone 'utc'))::integer * 60
      + extract(minute from (p_check_out at time zone 'utc'))::integer;
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

-- Mirrors calculateDailyRecord() in calc.js for every active employee who
-- punched on target_date (defaults to yesterday, for the nightly cron run).
-- Returns the number of payroll_summaries rows written. Skips (via the
-- "where manually_corrected = false" upsert guard) any day an admin/HR has
-- already hand-corrected through approve_attendance_correction(), and never
-- touches overtime_approved either way — both are manual-review state that a
-- routine recompute must not silently reset.
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
begin
  for emp in
    select distinct e.id
    from employees e
    join attendance_logs al on al.employee_id = e.id
    where e.status = 'active' and al.punch_time::date = target_date
  loop
    select
      min(punch_time) filter (where punch_type = '0'),
      max(punch_time) filter (where punch_type = '1'),
      min(punch_time),
      max(punch_time),
      count(*)
    into v_first_in, v_last_out, v_first_any, v_last_any, v_punch_count
    from attendance_logs
    where employee_id = emp.id and punch_time::date = target_date;

    check_in := coalesce(v_first_in, v_first_any);
    check_out := case when v_punch_count > 1 then coalesce(v_last_out, v_last_any) else null end;
    if check_out = check_in then
      check_out := null;
    end if;

    select * into fields from calc_payroll_fields(emp.id, check_in, check_out);

    insert into payroll_summaries (
      employee_id, work_date, shift_name, check_in, check_out, total_hours,
      is_late, late_minutes, is_early_departure, early_departure_minutes,
      overtime_hours, computed_at
    ) values (
      emp.id, target_date, fields.shift_name, check_in, check_out, fields.total_hours,
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

-- Approves a pending attendance_correction_requests row: computes payroll
-- fields for the requested check-in/out via calc_payroll_fields (same math
-- compute_payroll_summaries uses), upserts payroll_summaries marked
-- manually_corrected so future recomputes leave it alone, and marks the
-- request approved. Defined in payroll.sql (not 007_hr_role_and_corrections)
-- so it can be created/replaced alongside the calc functions it depends on.
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

  select * into fields from calc_payroll_fields(req.employee_id, req.requested_check_in, req.requested_check_out);

  insert into payroll_summaries (
    employee_id, work_date, shift_name, check_in, check_out, total_hours,
    is_late, late_minutes, is_early_departure, early_departure_minutes,
    overtime_hours, manually_corrected, computed_at
  ) values (
    req.employee_id, req.work_date, fields.shift_name, req.requested_check_in, req.requested_check_out,
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
-- Deliberately NOT security definer: runs with the caller's own RLS
-- privileges, so the payroll_summaries insert/update and the final status
-- update both fail for anyone who isn't admin/hr (the "corrections" and
-- "payroll_summaries" policies above only grant writes to is_admin_or_hr()).

-- Nightly run at 02:00 UTC, processing the previous day. Requires pg_cron
-- (enabled by default on Supabase). Uncomment after confirming the function
-- above runs cleanly with a manual `select compute_payroll_summaries();`.
-- select cron.schedule('nightly-payroll', '0 2 * * *', $$ select compute_payroll_summaries(); $$);
