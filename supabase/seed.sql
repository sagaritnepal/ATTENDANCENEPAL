-- Sample data so the mobile app's check-in flow has something to validate
-- against. Safe to re-run (idempotent via on conflict). Run after
-- schema.sql and payroll.sql.
--
-- IMPORTANT: replace the latitude/longitude below with your real office
-- coordinates before testing GPS check-in — these are just Kathmandu, Nepal
-- with a generous 5km radius as a placeholder so the demo isn't overly
-- strict about exact location during testing.

with branch as (
  insert into branches (name, branch_code, latitude, longitude, radius_meters)
  values ('HQ', 'HQ-001', 27.7172, 85.3240, 5000)
  on conflict (branch_code) do update set name = excluded.name
  returning id
),
shift as (
  insert into shifts (name, type, start_time, end_time, grace_minutes, department, employee_id)
  values ('Engineering Day Shift', 'fixed', '09:00', '18:00', 10, 'Engineering', null)
  returning id
),
employee as (
  insert into employees (employee_code, name, email, department, branch_id, status)
  select 'EMP-001', 'Sagar Rayamajhi', 'sagaritnepal@gmail.com', 'Engineering', branch.id, 'active'
  from branch
  on conflict (employee_code) do update set branch_id = excluded.branch_id
  returning id
),
qr as (
  insert into qr_tokens (branch_id, expires_at)
  select branch.id, now() + interval '7 days'
  from branch
  returning id, token
)
select
  (select id from employee) as employee_id,
  (select id from qr) as qr_token_id_to_encode_in_branch_qr_code,
  (select token from qr) as qr_raw_token_fyi;

-- Next: create a second Supabase Auth user for the employee login (same way
-- you created the admin one), copy its UUID, then link it to the seeded
-- employee above:
--
-- insert into profiles (id, employee_id, role)
-- values ('<paste-employee-auth-uuid>', '<paste-employee_id-from-results-above>', 'employee');
