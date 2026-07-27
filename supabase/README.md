# Supabase Backend

## Setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run `schema.sql` (or `supabase db push` if using the CLI).
3. In Storage, create a public bucket named `attendance-selfies`.
4. In Authentication, enable email/password sign-in and create your first admin user, then:
   ```sql
   insert into profiles (id, role) values ('<auth-user-uuid>', 'admin');
   ```
5. Copy your project URL + anon key into `../mobile-app/.env`.
6. Copy your project URL + service role key into `../zkteco-bridge/.env` if you have physical
   ZKTeco terminals to bridge in.

## What's in `schema.sql`

- Core tables: `branches`, `employees`, `profiles`, `devices`, `shifts`, `attendance_logs`,
  `qr_tokens`, `payroll_summaries`.
- A `before insert` trigger on `attendance_logs` (`enforce_geofence`) that re-validates GPS
  punches server-side (haversine distance against the employee's branch) and QR token expiry,
  so a modified client can't fake presence.
- Row Level Security on every table: employees can only see/insert their own attendance;
  admins (`profiles.role = 'admin'`) have full access.
- A commented-out `pg_cron` schedule for the nightly payroll job — see
  `ARCHITECTURE.md` section 6 for what that job should compute (port of `calc.js`).
