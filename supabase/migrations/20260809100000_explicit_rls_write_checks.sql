-- Every "admin/HR full access" policy from 20260805110000_tenant_rls_policies.sql
-- was written as `for all using (...)` with no explicit `with check` — relying
-- on Postgres's documented fallback of reusing USING as the write-check for
-- INSERT/UPDATE. In practice, inserting a task (and likely other
-- trigger-stamped tables) through the real authenticated client fails with
-- "new row violates row-level security policy", even though the BEFORE
-- trigger correctly stamps company_id before the check runs and the
-- inserting admin's own company_id matches. departments/branch_departments
-- already had an explicit `with check` (preserved from before multi-tenancy)
-- and don't exhibit the problem — so every other chained-table policy gets
-- the same explicit check here instead of depending on the implicit fallback.

alter policy "employees: admin or hr full access" on employees
  with check (is_admin_or_hr() and company_id = my_company_id());

alter policy "branches/devices/shifts/qr: admin full access" on branches
  with check (is_admin() and company_id = my_company_id());

alter policy "devices: admin full access" on devices
  with check (is_admin() and company_id = my_company_id());

alter policy "shifts: admin full access" on shifts
  with check (is_admin() and company_id = my_company_id());

alter policy "qr_tokens: admin full access" on qr_tokens
  with check (is_admin() and company_id = my_company_id());

alter policy "attendance_logs: admin full access" on attendance_logs
  with check (is_admin() and company_id = my_company_id());

alter policy "payroll_summaries: admin or hr full access" on payroll_summaries
  with check (is_admin_or_hr() and company_id = my_company_id());

alter policy "leave_requests: admin or hr full access" on leave_requests
  with check (is_admin_or_hr() and company_id = my_company_id());

alter policy "corrections: admin or hr full access" on attendance_correction_requests
  with check (is_admin_or_hr() and company_id = my_company_id());

alter policy "tasks: admin or hr full access" on tasks
  with check (is_admin_or_hr() and company_id = my_company_id());

alter policy "task_time_logs: admin or hr full access" on task_time_logs
  with check (is_admin_or_hr() and company_id = my_company_id());

alter policy "point_redemptions: admin or hr full access" on point_redemptions
  with check (is_admin_or_hr() and company_id = my_company_id());

alter policy "device_sync_events: admin full access" on device_sync_events
  with check (is_admin() and company_id = my_company_id());

alter policy "employee_education: admin or hr full access" on employee_education
  with check (is_admin_or_hr() and company_id = my_company_id());

alter policy "employee_work_experience: admin or hr full access" on employee_work_experience
  with check (is_admin_or_hr() and company_id = my_company_id());

alter policy "gps_requests: admin or hr full access" on attendance_gps_requests
  with check (is_admin_or_hr() and company_id = my_company_id());
