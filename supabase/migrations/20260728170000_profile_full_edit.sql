-- Widens update_my_profile() to let an employee edit their whole profile
-- (name, email, phone, address, department, designation, photo) except
-- date_of_joining/resigned_at (HR-only, set from the Employees page) and
-- the security-relevant columns it already excluded (branch_id,
-- fingerprint_id, employee_code, status). Run once after
-- 20260728160000_employee_profile.sql.

create or replace function update_my_profile(
  p_name text,
  p_email text,
  p_phone text,
  p_address text,
  p_department text,
  p_designation text,
  p_photo_url text
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
      profile_photo_url = p_photo_url
  where id = emp_id;
end;
$$ language plpgsql security definer;
