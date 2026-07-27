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

-- Mirrors calculateDailyRecord() in calc.js for every active employee who
-- punched on target_date (defaults to yesterday, for the nightly cron run).
-- Returns the number of payroll_summaries rows written.
create or replace function compute_payroll_summaries(p_work_date date default null)
returns integer as $$
declare
  target_date date := coalesce(p_work_date, (now() at time zone 'utc')::date - 1);
  emp record;
  shift record;
  v_first_in timestamptz;
  v_last_out timestamptz;
  v_first_any timestamptz;
  v_last_any timestamptz;
  v_punch_count integer;
  check_in timestamptz;
  check_out timestamptz;
  shift_start_min integer;
  shift_end_min integer;
  shift_duration_min integer;
  in_min_of_day integer;
  out_min_of_day integer;
  total_minutes integer;
  late_minutes integer;
  early_minutes integer;
  overtime_minutes integer;
  is_late boolean;
  is_early boolean;
  rows_written integer := 0;
begin
  for emp in
    select distinct e.id
    from employees e
    join attendance_logs al on al.employee_id = e.id
    where e.status = 'active' and al.punch_time::date = target_date
  loop
    select * into shift from find_employee_shift(emp.id);

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

    shift_start_min := extract(hour from shift.start_time)::integer * 60 + extract(minute from shift.start_time)::integer;
    shift_end_min := extract(hour from shift.end_time)::integer * 60 + extract(minute from shift.end_time)::integer;
    shift_duration_min := case when shift_end_min > shift_start_min
      then shift_end_min - shift_start_min
      else (24 * 60 - shift_start_min + shift_end_min)
    end;

    in_min_of_day := extract(hour from (check_in at time zone 'utc'))::integer * 60
      + extract(minute from (check_in at time zone 'utc'))::integer;

    is_late := in_min_of_day > (shift_start_min + shift.grace_minutes);
    late_minutes := case when is_late then in_min_of_day - shift_start_min else 0 end;

    total_minutes := 0;
    is_early := false;
    early_minutes := 0;
    overtime_minutes := 0;

    if check_out is not null then
      total_minutes := round(extract(epoch from (check_out - check_in)) / 60);
      out_min_of_day := extract(hour from (check_out at time zone 'utc'))::integer * 60
        + extract(minute from (check_out at time zone 'utc'))::integer;
      if out_min_of_day < shift_end_min then
        is_early := true;
        early_minutes := shift_end_min - out_min_of_day;
      end if;
      if total_minutes > shift_duration_min then
        overtime_minutes := total_minutes - shift_duration_min;
      end if;
    end if;

    insert into payroll_summaries (
      employee_id, work_date, shift_name, check_in, check_out, total_hours,
      is_late, late_minutes, is_early_departure, early_departure_minutes,
      overtime_hours, computed_at
    ) values (
      emp.id, target_date, shift.shift_name, check_in, check_out,
      round((total_minutes / 60.0)::numeric, 2), is_late, late_minutes,
      is_early, early_minutes, round((overtime_minutes / 60.0)::numeric, 2), now()
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
      computed_at = excluded.computed_at;

    rows_written := rows_written + 1;
  end loop;

  return rows_written;
end;
$$ language plpgsql;

-- Nightly run at 02:00 UTC, processing the previous day. Requires pg_cron
-- (enabled by default on Supabase). Uncomment after confirming the function
-- above runs cleanly with a manual `select compute_payroll_summaries();`.
-- select cron.schedule('nightly-payroll', '0 2 * * *', $$ select compute_payroll_summaries(); $$);
