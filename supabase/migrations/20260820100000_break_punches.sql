-- Break punches: employees can now punch "Start Break" (punch_type '2') and
-- "End Break" ('3') mid-shift, alongside the existing Check-In ('0') /
-- Check-Out ('1'). These codes match what ZKTeco biometric devices already
-- emit natively (break-out/break-in) when someone presses the device's own
-- Break key — index.js/lan-bridge.js already pass that raw code through
-- untouched, they were only ever blocked by the CHECK constraint below.
--
-- Break time stays PAID (it does not reduce total_hours) — it's tracked and
-- shown separately via payroll_summaries.break_minutes, computed by
-- compute_payroll_summaries() alongside total_hours/overtime_hours.

alter table attendance_logs drop constraint if exists attendance_logs_punch_type_check;
alter table attendance_logs add constraint attendance_logs_punch_type_check
  check (punch_type in ('0', '1', '2', '3'));

alter table attendance_gps_requests drop constraint if exists attendance_gps_requests_punch_type_check;
alter table attendance_gps_requests add constraint attendance_gps_requests_punch_type_check
  check (punch_type in ('0', '1', '2', '3'));

-- Self-serve per-company toggle, same pattern as roster_mode
-- (20260818110000_companies_roster_mode.sql) — defaults off, no RLS change
-- needed ("companies: admin update own" already covers writing it).
alter table companies add column if not exists break_enabled boolean not null default false;

-- Finalized per-day break total. Additive stat, not subtracted from
-- total_hours/overtime_hours anywhere.
alter table payroll_summaries add column if not exists break_minutes integer not null default 0;
