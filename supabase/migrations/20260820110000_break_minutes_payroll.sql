-- Break punches (20260820100000) need two fixes in compute_payroll_summaries():
--
-- 1. Its "no explicit check-in/check-out" fallback (v_first_any/v_last_any/
--    v_punch_count) previously ran over ALL punches that day. With break
--    punches now possible, an in-progress day with only Check-In + Start
--    Break + End Break (no real checkout yet) would have its break-end
--    punch mistaken for checkout. Fix: exclude punch_type in ('2','3') from
--    those three aggregates in both branches (overnight and normal) — the
--    '0'/'1'-filtered v_first_in/v_last_out were already correct and are
--    unchanged.
--
-- 2. Add break_minutes: sum of (break-end - break-start) for every complete
--    '2'->'3' pair that day, using the exact same punch row-set each branch
--    already selects for check-in/check-out (so the overnight-window vs.
--    normal-day distinction, and the "exclude punches already claimed by
--    yesterday's overnight window" exclusion, apply identically here too).
--    An unpaired trailing '2' (still on break) contributes nothing, same as
--    how an unpaired checkout is handled today. Break time is NOT subtracted
--    from total_hours anywhere — calc_payroll_fields is untouched.

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
  v_break_minutes integer;
  v_break_start timestamptz;
  v_break_punch record;
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
    v_break_minutes := 0;
    v_break_start := null;

    if v_window.is_overnight then
      select
        min(punch_time) filter (where punch_type = '0'),
        max(punch_time) filter (where punch_type = '1'),
        min(punch_time) filter (where punch_type not in ('2', '3')),
        max(punch_time) filter (where punch_type not in ('2', '3')),
        count(*) filter (where punch_type not in ('2', '3'))
      into v_first_in, v_last_out, v_first_any, v_last_any, v_punch_count
      from attendance_logs
      where employee_id = emp.id
        and punch_time >= v_window.window_start and punch_time < v_window.window_end;

      for v_break_punch in
        select punch_type, punch_time from attendance_logs
        where employee_id = emp.id and punch_type in ('2', '3')
          and punch_time >= v_window.window_start and punch_time < v_window.window_end
        order by punch_time
      loop
        if v_break_punch.punch_type = '2' then
          v_break_start := v_break_punch.punch_time;
        elsif v_break_punch.punch_type = '3' and v_break_start is not null then
          v_break_minutes := v_break_minutes + round(extract(epoch from (v_break_punch.punch_time - v_break_start)) / 60);
          v_break_start := null;
        end if;
      end loop;
    else
      -- Exclude any punch already claimed by an overnight shift from
      -- YESTERDAY (if yesterday was overnight for this employee) -- a
      -- checkout just after midnight Kathmandu would otherwise also raw-
      -- date-match today and get mislabeled as today's stray check-in.
      select * into v_prev_window from shift_window_for_date(emp.id, target_date - 1);
      select
        min(punch_time) filter (where punch_type = '0'),
        max(punch_time) filter (where punch_type = '1'),
        min(punch_time) filter (where punch_type not in ('2', '3')),
        max(punch_time) filter (where punch_type not in ('2', '3')),
        count(*) filter (where punch_type not in ('2', '3'))
      into v_first_in, v_last_out, v_first_any, v_last_any, v_punch_count
      from attendance_logs
      where employee_id = emp.id and punch_time::date = target_date
        and (not v_prev_window.is_overnight or punch_time >= v_prev_window.window_end);

      for v_break_punch in
        select punch_type, punch_time from attendance_logs
        where employee_id = emp.id and punch_type in ('2', '3') and punch_time::date = target_date
          and (not v_prev_window.is_overnight or punch_time >= v_prev_window.window_end)
        order by punch_time
      loop
        if v_break_punch.punch_type = '2' then
          v_break_start := v_break_punch.punch_time;
        elsif v_break_punch.punch_type = '3' and v_break_start is not null then
          v_break_minutes := v_break_minutes + round(extract(epoch from (v_break_punch.punch_time - v_break_start)) / 60);
          v_break_start := null;
        end if;
      end loop;
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
      overtime_hours, break_minutes, computed_at
    ) values (
      emp.id, emp.company_id, target_date, fields.shift_name, check_in, check_out, fields.total_hours,
      fields.is_late, fields.late_minutes, fields.is_early_departure, fields.early_departure_minutes,
      fields.overtime_hours, v_break_minutes, now()
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
      break_minutes = excluded.break_minutes,
      computed_at = excluded.computed_at
    where payroll_summaries.manually_corrected = false;

    rows_written := rows_written + 1;
  end loop;

  return rows_written;
end;
$$ language plpgsql;
