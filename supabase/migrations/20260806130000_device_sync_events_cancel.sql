-- Lets an admin cancel a pending sync request from the Devices page instead
-- of it sitting stuck (e.g. queued while the device is offline). Only
-- 'pending' events are cancellable client-side -- zkteco-bridge only ever
-- picks up 'pending' rows (see fetchPendingSyncEvents), so flipping status
-- away from 'pending' is enough to keep it from being processed. A 'running'
-- event has already been claimed by the bridge and can't be interrupted
-- from here.

alter table device_sync_events drop constraint if exists device_sync_events_status_check;
alter table device_sync_events add constraint device_sync_events_status_check
  check (status in ('pending', 'running', 'success', 'failed', 'cancelled'));
