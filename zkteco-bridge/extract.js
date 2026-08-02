// One-off extraction script: connects directly to a ZKTeco K40 over TCP and
// dumps enrolled users + attendance logs to the console and to JSON files,
// so we can see what's actually on the device before wiring it into the
// Supabase sync (index.js). Does not touch Supabase.
//
// Usage: node extract.js [ip] [port]
const ZKLib = require('node-zklib');
const fs = require('fs');

const IP = process.argv[2] || '192.168.1.201';
const PORT = Number(process.argv[3] || 4370);

async function main() {
  const zk = new ZKLib(IP, PORT, 10000, 4000);
  console.log(`Connecting to ${IP}:${PORT}...`);
  await zk.createSocket();
  console.log('Connected.');

  try {
    const info = await zk.getInfo().catch(err => {
      console.warn('getInfo() failed (non-fatal):', err.message);
      return null;
    });
    if (info) console.log('Device info:', info);

    const users = await zk.getUsers();
    console.log(`\n${users.data.length} enrolled user(s):`);
    console.table(users.data.map(u => ({ userId: u.userId, name: u.name, uid: u.uid, cardno: u.cardno, role: u.role })));

    const logs = await zk.getAttendances();
    console.log(`\n${logs.data.length} attendance record(s):`);
    console.table(
      logs.data.slice(0, 20).map(l => ({ deviceUserId: l.deviceUserId, recordTime: l.recordTime, type: l.type, verifyMethod: l.verifyMethod }))
    );
    if (logs.data.length > 20) console.log(`...and ${logs.data.length - 20} more (see extract-logs.json).`);

    fs.writeFileSync('extract-users.json', JSON.stringify(users.data, null, 2));
    fs.writeFileSync('extract-logs.json', JSON.stringify(logs.data, null, 2));
    console.log('\nSaved full dumps to zkteco-bridge/extract-users.json and extract-logs.json');
  } finally {
    await zk.disconnect();
  }
}

main().catch(err => {
  console.error('Failed to connect/extract:', err.message);
  process.exit(1);
});
