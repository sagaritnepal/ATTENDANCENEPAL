const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const http = require('http');
const { Server } = require('socket.io');

const db = require('./db');
const { buildPayrollReport, findShiftForEmployee } = require('./calc');

const JWT_SECRET = 'attendance-prototype-secret-change-me';
const PORT = process.env.PORT || 4000;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

io.on('connection', () => {});

// ---------- Auth ----------
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, employee_id: user.employee_id },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
  res.json({ token, role: user.role, username: user.username, employee_id: user.employee_id });
});

app.post('/api/auth/register-employee-login', authenticate, requireAdmin, (req, res) => {
  const { username, password, employee_id, role } = req.body;
  if (!username || !password || !employee_id) return res.status(400).json({ error: 'username, password, employee_id required' });
  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = db.prepare('INSERT INTO users (username, password_hash, role, employee_id) VALUES (?, ?, ?, ?)')
      .run(username, hash, role || 'employee', employee_id);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- Employees ----------
app.get('/api/employees', authenticate, (req, res) => {
  res.json(db.prepare('SELECT * FROM employees ORDER BY id DESC').all());
});

app.post('/api/employees', authenticate, requireAdmin, (req, res) => {
  const { employee_code, name, email, department, fingerprint_id, status } = req.body;
  if (!employee_code || !name) return res.status(400).json({ error: 'employee_code and name are required' });
  try {
    const info = db.prepare(
      'INSERT INTO employees (employee_code, name, email, department, fingerprint_id, status) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(employee_code, name, email || null, department || null, fingerprint_id || null, status || 'active');
    res.status(201).json(db.prepare('SELECT * FROM employees WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/employees/:id', authenticate, requireAdmin, (req, res) => {
  const { employee_code, name, email, department, fingerprint_id, status } = req.body;
  const existing = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare(
    'UPDATE employees SET employee_code=?, name=?, email=?, department=?, fingerprint_id=?, status=? WHERE id=?'
  ).run(
    employee_code ?? existing.employee_code,
    name ?? existing.name,
    email ?? existing.email,
    department ?? existing.department,
    fingerprint_id ?? existing.fingerprint_id,
    status ?? existing.status,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id));
});

app.delete('/api/employees/:id', authenticate, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM employees WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Devices ----------
app.get('/api/devices', authenticate, (req, res) => {
  res.json(db.prepare('SELECT * FROM devices ORDER BY id DESC').all());
});

app.post('/api/devices', authenticate, requireAdmin, (req, res) => {
  const { name, branch_id, ip_address, port, status } = req.body;
  if (!name || !branch_id) return res.status(400).json({ error: 'name and branch_id are required' });
  const info = db.prepare(
    'INSERT INTO devices (name, branch_id, ip_address, port, status) VALUES (?, ?, ?, ?, ?)'
  ).run(name, branch_id, ip_address || '192.168.1.201', port || 4370, status || 'online');
  res.status(201).json(db.prepare('SELECT * FROM devices WHERE id = ?').get(info.lastInsertRowid));
});

app.delete('/api/devices/:id', authenticate, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM devices WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Simulated ZKTeco K40 sync: pulls "raw logs" from a device over TCP/IP (simulated),
// upserts using composite unique key (employee_id, punch_time) to guarantee no duplicates.
app.post('/api/devices/:id/sync', authenticate, requireAdmin, (req, res) => {
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  const employees = db.prepare("SELECT * FROM employees WHERE status = 'active' AND fingerprint_id IS NOT NULL").all();
  if (employees.length === 0) {
    return res.status(400).json({ error: 'No active employees with fingerprint_id registered to simulate punches for' });
  }

  const insertStmt = db.prepare(
    'INSERT OR IGNORE INTO attendance_logs (employee_id, device_id, punch_time, punch_type, verification_mode) VALUES (?, ?, ?, ?, ?)'
  );

  const created = [];
  const now = new Date();
  const sample = employees.sort(() => Math.random() - 0.5).slice(0, Math.min(employees.length, Math.max(1, Math.floor(Math.random() * employees.length) + 1)));

  const insertMany = db.transaction((rows) => {
    for (const row of rows) {
      const info = insertStmt.run(row.employee_id, row.device_id, row.punch_time, row.punch_type, row.verification_mode);
      if (info.changes > 0) created.push(row);
    }
  });

  const rows = sample.map(emp => {
    const punchType = Math.random() > 0.5 ? '0' : '1';
    const jitterMin = Math.floor(Math.random() * 20) - 10;
    const punchTime = new Date(now.getTime() + jitterMin * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    return {
      employee_id: emp.id,
      device_id: device.id,
      punch_time: punchTime,
      punch_type: punchType,
      verification_mode: Math.random() > 0.3 ? '1' : '4',
    };
  });

  insertMany(rows);

  db.prepare("UPDATE devices SET last_sync = datetime('now'), status = 'online' WHERE id = ?").run(device.id);

  created.forEach(row => {
    const emp = employees.find(e => e.id === row.employee_id);
    io.emit('punch', { employee_id: row.employee_id, employee_name: emp ? emp.name : 'Unknown', punch_time: row.punch_time, punch_type: row.punch_type, source: device.name });
  });

  res.json({ device: device.name, synced: created.length, logs: created });
});

// ---------- Attendance ----------
// Direct punch ingestion endpoint mimicking the ZKTeco payload shape from the architecture guide.
app.post('/api/attendance/punch', (req, res) => {
  const { deviceUserId, recordTime, punchType, verificationMode, deviceId } = req.body;
  if (!deviceUserId || !recordTime) return res.status(400).json({ error: 'deviceUserId and recordTime are required' });

  const employee = db.prepare('SELECT * FROM employees WHERE fingerprint_id = ?').get(String(deviceUserId));
  if (!employee) return res.status(404).json({ error: `No employee mapped to fingerprint/device user id ${deviceUserId}` });

  try {
    const info = db.prepare(
      'INSERT INTO attendance_logs (employee_id, device_id, punch_time, punch_type, verification_mode) VALUES (?, ?, ?, ?, ?)'
    ).run(employee.id, deviceId || null, recordTime, String(punchType ?? '0'), String(verificationMode ?? '1'));

    io.emit('punch', { employee_id: employee.id, employee_name: employee.name, punch_time: recordTime, punch_type: String(punchType ?? '0'), source: 'manual-punch' });

    res.status(201).json(db.prepare('SELECT * FROM attendance_logs WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    // Composite unique key (employee_id, punch_time) guarantees no duplicate logs
    res.status(409).json({ error: 'Duplicate punch ignored (already recorded)', detail: e.message });
  }
});

app.get('/api/attendance/logs', authenticate, (req, res) => {
  let { employee_id, from, to } = req.query;
  // RBAC: non-admins can only ever see their own attendance history
  if (req.user.role !== 'admin') {
    employee_id = req.user.employee_id;
    if (!employee_id) return res.json([]);
  }
  let sql = `SELECT al.*, e.name as employee_name, e.employee_code FROM attendance_logs al
             JOIN employees e ON e.id = al.employee_id WHERE 1=1`;
  const params = [];
  if (employee_id) { sql += ' AND al.employee_id = ?'; params.push(employee_id); }
  if (from) { sql += ' AND al.punch_time >= ?'; params.push(from); }
  if (to) { sql += ' AND al.punch_time <= ?'; params.push(to); }
  sql += ' ORDER BY al.punch_time DESC LIMIT 500';
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/attendance/today-summary', authenticate, (req, res) => {
  const todayStr = new Date().toISOString().slice(0, 10);
  const employees = db.prepare("SELECT * FROM employees WHERE status = 'active'").all();
  const logs = db.prepare("SELECT * FROM attendance_logs WHERE punch_time LIKE ?").all(todayStr + '%');

  const byEmployee = {};
  for (const log of logs) {
    byEmployee[log.employee_id] = byEmployee[log.employee_id] || [];
    byEmployee[log.employee_id].push(log);
  }

  let present = 0, late = 0, absent = 0;
  for (const emp of employees) {
    const empLogs = byEmployee[emp.id];
    if (!empLogs || empLogs.length === 0) { absent++; continue; }
    present++;
    const record = require('./calc').calculateDailyRecord(db, emp, todayStr, empLogs);
    if (record.is_late) late++;
  }

  res.json({ date: todayStr, total_employees: employees.length, present, late, absent, recent_logs: logs.sort((a,b)=>b.punch_time.localeCompare(a.punch_time)).slice(0, 10) });
});

// ---------- Shifts ----------
app.get('/api/shifts', authenticate, (req, res) => {
  res.json(db.prepare('SELECT * FROM shifts ORDER BY id DESC').all());
});

app.post('/api/shifts', authenticate, requireAdmin, (req, res) => {
  const { name, type, start_time, end_time, grace_minutes, department, employee_id } = req.body;
  if (!name || !start_time || !end_time) return res.status(400).json({ error: 'name, start_time, end_time required' });
  const info = db.prepare(
    'INSERT INTO shifts (name, type, start_time, end_time, grace_minutes, department, employee_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(name, type || 'fixed', start_time, end_time, grace_minutes ?? 10, department || null, employee_id || null);
  res.status(201).json(db.prepare('SELECT * FROM shifts WHERE id = ?').get(info.lastInsertRowid));
});

app.delete('/api/shifts/:id', authenticate, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM shifts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Payroll ----------
app.get('/api/payroll/report', authenticate, (req, res) => {
  let { employee_id, from, to } = req.query;
  // RBAC: non-admins can only ever generate their own report
  if (req.user.role !== 'admin') {
    employee_id = req.user.employee_id;
    if (!employee_id) return res.json([]);
  }
  const employees = employee_id
    ? [db.prepare('SELECT * FROM employees WHERE id = ?').get(employee_id)].filter(Boolean)
    : db.prepare("SELECT * FROM employees WHERE status = 'active'").all();

  const fromDate = from || '0000-01-01';
  const toDate = to || '9999-12-31';

  const report = [];
  for (const emp of employees) {
    const logs = db.prepare(
      'SELECT * FROM attendance_logs WHERE employee_id = ? AND punch_time >= ? AND punch_time <= ? ORDER BY punch_time ASC'
    ).all(emp.id, fromDate, toDate + 'T23:59:59Z');
    report.push(...buildPayrollReport(db, emp, logs));
  }
  res.json(report);
});

app.get('/api/me', authenticate, (req, res) => {
  res.json(req.user);
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Attendance Management System prototype running at http://localhost:${PORT}`);
});
