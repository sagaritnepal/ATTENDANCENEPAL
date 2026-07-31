// Standalone worker: polls registered ZKTeco K40 terminals over TCP/IP (port 4370) and
// upserts raw punches into Supabase's attendance_logs table.
//
// Deploy this on-prem or on a small VM with LAN access to the devices — it needs a raw
// socket connection that a hosted Supabase Edge Function cannot provide. The mobile app and
// admin console never talk to devices directly; everything flows through attendance_logs.
require('dotenv').config();
const ZKLib = require('node-zklib');
const { createClient } = require('@supabase/supabase-js');

const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS || 60 * 1000);
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

async function pullDeviceLogs(device) {
  const zk = new ZKLib(device.ip_address, device.port, 10000, 4000);
  await zk.createSocket();
  try {
    const result = await zk.getAttendances();
    return result.data || [];
  } finally {
    await zk.disconnect();
  }
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

async function main() {
  console.log(`ZKTeco bridge starting, polling every ${SYNC_INTERVAL_MS / 1000}s`);
  await syncAllDevices();
  setInterval(syncAllDevices, SYNC_INTERVAL_MS);
}

main().catch(err => {
  console.error('Fatal error in ZKTeco bridge:', err);
  process.exit(1);
});
