-- A biometric device records a scan the instant a finger touches it,
-- regardless of whether that employee has approved leave for the day — the
-- app has no way to stop the physical scan itself. What it CAN do is refuse
-- to persist that scan as an attendance record once leave already covers
-- that date, so an employee on approved leave never shows as present/late/
-- absent from a stray device punch (walking past the office, a cached punch
-- flushing late, etc). Silently drops the row (RETURN NULL) rather than
-- raising, so zkteco-bridge's sync just sees one less row instead of a sync
-- failure — same "date" derivation (Asia/Kathmandu) as calc_payroll_fields()
-- uses for late/early, so this agrees with what Late/Early already means.

create or replace function block_attendance_on_leave() returns trigger as $$
begin
  if exists (
    select 1 from leave_requests
    where employee_id = new.employee_id
      and status = 'approved'
      and (new.punch_time at time zone 'Asia/Kathmandu')::date between start_date and end_date
  ) then
    return null;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists attendance_logs_skip_on_leave on attendance_logs;
create trigger attendance_logs_skip_on_leave
  before insert on attendance_logs
  for each row execute function block_attendance_on_leave();
