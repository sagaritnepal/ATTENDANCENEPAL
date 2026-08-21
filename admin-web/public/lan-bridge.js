// Embedded version of zkteco-bridge/index.js — polls ZKTeco terminals on
// this PC's local network over TCP/IP (port 4370) and upserts punches into
// Supabase, exactly like the standalone script, but living inside this
// Electron app instead of needing its own separate always-running process.
// Runs only once configure() has been given a device-bridge credential
// (generated from the dashboard's Devices page) — until then it's inert.
//
// Same trust model as the standalone bridge: signs in as a normal Supabase
// Auth user (never the service-role master key), so everything below is
// automatically scoped to that credential's own company by Postgres RLS,
// not by trusting this code to filter correctly.
const ZKLib = require('node-zklib');
const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

// Same values admin-web's own browser code already ships with — the anon
// key is meant to be public (protected by RLS, not secrecy), same as
// SUPABASE_URL in main.js.
const SUPABASE_URL = 'https://whaahjtqmlbwrfppogsw.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndoYWFoanRxbWxid3JmcHBvZ3N3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUxNDk4NzEsImV4cCI6MjEwMDcyNTg3MX0.DZiANjUeVkelmk59ttdOu-6YaHCrjtEaW9sCxo3P4D4';

const SYNC_INTERVAL_MS = 15 * 1000;
const SYNC_REQUEST_POLL_MS = 15 * 1000;
const MAX_BACKOFF_MS = 10 * 60 * 1000;

let supabase = null;
let companyId = null;
let syncTimer = null;
let syncRequestTimer = null;
let running = false;
const failureCounts = new Map();
const warnedUnmappedFingerprints = new Set();

const status = {
  configured: false,
  running: false,
  companyId: null,
  lastError: null,
  lastSyncAt: null,
};

function getStatus() {
  return { ...status };
}

async function fetchActiveDevices() {
  const { data, error } = await supabase.from('devices').select('*').eq('company_id', companyId);
  if (error) throw error;
  return data;
}

async function fetchEmployeeByFingerprint(fingerprintId) {
  const { data, error } = await supabase
    .from('employees')
    .select('id')
    .eq('fingerprint_id', String(fingerprintId))
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// See index.js's withDevice() for why this timeout wrapper exists — a
// hung getAttendances()/getUsers() call (no error event ever fires) leaves
// busyDeviceIds wedged forever without it, confirmed happening live.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

async function withDevice(device, fn) {
  const zk = new ZKLib(device.ip_address, device.port, 10000, 4000);
  await withTimeout(zk.createSocket(), 15000, `${device.name}: connect`);
  try {
    return await withTimeout(fn(zk), 30000, `${device.name}: operation`);
  } finally {
    await withTimeout(zk.disconnect(), 5000, `${device.name}: disconnect`).catch(() => {});
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
      const key = `${device.id}:${log.deviceUserId}`;
      if (!warnedUnmappedFingerprints.has(key)) {
        warnedUnmappedFingerprints.add(key);
        console.warn(`[lan-bridge] ${device.name}: no employee mapped to fingerprint_id ${log.deviceUserId}, skipping (won't repeat this warning)`);
      }
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

  const { data: inserted, error } = await supabase
    .from('attendance_logs')
    .upsert(rows, { onConflict: 'employee_id,punch_time', ignoreDuplicates: true })
    .select();
  if (error) throw error;
  return inserted.length;
}

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
      company_id: companyId,
    });
    if (error) throw error;
    added++;
  }
  return { total: rawUsers.length, added };
}

