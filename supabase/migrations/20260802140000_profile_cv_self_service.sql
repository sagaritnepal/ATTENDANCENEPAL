-- Lets an employee manage their own CV data (education, work experience,
-- skills, emergency contact) from their own portal, not just admin/HR from
-- the /employees/[id] page. Run once after 20260802130000_employee_cv.sql.

-- education/work_experience have no security-sensitive columns (unlike
-- employees.branch_id/fingerprint_id/status), so a direct self-scoped RLS
-- policy is fine here -- no narrow RPC needed, same reasoning as
-- leave_requests.
drop policy if exists "employee_education: self manage own" on employee_education;
create policy "employee_education: self manage own" on employee_education
  for all using (
    employee_id = (select employee_id from profiles where id = auth.uid())
  )
  with check (
    employee_id = (select employee_id from profiles where id = auth.uid())
  );

drop policy if exists "employee_work_experience: self manage own" on employee_work_experience;
create policy "employee_work_experience: self manage own" on employee_work_experience
  for all using (
    employee_id = (select employee_id from profiles where id = auth.uid())
  )
  with check (
    employee_id = (select employee_id from profiles where id = auth.uid())
  );

-- Widens update_my_profile() again to also cover skills + emergency contact
-- (still never date_of_joining/resigned_at/branch_id/fingerprint_id/status --
-- those stay HR/Admin-only from the Employees page).
create or replace function update_my_profile(
  p_name text,
  p_email text,
  p_phone text,
  p_address text,
  p_department text,
  p_designation text,
  p_photo_url text,
  p_skills text[],
  p_emergency_contact_name text,
  p_emergency_contact_relationship text,
  p_emergency_contact_phone text
)
returns void as $$
declare
  emp_id uuid;
begin
  select employee_id into emp_id from profiles where id = auth.uid();
  if emp_id is null then
    raise exception 'No employee linked to this account';
  end if;

  update employees
  set name = p_name,
      email = p_email,
      phone = p_phone,
      address = p_address,
      department = p_department,
      designation = p_designation,
      profile_photo_url = p_photo_url,
      skills = coalesce(p_skills, '{}'),
      emergency_contact_name = p_emergency_contact_name,
      emergency_contact_relationship = p_emergency_contact_relationship,
      emergency_contact_phone = p_emergency_contact_phone
  where id = emp_id;
end;
$$ language plpgsql security definer;
