# Supabase Backend

## Setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run `schema.sql` (or `supabase db push` if using the CLI).
3. Run `payroll.sql` — adds the `compute_payroll_summaries()` function.
4. Run `seed.sql` — creates a sample branch, shift, and employee, and prints the `employee_id`
   and `qr_token_id` you'll need for the next steps.
5. Run `003_auth_signup.sql` — auto-creates a `profiles` row (role `employee`) whenever someone
   registers through the admin-web `/register` page, so self-service signup works end to end.
6. Run `004_leave_management.sql` — adds `leave_requests` (employee-submitted, admin-approved)
   and the `employees_on_leave_today` view the dashboard's "On Leave" stat reads from.
7. In Storage, create a public bucket named `attendance-selfies`.
8. In Authentication, enable email/password sign-in and create your **admin** user, then:
   ```sql
   insert into profiles (id, role) values ('<admin-auth-uuid>', 'admin');
   ```
9. Create a second Authentication user for the **employee** login, then link it to the employee
   seeded in step 4 (use the `employee_id` printed by `seed.sql`):
   ```sql
   insert into profiles (id, employee_id, role)
   values ('<employee-auth-uuid>', '<employee_id-from-seed.sql>', 'employee');
   ```
10. Copy your project URL + anon key into `../mobile-app/.env` and `../admin-web/.env.local`.
11. Copy your project URL + service role key into `../zkteco-bridge/.env` if you have physical
    ZKTeco terminals to bridge in.

Sign in to the mobile app with the **employee** login to test GPS/QR/selfie check-in, and with
the **admin** login to see the live dashboard. The seeded branch is centered on Kathmandu with a
5km radius — replace `latitude`/`longitude` in `seed.sql` with your real office coordinates
before relying on the geofence check for anything real. To test QR check-in, encode the
`qr_token_id` value (not the `token` text) printed by `seed.sql` into a QR code and scan it from
`CheckInScreen`.

## What's in `schema.sql`

- Core tables: `branches`, `employees`, `profiles`, `devices`, `shifts`, `attendance_logs`,
  `qr_tokens`, `payroll_summaries`.
- A `before insert` trigger on `attendance_logs` (`enforce_geofence`) that re-validates GPS
  punches server-side (haversine distance against the employee's branch) and QR token expiry,
  so a modified client can't fake presence.
- Row Level Security on every table: employees can only see/insert their own attendance;
  admins (`profiles.role = 'admin'`) have full access.

## What's in `payroll.sql`

- `find_employee_shift(employee_id)` — employee's own shift, else their department's, else a
  09:00–18:00 / 10-minute-grace default. Mirrors `findShiftForEmployee()` in `calc.js`.
- `compute_payroll_summaries(work_date default yesterday)` — computes total hours, late/early
  minutes, and overtime for every active employee who punched on that date, and upserts into
  `payroll_summaries`. Mirrors `calculateDailyRecord()` in `calc.js`. Test it manually with:
  ```sql
  select compute_payroll_summaries(current_date);
  ```
  Once you've confirmed it works, uncomment the `cron.schedule(...)` line at the bottom of
  `schema.sql` to run it nightly via `pg_cron`.

## What's in `004_leave_management.sql`

- `leave_requests` — employee-submitted (sick/casual/annual/unpaid), admin-approved. RLS: an
  employee can create/read/cancel their own pending requests; admins have full access.
- `employees_on_leave_today` — a view listing `employee_id`s with an approved request covering
  today, used by the admin dashboard's "On Leave" stat and to exclude on-leave employees from
  "Absent" counts.
