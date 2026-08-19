-- devices.status defaulted to 'online', so a brand-new device (or one whose
-- bridge has never run yet) showed the green "online" badge on the
-- dashboard before it had ever actually been reached even once. The bridge
-- only ever writes 'offline' on a failed poll and 'online' on a successful
-- one, so a device with no polling history yet should start 'offline', not
-- 'online'.

alter table devices alter column status set default 'offline';
