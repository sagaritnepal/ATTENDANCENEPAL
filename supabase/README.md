# Supabase Backend

## Setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run `schema.sql` (or `supabase db push` if using the CLI).
3. Run `payroll.sql` — adds the `compute_payroll_summaries()` function.
4. Run `seed.sql` — creates a sample branch, shift, and employee, and prints the `employee_id`
   and `qr_token_id` you'll need for the next steps.
5. Run `002_designation.sql` — adds `employees.designation`.
6. Run `003_auth_signup.sql` — auto-creates a `profiles` row (role `employee`) whenever someone
   registers through the admin-web `/register` page, so self-service signup works end to end.
7. Run `004_leave_management.sql` — adds `leave_requests` (employee-submitted, admin-approved)
   and the `employees_on_leave_today` view the dashboard's "On Leave" stat reads from.
8. Run `005_employee_extras.sql` — adds `employees.phone` and makes per-employee shift
   assignment well-defined (one shift row per employee).
9. Run `006_profiles_employee_unique.sql` — ensures one login account can't be linked to more
   than one employee record.
10. In Storage, create a public bucket named `attendance-selfies`.
11. In Authentication, enable email/password sign-in and create your **admin** user, then:
    ```sql
    insert into profiles (id, role) values ('<admin-auth-uuid>', 'admin');
    ```
12. Copy your project URL + anon key into `../mobile-app/.env` and `../admin-web/.env.local`.
13. Copy your project URL + **service role key** (Settings → API → `service_role` secret) into
    `SUPABASE_SERVICE_ROLE_KEY` in `../admin-web/.env.local` and in Vercel's Environment
    Variables — this powers the "Create login" button on the admin-web Employees page (see
    below). Never prefix it with `NEXT_PUBLIC_`, and never put it in `../mobile-app/.env`.

Employee logins are no longer created by hand: once an employee is added on the **Employees**
page, click **Create login** on their row, set an email + temporary password, and share those
with them — that creates their Supabase Auth account and links it to that employee record in one
step. Sign in to the mobile app with that login to test GPS/QR/selfie check-in, and with the
**admin** login to see the live dashboard. The seeded branch is centered on Kathmandu with a 5km
radius — replace `latitude`/`longitude` in `seed.sql` with your real office coordinates before
relying on the geofence check for anything real. To test QR check-in, encode the `qr_token_id`
value (not the `token` text) printed by `seed.sql` into a QR code and scan it from
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
