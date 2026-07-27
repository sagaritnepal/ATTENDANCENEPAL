const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const db = new Database(path.join(__dirname, 'attendance.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  department TEXT,
  fingerprint_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  ip_address TEXT NOT NULL DEFAULT '192.168.1.201',
  port INTEGER NOT NULL DEFAULT 4370,
  status TEXT NOT NULL DEFAULT 'online',
  last_sync TEXT
);
CREATE INDEX IF NOT EXISTS idx_devices_branch_status ON devices(branch_id, status);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'fixed',
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  grace_minutes INTEGER NOT NULL DEFAULT 10,
  department TEXT,
  employee_id INTEGER,
  FOREIGN KEY(employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS attendance_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  device_id INTEGER,
  punch_time TEXT NOT NULL,
  punch_type TEXT NOT NULL,
  verification_mode TEXT NOT NULL DEFAULT '1',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(employee_id) REFERENCES employees(id),
  FOREIGN KEY(device_id) REFERENCES devices(id),
  UNIQUE(employee_id, punch_time)
);
CREATE INDEX IF NOT EXISTS idx_logs_employee_time ON attendance_logs(employee_id, punch_time);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee',
  employee_id INTEGER,
  FOREIGN KEY(employee_id) REFERENCES employees(id)
);
`);

// Ensure a default admin user always exists
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username, password_hash, role, employee_id) VALUES (?, ?, ?, ?)')
    .run('admin', hash, 'admin', null);
  console.log('Created default admin user -> username: admin / password: admin123');
}

module.exports = db;
