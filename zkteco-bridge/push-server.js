// ZKTeco PUSH/ADMS receiver — multi-tenant, meant to run as ONE centrally
// hosted service for every company, not per-company like index.js. Here the
// device is the client: it's configured (in its own on-device Cloud Server /
// ADMS settings) to POST its data to this server over plain HTTP, so no
// process needs LAN access into any company's network and no laptop needs
// to stay on — the device just needs its own internet connection.
//
// Every request carries the device's serial number as the SN query param.
// That's the only way this server knows which company a push belongs to —
// it looks SN up against the `devices` table itself (service-role key,
// bypasses RLS) rather than trusting a single hardcoded COMPANY_ID the way
// the old single-tenant version of this file did. A device whose serial
// number isn't registered on the admin Devices page yet is refused (its
// data is dropped, not guessed at); a device already registered under
// company A can never have its punches attributed to company B, since the
// device_id/company_id pairing comes from that same devices-table lookup.
//
// The protocol itself is plain text, not JSON: tab-separated fields, records
// separated by \r\n. Only ATTLOG (attendance punches) is parsed into
// attendance_logs here, since that's the one table whose field layout is
// actually documented/known. BIODATA/OPERLOG (user enrollment) is still
// logged raw instead of guessed at — inspect a real payload from a live
// device before writing a parser for it. Until then, newly-enrolled
// fingerprints still need "Sync Users" run via index.js (the old per-company
// pull bridge) or manual entry in the admin UI to get an employees row.
require('dotenv').config();
const http = require('http');
const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');

// This server never uses Supabase Realtime (no .channel() subscriptions,
// just plain REST calls) — but createClient() eagerly constructs a
// RealtimeClient regardless, which throws on Node <22 without a native
// WebSocket global. Passing `ws` explicitly avoids that crash without
// requiring a Node upgrade.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  realtime: { transport: WebSocket },
});

const PORT = Number(process.env.PUSH_PORT || 8088);
const REFRESH_INTERVAL_MS = Number(process.env.REFRESH_INTERVAL_MS || 60 * 1000);
// No active poll can fail here the way index.js's TCP connect can — a
// device just stops pushing. Staleness is the only signal, so anything that
// hasn't pushed within this window gets swept to 'offline'.
const OFFLINE_AFTER_MS = Number(process.env.OFFLINE_AFTER_MS || 5 * 60 * 1000);

// serial_number -> { deviceId, companyId, name }, refreshed periodically so
// a device registered (or re-keyed to a new serial) on the admin Devices
// page is picked up without restarting this process.
let deviceBySerial = new Map();
async function refreshDevices() {
  const { data, error } = await supabase.from('devices').select('id, company_id, name, serial_number');
  if (error) {
    console.error('[push] refreshing device list failed:', error.message);
    return;
  }
  deviceBySerial = new Map(
    data.filter(d => d.serial_number).map(d => [d.serial_number, { deviceId: d.id, companyId: d.company_id, name: d.name }])
  );
}

// company_id -> (fingerprint_id -> employee_id). Scoped per company, never
// a single flat map — fingerprint IDs are small sequential integers that
// are very likely to collide across two different companies' devices.
let employeesByCompany = new Map();
async function refreshEmployees() {
  const { data, error } = await supabase.from('employees').select('id, fingerprint_id, company_id');
  if (error) {
    console.error('[push] refreshing employee cache failed:', error.message);
    return;
  }
  const next = new Map();
  for (const e of data) {
    if (!e.fingerprint_id) continue;
    let byFingerprint = next.get(e.company_id);
    if (!byFingerprint) {
      byFingerprint = new Map();
      next.set(e.company_id, byFingerprint);
    }
    byFingerprint.set(e.fingerprint_id, e.id);
  }
  employeesByCompany = next;
}

async function sweepOfflineDevices() {
  const cutoff = new Date(Date.now() - OFFLINE_AFTER_MS).toISOString();
  const { error } = await supabase.from('devices').update({ status: 'offline' }).eq('status', 'online').lt('last_sync', cutoff);
  if (error) console.error('[push] offline sweep failed:', error.message);
}

// Defensive counterpart to sweepOfflineDevices(): something outside this
// process has been observed re-marking a device 'offline' within seconds of
// markOnline() setting it 'online' (last_sync stays fresh, only status
// reverts) — a source never pinned down despite checking every known
// process/trigger/cron. Running this every REASSERT_INTERVAL_MS, well under
// that observed ~10-15s window, wins the race and keeps the displayed status
// honest regardless of what the other writer turns out to be. Actual
// attendance data was never affected by this — only the online/offline badge.
const REASSERT_INTERVAL_MS = Number(process.env.REASSERT_INTERVAL_MS || 10 * 1000);
async function reassertOnlineForRecentDevices() {
  const cutoff = new Date(Date.now() - OFFLINE_AFTER_MS).toISOString();
  const { error } = await supabase.from('devices').update({ status: 'online' }).eq('status', 'offline').gte('last_sync', cutoff);
  if (error) console.error('[push] reassert-online failed:', error.message);
}

