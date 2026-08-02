// Standalone worker: polls registered ZKTeco K40 terminals over TCP/IP (port 4370) and
// upserts raw punches into Supabase's attendance_logs table.
//
// Deploy this on-prem or on a small VM with LAN access to the devices — it needs a raw
// socket connection that a hosted Supabase Edge Function cannot provide. The mobile app and
// admin console never talk to devices directly; everything flows through attendance_logs.
require('dotenv').config();
const ZKLib = require('node-zklib');
const { createClient } = require('@supabase/supabase-js');

const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS || 15 * 1000);
const SYNC_REQUEST_POLL_MS = Number(process.env.SYNC_REQUEST_POLL_MS || 5000);
const MAX_BACKOFF_MS = 10 * 60 * 1000;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Tracks consecutive failures per device_id for exponential backoff.
const failureCounts = new Map();

async function fetchActiveDevices() {
  const { data, error } = await supabase.from('devices').select('*');
  if (error) throw error;
  return data;
}

async function fetchEmployeeByFingerprint(fingerprintId) {
  const { data, error } = await supabase
    .from('employees')
    .select('id')
    .eq('fingerprint_id', String(fingerprintId))
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function withDevice(device, fn) {
  const zk = new ZKLib(device.ip_address, device.port, 10000, 4000);
  await zk.createSocket();
  try {
    return await fn(zk);
  } finally {
    await zk.disconnect();
  }
}

async function pullDeviceLogs(device) {
  return withDevice(device, async zk => {
    const result = await zk.getAttendances();
    return result.data || [];
  });
}

async function pullDeviceUsers(device) {
  return withDevice(device, async zk => {
    const result = await zk.getUsers();
    return result.data || [];
  });
}

async function upsertLogs(device, rawLogs) {
  const rows = [];
  for (const log of rawLogs) {
    const employee = await fetchEmployeeByFingerprint(log.deviceUserId);
    if (!employee) {
      console.warn(`[${device.name}] no employee mapped to fingerprint_id ${log.deviceUserId}, skipping`);
      continue;
    }
    rows.push({
      employee_id: employee.id,
      device_id: device.id,
      punch_time: new Date(log.recordTime).toISOString(),
      punch_type: String(log.type ?? '0'),
      method: 'zkteco',
      verification_mode: String(log.verifyMethod ?? '1'),
    });
  }
  if (rows.length === 0) return 0;

  // Composite unique key (employee_id, punch_time) makes this idempotent regardless of
  // how many times a device is polled or a sync is retried after a network blip.
  const { error } = await supabase
    .from('attendance_logs')
    .upsert(rows, { onConflict: 'employee_id,punch_time', ignoreDuplicates: true });
  if (error) throw error;
  return rows.length;
}

// A device user is only ever matched by fingerprint_id — if one already maps
// to an existing employee, that row (name, employee_code, etc, set by an
// admin) is left alone. Only device users with no matching employee yet get
// a brand-new employees row, so this is safe to run repeatedly.
async function upsertUsers(device, rawUsers) {
  let added = 0;
  for (const u of rawUsers) {
    const fingerprintId = String(u.userId);
    const existing = await fetchEmployeeByFingerprint(fingerprintId);
    if (existing) continue;
    const { error } = await supabase.from('employees').insert({
      employee_code: `ZK-${device.id.slice(0, 8)}-${fingerprintId}`,
      name: u.name || `Device user ${fingerprintId}`,
      fingerprint_id: fingerprintId,
      status: 'active',
    });
    if (error) throw error;
    added++;
  }
  return { total: rawUsers.length, added };
}

async function syncDevice(device) {
  try {
    const rawLogs = await pullDeviceLogs(device);
    const count = await upsertLogs(device, rawLogs);
    console.log(`[${device.name}] synced ${count} punch(es)`);
    failureCounts.set(device.id, 0);
    await supabase.from('devices').update({ last_sync: new Date().toISOString(), status: 'online' }).eq('id', device.id);
  } catch (err) {
    const failures = (failureCounts.get(device.id) || 0) + 1;
    failureCounts.set(device.id, failures);
    const backoff = Math.min(MAX_BACKOFF_MS, SYNC_INTERVAL_MS * 2 ** failures);
    console.error(`[${device.name}] sync failed (attempt ${failures}), next retry in ${Math.round(backoff / 1000)}s:`, err.message);
    await supabase.from('devices').update({ status: 'offline' }).eq('id', device.id);
  }
}

async function syncAllDevices() {
  const devices = await fetchActiveDevices();
  for (const device of devices) {
    await syncDevice(device);
  }
}

// On-demand "Sync Users"/"Sync Log" buttons on the admin Devices page just
// insert a pending row here (the web app can never reach a LAN device
// directly) — this is the other half, run wherever this worker has network
// access to the device itself.
async function fetchPendingSyncEvents() {
  const { data, error } = await supabase
    .from('device_sync_events')
    .select('*, device:devices(*)')
    .eq('status', 'pending')
    .order('requested_at', { ascending: true });
  if (error) throw error;
  return data;
}

async function processSyncEvent(event) {
  const device = event.device;
  await supabase.from('device_sync_events').update({ status: 'running' }).eq('id', event.id);
  try {
    let summary;
    if (event.sync_type === 'users') {
      const rawUsers = await pullDeviceUsers(device);
      const { total, added } = await upsertUsers(device, rawUsers);
      summary = `${total} user(s) on device, ${added} new employee(s) added`;
    } else {
      const rawLogs = await pullDeviceLogs(device);
      const count = await upsertLogs(device, rawLogs);
      summary = `${rawLogs.length} record(s) on device, ${count} matched to an employee`;
    }
    console.log(`[${device.name}] ${event.sync_type} sync: ${summary}`);
    await supabase
      .from('device_sync_events')
      .update({ status: 'success', completed_at: new Date().toISOString(), summary })
      .eq('id', event.id);
    await supabase.from('devices').update({ last_sync: new Date().toISOString(), status: 'online' }).eq('id', device.id);
  } catch (err) {
    console.error(`[${device.name}] ${event.sync_type} sync failed:`, err.message);
    await supabase
      .from('device_sync_events')
      .update({ status: 'failed', completed_at: new Date().toISOString(), error: err.message })
      .eq('id', event.id);
    await supabase.from('devices').update({ status: 'offline' }).eq('id', device.id);
  }
}

async function pollSyncRequests() {
  const events = await fetchPendingSyncEvents();
  for (const event of events) {
    await processSyncEvent(event);
  }
}

async function main() {
  console.log(`ZKTeco bridge starting, polling every ${SYNC_INTERVAL_MS / 1000}s (sync requests every ${SYNC_REQUEST_POLL_MS / 1000}s)`);
  await syncAllDevices();
  setInterval(syncAllDevices, SYNC_INTERVAL_MS);
  setInterval(() => pollSyncRequests().catch(err => console.error('Sync request poll failed:', err.message)), SYNC_REQUEST_POLL_MS);
}

main().catch(err => {
  console.error('Fatal error in ZKTeco bridge:', err);
  process.exit(1);
});
