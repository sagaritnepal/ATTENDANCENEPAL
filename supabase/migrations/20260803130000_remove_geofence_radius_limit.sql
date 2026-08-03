-- Stop hard-rejecting GPS punches that are farther than a branch's
-- radius_meters. Requested: don't block employees from checking in/out on
-- their phone over distance — any out-of-range punches can be caught and
-- handled via the existing "Fix a Missed Punch" / correction review flow
-- instead of an outright block at punch time.
--
-- Keeps the other two checks enforce_geofence() already did: an employee
-- must have an assigned branch to punch at all, and QR punches still need a
-- valid, unexpired token.

create or replace function enforce_geofence()
returns trigger as $$
declare
  b branches%rowtype;
  emp employees%rowtype;
begin
  if new.method = 'gps' then
    select * into emp from employees where id = new.employee_id;
    select * into b from branches where id = emp.branch_id;
    if b.id is null then
      raise exception 'Employee has no assigned branch for geofence check';
    end if;
    -- Distance is no longer checked here — no radius rejection.
  end if;

  if new.method = 'qr' then
    if not exists (
      select 1 from qr_tokens
      where id = new.qr_token_id and expires_at > now()
    ) then
      raise exception 'Punch rejected: QR token expired or invalid';
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer;