refreshDevices();
refreshEmployees();
setInterval(refreshDevices, REFRESH_INTERVAL_MS);
setInterval(refreshEmployees, REFRESH_INTERVAL_MS);
setInterval(sweepOfflineDevices, 60 * 1000);
setInterval(reassertOnlineForRecentDevices, REASSERT_INTERVAL_MS);

// Warn once per (company, fingerprint) or per unknown serial instead of
// spamming the log every single push from the same misconfigured/unenrolled
// source.
const warnedUnmapped = new Set();
const warnedUnknownSerial = new Set();

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ATTLOG line format (from the device vendor's own protocol doc):
// UserID <tab> Timestamp <tab> State <tab> VerifyType <tab> ...
async function handleAttlog(companyId, deviceId, body) {
  const byFingerprint = employeesByCompany.get(companyId) ?? new Map();
  const lines = body.split(/\r\n|\n/).map(l => l.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    const fields = line.split('\t');
    const [userId, timestamp, state, verifyType] = fields;
    if (!userId || !timestamp) continue;

    const employeeId = byFingerprint.get(String(userId));
    if (!employeeId) {
      const key = `${companyId}:${userId}`;
      if (!warnedUnmapped.has(key)) {
        warnedUnmapped.add(key);
        console.warn(`[push] no employee mapped to fingerprint_id ${userId} for company ${companyId}, skipping (will not repeat this warning)`);
      }
      continue;
    }

    rows.push({
      employee_id: employeeId,
      device_id: deviceId,
      punch_time: new Date(timestamp.replace(' ', 'T')).toISOString(),
      punch_type: state === '1' ? '1' : '0',
      method: 'zkteco',
      verification_mode: verifyType ?? '1',
    });
  }
  if (rows.length === 0) return 0;

  const { error } = await supabase
    .from('attendance_logs')
    .upsert(rows, { onConflict: 'employee_id,punch_time', ignoreDuplicates: true })
    .select();
  if (error) {
    console.error('[push] attendance_logs upsert failed:', error.message);
    return 0;
  }
  return rows.length;
}

function logRawPayload(table, sn, body) {
  console.log(`[push] device ${sn} sent table=${table} (${body.length} bytes) — logging raw, no parser yet:`);
  console.log(body.slice(0, 2000));
}

async function markOnline(deviceId) {
  const { error } = await supabase.from('devices').update({ status: 'online', last_sync: new Date().toISOString() }).eq('id', deviceId);
  if (error) console.error('[push] marking device online failed:', error.message);
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host}`);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  const sn = url.searchParams.get('SN');
  const device = sn ? deviceBySerial.get(sn) : undefined;

  // Always answer 200/OK even for an unrecognized device — returning an
  // error here just makes the device retry-storm the exact same rejected
  // request. Its data is simply dropped until its serial number is
  // registered on the admin Devices page (refreshDevices() picks up a new
  // registration within REFRESH_INTERVAL_MS, no restart needed).
  if (!device) {
    if (sn && !warnedUnknownSerial.has(sn)) {
      warnedUnknownSerial.add(sn);
      console.warn(`[push] unknown device serial "${sn}" — register it (with this exact serial number) on the admin Devices page first`);
    }
    res.writeHead(sn ? 200 : 400, { 'Content-Type': 'text/plain' });
    res.end(sn ? 'OK' : 'Missing SN');
    return;
  }

  try {
    if (req.method === 'GET' && url.pathname === '/iclock/cdata') {
      console.log(`[push] device ${device.name} (${sn}) initializing:`, url.search);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(
        [
          `GET OPTION FROM: ${sn}`,
          'Stamp=9999',
          'OpStamp=9999',
          'ErrorDelay=30',
          'Delay=30',
          'TransTimes=00:00;23:59',
          'TransInterval=1',
          'TransFlag=1111000000',
          'Realtime=1',
          'Encrypt=0',
          '',
        ].join('\r\n')
      );
      return;
    }

    if (req.method === 'POST' && url.pathname === '/iclock/cdata') {
      const table = url.searchParams.get('table') ?? '';
      const body = await readBody(req);
      if (table === 'ATTLOG') {
        const count = await handleAttlog(device.companyId, device.deviceId, body);
        console.log(`[push] ${device.name}: ${count} punch(es) upserted`);
      } else {
        logRawPayload(table, sn, body);
      }
      await markOnline(device.deviceId);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/iclock/getrequest') {
      // No pending commands to hand back right now.
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
      return;
    }

    if (req.method === 'POST' && url.pathname === '/iclock/devicecmd') {
      const body = await readBody(req);
      console.log(`[push] ${device.name} command ack:`, body);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
      return;
    }

    res.writeHead(404);
    res.end();
  } catch (err) {
    console.error('[push] request handling failed:', err.message);
    res.writeHead(500);
    res.end();
  }
});

process.on('unhandledRejection', err => {
  console.error('[push] unhandled rejection (ignored, server keeps running):', err);
});

server.listen(PORT, () => {
  console.log(`ZKTeco PUSH/ADMS receiver (multi-tenant) listening on 0.0.0.0:${PORT}`);
});
