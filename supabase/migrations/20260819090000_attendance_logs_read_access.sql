-- attendance_logs has only ever had one RLS policy — "admin full access"
-- (is_admin(), see 20260805110000) — so HR and plain-employee accounts get
-- zero rows back from any select, silently (RLS filters rows, it doesn't
-- error), which looks identical to "nothing synced" from the app. Writes
-- stay admin-only on purpose (20260803140000's comment: HR approvals go
-- through approve_attendance_gps_request()'s security-definer bypass
-- instead), this only adds read access — mirrors the admin-or-hr-write +
-- employee-read-own pattern already used by gps_requests/tasks/payroll_summaries.

drop policy if exists "attendance_logs: hr read" on attendance_logs;
create policy "attendance_logs: hr read" on attendance_logs
  for select using (is_admin_or_hr() and company_id = my_company_id());

drop policy if exists "attendance_logs: employee read own" on attendance_logs;
create policy "attendance_logs: employee read own" on attendance_logs
  for select using (employee_id = (select employee_id from profiles where id = auth.uid()));
