-- Real multi-tenancy, part 3 of 4: scope every admin/HR full-access policy
-- and every "any authenticated user can read this" policy to the caller's
-- own company. This is the actual isolation boundary — parts 1-2 only
-- prepared the data for it.
--
-- Self-access policies (an employee reading/writing their own row via
-- `employee_id = (select employee_id from profiles where id = auth.uid())`)
-- are deliberately left untouched below. profiles.employee_id is unique and
-- only ever set once (via create-login or an explicit admin action), so it
-- can never resolve to a different company than the profile's own
-- company_id — adding a redundant check there wouldn't add real security,
-- it would just make a linkage bug fail silently instead of visibly.
--
-- Policy names below are the actual live ones — several were already
-- renamed by later migrations (e.g. 007_hr_role_and_corrections.sql
-- widened "employees: admin full access" to "employees: admin or hr full
-- access"), traced through the full migration history, not guessed from
-- schema.sql alone.

-- profiles: only the admin branch of the read policy needs scoping — the
-- self branch (id = auth.uid()) is already exactly their own row.
drop policy if exists "profiles: self or admin read" on profiles;
create policy "profiles: self or admin read" on profiles
  for select using (id = auth.uid() or (is_admin() and company_id = my_company_id()));

-- employees
drop policy if exists "employees: admin or hr full access" on employees;
create policy "employees: admin or hr full access" on employees
  for all using (is_admin_or_hr() and company_id = my_company_id());

-- branches (admin full access + the public-read leak)
drop policy if exists "branches/devices/shifts/qr: admin full access" on branches;
create policy "branches/devices/shifts/qr: admin full access" on branches
  for all using (is_admin() and company_id = my_company_id());
drop policy if exists "branches: employee read" on branches;
create policy "branches: employee read" on branches
  for select using (company_id = my_company_id());

-- devices (admin-only, no employee read policy exists)
drop policy if exists "devices: admin full access" on devices;
create policy "devices: admin full access" on devices
  for all using (is_admin() and company_id = my_company_id());

-- shifts (admin full access + the public-read leak)
drop policy if exists "shifts: admin full access" on shifts;
create policy "shifts: admin full access" on shifts
  for all using (is_admin() and company_id = my_company_id());
drop policy if exists "shifts: employee read own or dept" on shifts;
create policy "shifts: employee read own or dept" on shifts
  for select using (company_id = my_company_id());

-- qr_tokens: the real security-sensitive leak — today ANY authenticated
-- user of ANY company can read ANY company's active QR token.
drop policy if exists "qr_tokens: admin full access" on qr_tokens;
create policy "qr_tokens: admin full access" on qr_tokens
  for all using (is_admin() and company_id = my_company_id());
drop policy if exists "qr_tokens: employee read active" on qr_tokens;
create policy "qr_tokens: employee read active" on qr_tokens
  for select using (expires_at > now() and company_id = my_company_id());

-- attendance_logs (admin-only; the old "employee insert own" policy was
-- already dropped in 20260803140000_gps_punch_approval.sql, nothing to
-- recreate for it)
drop policy if exists "attendance_logs: admin full access" on attendance_logs;
create policy "attendance_logs: admin full access" on attendance_logs
  for all using (is_admin() and company_id = my_company_id());

-- payroll_summaries
drop policy if exists "payroll_summaries: admin or hr full access" on payroll_summaries;
create policy "payroll_summaries: admin or hr full access" on payroll_summaries
  for all using (is_admin_or_hr() and company_id = my_company_id());

-- leave_requests
drop policy if exists "leave_requests: admin or hr full access" on leave_requests;
create policy "leave_requests: admin or hr full access" on leave_requests
  for all using (is_admin_or_hr() and company_id = my_company_id());

-- attendance_correction_requests
drop policy if exists "corrections: admin or hr full access" on attendance_correction_requests;
create policy "corrections: admin or hr full access" on attendance_correction_requests
  for all using (is_admin_or_hr() and company_id = my_company_id());

-- tasks
drop policy if exists "tasks: admin or hr full access" on tasks;
create policy "tasks: admin or hr full access" on tasks
  for all using (is_admin_or_hr() and company_id = my_company_id());

-- task_time_logs
drop policy if exists "task_time_logs: admin or hr full access" on task_time_logs;
create policy "task_time_logs: admin or hr full access" on task_time_logs
  for all using (is_admin_or_hr() and company_id = my_company_id());

-- point_redemptions
drop policy if exists "point_redemptions: admin or hr full access" on point_redemptions;
create policy "point_redemptions: admin or hr full access" on point_redemptions
  for all using (is_admin_or_hr() and company_id = my_company_id());

-- device_sync_events (admin-only, mirrors devices)
drop policy if exists "device_sync_events: admin full access" on device_sync_events;
create policy "device_sync_events: admin full access" on device_sync_events
  for all using (is_admin() and company_id = my_company_id());

-- employee_education
drop policy if exists "employee_education: admin or hr full access" on employee_education;
create policy "employee_education: admin or hr full access" on employee_education
  for all using (is_admin_or_hr() and company_id = my_company_id());

-- employee_work_experience
drop policy if exists "employee_work_experience: admin or hr full access" on employee_work_experience;
create policy "employee_work_experience: admin or hr full access" on employee_work_experience
  for all using (is_admin_or_hr() and company_id = my_company_id());

-- departments (admin full access, explicit with check in the original —
-- preserved; + the public-read leak)
drop policy if exists "departments: admin full access" on departments;
create policy "departments: admin full access" on departments
  for all using (is_admin() and company_id = my_company_id())
  with check (is_admin() and company_id = my_company_id());
drop policy if exists "departments: read" on departments;
create policy "departments: read" on departments
  for select using (company_id = my_company_id());

-- branch_departments (same shape as departments)
drop policy if exists "branch_departments: admin full access" on branch_departments;
create policy "branch_departments: admin full access" on branch_departments
  for all using (is_admin() and company_id = my_company_id())
  with check (is_admin() and company_id = my_company_id());
drop policy if exists "branch_departments: read" on branch_departments;
create policy "branch_departments: read" on branch_departments
  for select using (company_id = my_company_id());

-- attendance_gps_requests
drop policy if exists "gps_requests: admin or hr full access" on attendance_gps_requests;
create policy "gps_requests: admin or hr full access" on attendance_gps_requests
  for all using (is_admin_or_hr() and company_id = my_company_id());
