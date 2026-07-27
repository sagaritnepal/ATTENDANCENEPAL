const db = require('./db');
const bcrypt = require('bcryptjs');

console.log('Seeding sample data...');

const insertEmployee = db.prepare(
  'INSERT OR IGNORE INTO employees (employee_code, name, email, department, fingerprint_id, status) VALUES (?, ?, ?, ?, ?, ?)'
);

const employees = [
  ['EMP-001', 'Sagar Rayamajhi', 'sagaritnepal@gmail.com', 'Engineering', '1001', 'active'],
  ['EMP-002', 'Alina Gurung', 'alina@example.com', 'Engineering', '1002', 'active'],
  ['EMP-003', 'Bikash Shrestha', 'bikash@example.com', 'Sales', '1003', 'active'],
  ['EMP-004', 'Nisha Thapa', 'nisha@example.com', 'Sales', '1004', 'active'],
  ['EMP-005', 'Rojan Karki', 'rojan@example.com', 'HR', '1005', 'active'],
  ['EMP-006', 'Sujata Basnet', 'sujata@example.com', 'HR', '1006', 'active'],
];

for (const e of employees) insertEmployee.run(...e);

const insertDevice = db.prepare(
  'INSERT OR IGNORE INTO devices (name, branch_id, ip_address, port, status) VALUES (?, ?, ?, ?, ?)'
);
insertDevice.run('ZKTeco K40 - Main Gate', 'HQ', '192.168.1.201', 4370, 'online');
insertDevice.run('ZKTeco K40 - Branch Office', 'BR-01', '192.168.2.201', 4370, 'online');

const insertShift = db.prepare(
  'INSERT OR IGNORE INTO shifts (name, type, start_time, end_time, grace_minutes, department, employee_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
insertShift.run('Engineering Day Shift', 'fixed', '09:00', '18:00', 10, 'Engineering', null);
insertShift.run('Sales Flexible Shift', 'flexible', '10:00', '19:00', 15, 'Sales', null);
insertShift.run('HR Day Shift', 'fixed', '09:30', '17:30', 10, 'HR', null);

// Employee-facing login for the first seeded employee (self-service demo)
const emp1 = db.prepare('SELECT * FROM employees WHERE employee_code = ?').get('EMP-001');
if (emp1) {
  const existingUser = db.prepare('SELECT * FROM users WHERE employee_id = ?').get(emp1.id);
  if (!existingUser) {
    db.prepare('INSERT INTO users (username, password_hash, role, employee_id) VALUES (?, ?, ?, ?)')
      .run('sagar', bcrypt.hashSync('sagar123', 10), 'employee', emp1.id);
    console.log('Created employee login -> username: sagar / password: sagar123');
  }
}

// Backfill 7 days of realistic attendance logs for demo purposes
const allEmployees = db.prepare('SELECT * FROM employees').all();
const insertLog = db.prepare(
  'INSERT OR IGNORE INTO attendance_logs (employee_id, device_id, punch_time, punch_type, verification_mode) VALUES (?, ?, ?, ?, ?)'
);

function pad(n) { return String(n).padStart(2, '0'); }

const today = new Date();
for (let dayOffset = 7; dayOffset >= 1; dayOffset--) {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() - dayOffset);
  const day = d.getUTCDay();
  if (day === 0 || day === 6) continue; // skip weekends

  const dateStr = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

  for (const emp of allEmployees) {
    if (Math.random() < 0.08) continue; // occasional absence

    const lateChance = Math.random();
    const baseInHour = 9;
    const inMinuteOffset = lateChance > 0.75 ? Math.floor(Math.random() * 40) + 5 : Math.floor(Math.random() * 8);
    const checkIn = `${dateStr}T${pad(baseInHour)}:${pad(inMinuteOffset)}:00Z`;

    const overtimeChance = Math.random();
    const baseOutHour = 18;
    const outMinuteOffset = overtimeChance > 0.8 ? Math.floor(Math.random() * 90) + 10 : Math.floor(Math.random() * 15);
    const checkOut = `${dateStr}T${pad(baseOutHour)}:${pad(Math.min(outMinuteOffset, 59))}:00Z`;

    insertLog.run(emp.id, 1, checkIn, '0', '1');
    insertLog.run(emp.id, 1, checkOut, '1', '1');
  }
}

console.log('Seed complete.');
console.log('Login as admin -> username: admin / password: admin123');
console.log('Login as employee -> username: sagar / password: sagar123');
