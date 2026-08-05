-- Real multi-tenancy, part 4 of 4: the RPCs that bypass RLS as `security
-- definer` don't inherit the company scoping parts 1-3 just added — each
-- one that reads or writes tenant data must enforce it explicitly. Every
-- other RPC (find_employee_shift, calc_payroll_fields, enforce_geofence,
-- start_task, submit_task, start_task_timer, stop_task_timer,
-- update_my_profile) needs no change: they're either plain computation, or
-- already scoped by the caller's own employee_id, which can never span two
-- companies (see part 3's comment on self-access policies).

-- handle_new_user(): distinguishes two signup paths by which metadata key
-- auth.users.raw_user_meta_data carries. An admin-created teammate login
-- (create-login route, updated alongside this migration) passes
-- `company_id` explicitly and joins the caller's own existing company,
-- staying role='employee'. Self-service /register signups pass
-- `company_name` instead (no company_id) — this is now what creates a
-- brand-new, empty, fully isolated company with this user as its admin, a
-- deliberate reversal of 003_auth_signup.sql's original "never admin"
-- comment, per the new requirement.
create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_company_id uuid;
  v_role text := 'employee';
  v_full_name text := new.raw_user_meta_data ->> 'full_name';
  v_company_name text := new.raw_user_meta_data ->> 'company_name';
begin
  if new.raw_user_meta_data ->> 'company_id' is not null then
    v_company_id := (new.raw_user_meta_data ->> 'company_id')::uuid;
  elsif v_company_name is not null and trim(v_company_name) <> '' then
    insert into public.companies (name, created_by) values (trim(v_company_name), new.id)
    returning id into v_company_id;
    v_role := 'admin';
  end if;
  -- Neither key present: v_company_id stays null and the insert below
  -- fails against profiles.company_id NOT NULL, loudly, rather than
  -- silently creating a mis-scoped account. Both real insert paths
  -- (register, create-login) always supply one of the two keys.

  insert into public.profiles (id, role, full_name, company_name, company_id)
  values (new.id, v_role, v_full_name, v_company_name, v_company_id)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- get_leaderboard(): today returns literally every company's employees.
create or replace function get_leaderboard()
returns table(employee_id uuid, name text, department text, total_points bigint, tasks_completed bigint, profile_photo_url text) as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  return query
    select
      e.id,
      e.name,
      e.department,
      coalesce(sum(t.points) filter (where t.status = 'approved'), 0)::bigint
        - coalesce((select sum(pr.points_requested) from point_redemptions pr where pr.employee_id = e.id and pr.status = 'approved'), 0)::bigint,
      count(*) filter (where t.status = 'approved')::bigint,
      e.profile_photo_url
    from employees e
    left join tasks t on t.assigned_to = e.id
    where e.status = 'active' and e.company_id = my_company_id()
    group by e.id, e.name, e.department, e.profile_photo_url
    order by 4 desc, e.name asc;
end;
$$ language plpgsql stable security definer;

-- compute_payroll_summaries(): not security definer (invoker-rights), so
-- it's already correctly scoped via RLS today for the manual "Recompute"
-- button — but explicit is cheap insurance for a future pg_cron nightly
-- run (superuser, bypasses RLS entirely). company_id is read per-row from
-- the already-joined employees record, correct under either context.
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
    select distinct e.id, e.company_id
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

-- approve_attendance_correction(): same defensive explicit company_id,
-- read from the request row (which the stamp trigger already derived
-- correctly from its own employee_id).
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
-- Deliberately NOT security definer — see payroll.sql's original comment,
-- still true: runs with the caller's own RLS privileges.

-- approve_attendance_gps_request(): today any admin/HR can approve ANY
-- company's pending request by guessing its UUID — add the same ownership
-- check the rest of this migration set adds everywhere else.
create or replace function approve_attendance_gps_request(p_request_id uuid)
returns void as $$
declare
  req record;
  reviewer uuid := auth.uid();
begin
  if not is_admin_or_hr() then
    raise exception 'Not authorized';
  end if;

  select * into req from attendance_gps_requests
  where id = p_request_id and status = 'pending' and company_id = my_company_id();
  if not found then
    raise exception 'GPS request not found or already reviewed';
  end if;

  insert into attendance_logs (employee_id, punch_time, punch_type, method, lat, lng, accuracy_m)
  values (req.employee_id, req.punch_time, req.punch_type, 'gps', req.lat, req.lng, req.accuracy_m);

  update attendance_gps_requests
  set status = 'approved', reviewed_by = reviewer, reviewed_at = now()
  where id = p_request_id;
end;
$$ language plpgsql security definer set search_path = public;

-- admin_force_delete_employee(): today any admin can permanently,
-- irreversibly delete any OTHER company's employee and all their history
-- by UUID — the most severe gap in the codebase before this migration.
create or replace function admin_force_delete_employee(p_employee_id uuid)
returns void as $$
begin
  if not is_admin() then
    raise exception 'Only admins can permanently delete an employee';
  end if;

  if not exists (select 1 from employees where id = p_employee_id and company_id = my_company_id()) then
    raise exception 'Employee not found';
  end if;

  delete from task_time_logs where employee_id = p_employee_id;
  delete from tasks where assigned_to = p_employee_id;
  delete from point_redemptions where employee_id = p_employee_id;
  delete from employee_education where employee_id = p_employee_id;
  delete from employee_work_experience where employee_id = p_employee_id;
  delete from attendance_gps_requests where employee_id = p_employee_id;
  delete from attendance_correction_requests where employee_id = p_employee_id;
  delete from leave_requests where employee_id = p_employee_id;
  delete from payroll_summaries where employee_id = p_employee_id;
  delete from attendance_logs where employee_id = p_employee_id;
  delete from shifts where employee_id = p_employee_id;
  update profiles set employee_id = null where employee_id = p_employee_id;
  delete from employees where id = p_employee_id;
end;
$$ language plpgsql security definer set search_path = public;
