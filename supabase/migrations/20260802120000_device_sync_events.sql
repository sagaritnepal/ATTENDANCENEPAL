-- On-demand device sync: the admin web app is hosted on Vercel and can never
-- reach a device on the office LAN directly, so a "Sync Users"/"Sync Log"
-- button can only queue a request here. zkteco-bridge (running on-prem, with
-- LAN access to the device) polls this table, does the actual TCP work, and
-- writes the result back — same pattern the rest of this app uses for
-- anything that needs hardware access. Run once after
-- 20260728170000_profile_full_edit.sql.

create table if not exists device_sync_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id),
  sync_type text not null check (sync_type in ('users', 'logs')),
  status text not null default 'pending' check (status in ('pending', 'running', 'success', 'failed')),
  requested_by uuid references profiles(id),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  summary text,
  error text
);
create index if not exists idx_device_sync_events_device on device_sync_events(device_id, requested_at desc);
create index if not exists idx_device_sync_events_pending on device_sync_events(status);

alter table device_sync_events enable row level security;

-- Devices are deliberately admin-only (see 007_hr_role_and_corrections.sql),
-- so sync requests are too.
create policy "device_sync_events: admin full access" on device_sync_events
  for all using (is_admin());