async function syncDevice(device) {
  try {
    const rawLogs = await pullDeviceLogs(device);
    const count = await withTimeout(upsertLogs(device, rawLogs), 30000, `${device.name}: upsertLogs`);
    if (count > 0) console.log(`[lan-bridge] ${device.name}: synced ${count} new punch(es)`);
    failureCounts.set(device.id, 0);
    await supabase.from('devices').update({ last_sync: new Date().toISOString(), status: 'online' }).eq('id', device.id);
    status.lastSyncAt = new Date().toISOString();
    status.lastError = null;
  } catch (err) {
    const failures = (failureCounts.get(device.id) || 0) + 1;
    failureCounts.set(device.id, failures);
    const backoff = Math.min(MAX_BACKOFF_MS, SYNC_INTERVAL_MS * 2 ** failures);
    console.error(`[lan-bridge] ${device.name} sync failed (attempt ${failures}), next retry in ${Math.round(backoff / 1000)}s:`, err.message);
    await supabase.from('devices').update({ status: 'offline' }).eq('id', device.id);
    status.lastError = `${device.name}: ${err.message}`;
  }
}

async function syncAllDevices() {
  const devices = await fetchActiveDevices();
  for (const device of devices) {
    await syncDevice(device);
  }
}

async function fetchPendingSyncEvents() {
  const { data, error } = await supabase
    .from('device_sync_events')
    .select('*, device:devices(*)')
    .eq('status', 'pending')
    .eq('company_id', companyId)
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
      const { total, added } = await withTimeout(upsertUsers(device, rawUsers), 30000, `${device.name}: upsertUsers`);
      summary = `${total} user(s) on device, ${added} new employee(s) added`;
    } else {
      const rawLogs = await pullDeviceLogs(device);
      const count = await withTimeout(upsertLogs(device, rawLogs), 30000, `${device.name}: upsertLogs`);
      summary = `${rawLogs.length} record(s) on device, ${count} matched to an employee`;
    }
    console.log(`[lan-bridge] ${device.name} ${event.sync_type} sync: ${summary}`);
    await supabase
      .from('device_sync_events')
      .update({ status: 'success', completed_at: new Date().toISOString(), summary })
      .eq('id', event.id);
    await supabase.from('devices').update({ last_sync: new Date().toISOString(), status: 'online' }).eq('id', device.id);
  } catch (err) {
    console.error(`[lan-bridge] ${device.name} ${event.sync_type} sync failed:`, err.message);
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

// Called once at startup (with saved credentials, if any) and again
// whenever the settings window saves a new/changed credential.
async function configure(email, password) {
  stop();
  status.configured = false;
  status.lastError = null;

  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: true, persistSession: false },
    realtime: { transport: WebSocket },
  });

  const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError) {
    status.lastError = `Sign-in failed: ${authError.message}`;
    throw new Error(status.lastError);
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile, error: profileError } = await supabase.from('profiles').select('company_id').eq('id', user.id).single();
  if (profileError || !profile?.company_id) {
    status.lastError = 'Signed in, but this account has no company — it may not be a valid device bridge credential.';
    throw new Error(status.lastError);
  }

  companyId = profile.company_id;
  status.configured = true;
  status.companyId = companyId;
  start();
}

function start() {
  if (running || !supabase) return;
  running = true;
  status.running = true;
  console.log(`[lan-bridge] starting, polling every ${SYNC_INTERVAL_MS / 1000}s for company ${companyId}`);
  syncAllDevices().catch(err => console.error('[lan-bridge] initial sync failed:', err.message));
  syncTimer = setInterval(() => syncAllDevices().catch(err => console.error('[lan-bridge] device sync poll failed:', err.message)), SYNC_INTERVAL_MS);
  syncRequestTimer = setInterval(
    () => pollSyncRequests().catch(err => console.error('[lan-bridge] sync request poll failed:', err.message)),
    SYNC_REQUEST_POLL_MS
  );
}

function stop() {
  if (syncTimer) clearInterval(syncTimer);
  if (syncRequestTimer) clearInterval(syncRequestTimer);
  syncTimer = null;
  syncRequestTimer = null;
  running = false;
  status.running = false;
}

module.exports = { configure, start, stop, getStatus };
