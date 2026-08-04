-- Permanently deletes an employee AND every record that references them —
-- attendance, payroll, tasks, leave, corrections, GPS requests, CV entries,
-- their personal shift assignment. None of the FKs on employees(id) cascade
-- (by design — a plain delete blocking on real history is the safety net
-- most of the time), so this exists as a separate, explicit, admin-only
-- escape hatch for when an admin genuinely wants that history gone, not a
-- silent cascade on the normal delete path.
--
-- Login accounts are left alone — profiles.employee_id is unlinked (set
-- null), not the profiles row deleted, since deleting a Supabase Auth user
-- needs the service-role Admin API, not a table delete, and isn't implied
-- by "delete this employee's HR record".
--
-- Restricted to admins only (mirrors is_admin() used throughout schema.sql)
-- since this bypasses RLS as security definer.
create or replace function admin_force_delete_employee(p_employee_id uuid)
returns void as $$
begin
  if not is_admin() then
    raise exception 'Only admins can permanently delete an employee';
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
$$ language plpgsql security definer;
