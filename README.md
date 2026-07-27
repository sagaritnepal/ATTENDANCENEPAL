# Attendance Management System

Now building toward a **mobile + cloud** system: a React Native app for employee check-in/out
and a Supabase (Postgres) cloud backend, with optional hybrid support for existing ZKTeco K40
biometric terminals. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design.

## Project layout

| Folder | What it is |
|---|---|
| [`mobile-app/`](mobile-app/) | React Native (Expo) app — employee check-in (GPS/QR/selfie) + admin live dashboard. |
| [`supabase/`](supabase/) | Postgres schema, RLS policies, and setup steps for the cloud backend. |
| [`zkteco-bridge/`](zkteco-bridge/) | Standalone Node worker that polls ZKTeco K40 terminals and feeds punches into Supabase, for sites keeping fixed biometric hardware. |
| `server.js`, `db.js`, `calc.js`, `seed.js`, `public/` | The original single-process Node.js + SQLite prototype (web-only, no mobile app). Kept as a working reference and as the source for the payroll calculation logic (`calc.js`) that the Supabase nightly job should port. |

## Getting started (mobile + cloud)

1. Follow [`supabase/README.md`](supabase/README.md) to create and configure the Supabase project.
2. Follow [`mobile-app/README.md`](mobile-app/README.md) to run the app in Expo.
3. Optionally follow [`zkteco-bridge/`](zkteco-bridge/) setup if you have physical K40 terminals.

## Running the legacy web prototype

The original prototype still runs standalone if you want to compare behavior or reuse the
payroll calculation logic:

```bash
npm install
npm run seed     # creates the database with sample employees, devices, shifts, and 7 days of logs
npm start
```

Then open **http://localhost:4000**. Demo logins: `admin` / `admin123` (full access) and
`sagar` / `sagar123` (employee, own data only).
