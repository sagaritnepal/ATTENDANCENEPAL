# Attendance — Mobile App (React Native + Expo)

Employee-facing check-in app and a lightweight admin dashboard, both backed by Supabase.

## Setup

```bash
cd mobile-app
npm install
cp .env.example .env   # fill in your Supabase project URL + anon key
npm start               # opens Expo dev tools; scan the QR with Expo Go, or press a/i
```

Requires a Supabase project with `../supabase/schema.sql` applied, plus:
- A public Storage bucket named `attendance-selfies` (for the selfie check-in method).
- At least one `branches` row and one `employees` row linked to a `profiles` row (see
  `supabase/schema.sql` for the tables and RLS policies).

## Structure

- `src/lib/supabase.ts` — Supabase client (session persisted in AsyncStorage).
- `src/screens/LoginScreen.tsx` — Supabase Auth email/password sign-in.
- `src/screens/CheckInScreen.tsx` — employee check-in/out via GPS geofence, QR scan, or selfie.
- `src/screens/HistoryScreen.tsx` — an employee's own punch history.
- `src/screens/DashboardScreen.tsx` — admin-only live feed via Supabase Realtime.

`App.tsx` routes between the employee flow and the admin flow based on `profiles.role`.
