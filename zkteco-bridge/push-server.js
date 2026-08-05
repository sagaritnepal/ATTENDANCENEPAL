// ZKTeco PUSH/ADMS receiver — the opposite direction from index.js (which
// connects OUT to a device over TCP). Here the device is the client: it's
// configured (in its own on-device Cloud Server / ADMS settings) to POST
// its data to us over plain HTTP. Standalone, one instance per company —
// same COMPANY_ID convention as index.js, read from the same .env file.
//
// The protocol is plain text, not JSON: tab-separated fields, records
// separated by \r\n. Only ATTLOG (attendance punches) is parsed into
// attendance_logs here, since that's the one table whose field layout is
// actually documented/known. BIODATA (and anything else) is logged raw
// instead of guessed at — inspect real payloads once a device is actually
// pushing before writing a parser for it.
require('dotenv').config();
const http = require('http');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const COMPANY_ID = process.env.COMPANY_ID;
if (!COMPANY_ID) {
  throw new Error('COMPANY_ID is required — set it in .env to the companies.id this receiver belongs to.');
}

const PORT = Number(process.env.PUSH_PORT || 8088);

// fingerprint_id -> employee id, refreshed periodically so newly-enrolled
// device users get picked up without a restart.
let employeeCache = new Map();
async function refreshEmployeeCache() {
  const { data, error } = await supabase.from('employees').select('id, fingerprint_id').eq('company_id', COMPANY_ID);
  if (error) {
    console.error('[push] refreshing employee cache failed:', error.message);
    return;
  }
  employeeCache = new Map(data.filter(e => e.fingerprint_id).map(e => [e.fingerprint_id, e.id]));
}
refreshEmployeeCache();
setInterval(refreshEmployeeCache, 60000);

const warnedUnmapped = new Set();

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
async function handleAttlog(body) {
  const lines = body.split(/\r\n|\n/).map(l => l.trim()).filter(Boolean);
  const rows = [];
  for (const line of lines) {
    const fields = line.split('\t');
    const [userId, timestamp, state, verifyType] = fields;
    if (!userId || !timestamp) continue;

    const employeeId = employeeCache.get(String(userId));
    if (!employeeId) {
      if (!warnedUnmapped.has(userId)) {
        warnedUnmapped.add(userId);
        console.warn(`[push] no employee mapped to fingerprint_id ${userId}, skipping (will not repeat this warning)`);
      }
      continue;
    }

    rows.push({
      employee_id: employeeId,
      punch_time: new Date(timestamp.replace(' ', 'T')).toISOString(),
      punch_type: state === '1' ? '1' : '0',
      method: 'zkteco',
      verification_mode: verifyType ?? '1',
    });
  }
  if (rows.length === 0) return 0;

  const { error } = await supabase
    .from('attendance_logs')
    .upsert(rows, { onConflict: 'employee_id,punch_time', ignoreDuplicates: true });
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

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host}`);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  const sn = url.searchParams.get('SN') ?? 'unknown';

  try {
    if (req.method === 'GET' && url.pathname === '/iclock/cdata') {
      console.log(`[push] device ${sn} initializing:`, url.search);
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
        const count = await handleAttlog(body);
        console.log(`[push] device ${sn}: ${count} punch(es) upserted`);
      } else {
        logRawPayload(table, sn, body);
      }
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
      console.log(`[push] device ${sn} command ack:`, body);
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

server.listen(PORT, () => {
  console.log(`ZKTeco PUSH/ADMS receiver listening on 0.0.0.0:${PORT}`);
});
