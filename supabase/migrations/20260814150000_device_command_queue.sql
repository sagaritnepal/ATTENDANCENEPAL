-- Push-direction sync: until now, sync only ever flowed device -> cloud
-- (Sync Users/Sync Log, ATTLOG pushes). This adds the other direction — when
-- an employee's name is set/changed (or they're newly given a fingerprint_id)
-- in the dashboard, every device registered under that employee's company
-- gets queued a command to update its own on-device user record, so the
-- device's stored/displayed name doesn't go stale after an admin edit.
--
-- Delivery only works for a device in Cloud Server/ADMS push mode (talking to
-- push-server.js), not the old LAN-only index.js path: the device's own
-- periodic GET /iclock/getrequest poll is what picks a queued command up
-- (see push-server.js), there is no way to reach a device that never calls
-- home. A device only ever gets a command for an employee who already has a
-- fingerprint_id — this updates the *display name* tied to an existing
-- enrollment, it does not push a biometric template, so it cannot enroll
-- someone's fingerprint on a device that never scanned them.

create table if not exists device_command_queue (
  id uuid primary key default gen_random_uuid(),
  -- Short sequential token embedded in the C:<cmd_seq>:... line sent to the
  -- device and echoed back in its ACK (ID=<cmd_seq>) — kept separate from
  -- the uuid PK since ZKTeco firmware command IDs are conventionally small
  -- integers, not uuids.
  cmd_seq bigserial,
  device_id uuid not null references devices(id),
  company_id uuid references companies(id),
  command text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'success', 'failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  acked_at timestamptz,
  response text
);
create index if not exists idx_device_command_queue_pending on device_command_queue(device_id, status);

alter table device_command_queue enable row level security;

-- Reuses the existing device-chained stamping function (companies_and_
-- tenant_columns.sql) — it only reads NEW.device_id, works unchanged here.
drop trigger if exists trg_stamp_company_id on device_command_queue;
create trigger trg_stamp_company_id before insert on device_command_queue
  for each row execute function stamp_company_id_from_device();

-- Admin-visible for debugging (e.g. "did that name change actually reach
-- the device"); written only by the trigger below (security definer, bypasses
-- this) and by push-server.js (service-role key, also bypasses RLS) — no
-- direct client writes are expected or allowed.
drop policy if exists "device_command_queue: admin read" on device_command_queue;
create policy "device_command_queue: admin read" on device_command_queue
  for select using (is_admin() and company_id = my_company_id());

create or replace function queue_device_userinfo_sync()
returns trigger as $$
declare
  cmd text;
begin
  if new.fingerprint_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.name = new.name and old.fingerprint_id is not distinct from new.fingerprint_id then
    return new;
  end if;

  -- Plain ADMS "DATA UPDATE USERINFO" command — Pri=0 (normal user, not
  -- admin), Verify=0 (any verification method), no card/password managed
  -- here. Tabs are the field separator the protocol expects; strip any
  -- (implausible) tab out of the name so it can't smuggle an extra field in.
  cmd := 'DATA UPDATE USERINFO PIN=' || new.fingerprint_id
    || E'\tName=' || replace(new.name, E'\t', ' ')
    || E'\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000000000000\tVerify=0';

  insert into device_command_queue (device_id, command)
  select d.id, cmd from devices d where d.company_id = new.company_id;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_queue_device_userinfo_sync on employees;
create trigger trg_queue_device_userinfo_sync
  after insert or update of name, fingerprint_id on employees
  for each row execute function queue_device_userinfo_sync();
