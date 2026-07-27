const state = {
  token: localStorage.getItem('ams_token') || null,
  role: localStorage.getItem('ams_role') || null,
  username: localStorage.getItem('ams_username') || null,
  employees: [],
  devices: [],
  shifts: [],
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

async function api(path, options = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch('/api' + path, Object.assign({}, options, { headers }));
  if (res.status === 401) {
    logout();
    throw new Error('Session expired, please log in again');
  }
  const contentType = res.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await res.json() : null;
  if (!res.ok) throw new Error((body && body.error) || 'Request failed');
  return body;
}

function fmtDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString();
}

function fmtTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toUTCString().slice(17, 22);
}

// ---------------- Auth ----------------
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('#login-username').value.trim();
  const password = $('#login-password').value;
  $('#login-error').textContent = '';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Login failed');
    state.token = body.token;
    state.role = body.role;
    state.username = body.username;
    localStorage.setItem('ams_token', body.token);
    localStorage.setItem('ams_role', body.role);
    localStorage.setItem('ams_username', body.username);
    enterApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

function logout() {
  state.token = null;
  state.role = null;
  localStorage.removeItem('ams_token');
  localStorage.removeItem('ams_role');
  localStorage.removeItem('ams_username');
  $('#app').classList.add('hidden');
  $('#login-screen').classList.remove('hidden');
}
$('#logout-btn').addEventListener('click', logout);

function enterApp() {
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#user-label').textContent = `${state.username} (${state.role})`;
  if (state.role !== 'admin') {
    $$('.admin-only').forEach(el => el.style.display = 'none');
  } else {
    $$('.admin-only').forEach(el => el.style.display = '');
  }
  initSocket();
  loadDashboard();
}

// ---------------- Tabs ----------------
$$('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.tab-panel').forEach(p => p.classList.remove('active'));
    $('#tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'dashboard') loadDashboard();
    if (btn.dataset.tab === 'employees') loadEmployees();
    if (btn.dataset.tab === 'devices') loadDevices();
    if (btn.dataset.tab === 'shifts') loadShifts();
    if (btn.dataset.tab === 'logs') loadLogs();
    if (btn.dataset.tab === 'payroll') loadEmployeeFilters();
  });
});

// ---------------- Socket.io live feed ----------------
function initSocket() {
  const socket = io();
  socket.on('punch', (evt) => {
    addLiveFeedItem(evt);
    loadDashboardStatsOnly();
  });
}

function addLiveFeedItem(evt) {
  const li = document.createElement('li');
  const typeLabel = evt.punch_type === '0' ? 'Check-In' : 'Check-Out';
  li.innerHTML = `<span><strong>${evt.employee_name}</strong> &mdash; ${typeLabel} <span class="muted">via ${evt.source}</span></span><span class="muted">${fmtDateTime(evt.punch_time)}</span>`;
  const feed = $('#live-feed');
  feed.prepend(li);
  while (feed.children.length > 15) feed.removeChild(feed.lastChild);
}

// ---------------- Dashboard ----------------
async function loadDashboardStatsOnly() {
  try {
    const summary = await api('/attendance/today-summary');
    $('#stat-total').textContent = summary.total_employees;
    $('#stat-present').textContent = summary.present;
    $('#stat-late').textContent = summary.late;
    $('#stat-absent').textContent = summary.absent;
  } catch (e) { /* ignore */ }
}

async function loadDashboard() {
  await loadDashboardStatsOnly();
  try {
    const summary = await api('/attendance/today-summary');
    if (state.employees.length === 0) await loadEmployeesData();
    renderRecentLogs(summary.recent_logs);
  } catch (e) { console.error(e); }
}

async function loadEmployeesData() {
  state.employees = await api('/employees');
}

function renderRecentLogs(logs) {
  const feed = $('#live-feed');
  feed.innerHTML = '';
  if (!logs.length) return;
  logs.forEach(log => {
    const emp = state.employees.find(e => e.id === log.employee_id);
    addLiveFeedItem({
      employee_name: emp ? emp.name : `Employee #${log.employee_id}`,
      punch_type: log.punch_type,
      punch_time: log.punch_time,
      source: 'sync',
    });
  });
}

// ---------------- Employees ----------------
async function loadEmployees() {
  await loadEmployeesData();
  const tbody = $('#employees-table tbody');
  tbody.innerHTML = '';
  state.employees.forEach(emp => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${emp.employee_code}</td>
      <td>${emp.name}</td>
      <td>${emp.email || '-'}</td>
      <td>${emp.department || '-'}</td>
      <td>${emp.fingerprint_id || '-'}</td>
      <td><span class="badge ${emp.status}">${emp.status}</span></td>
      <td><button class="btn small danger" data-del-employee="${emp.id}">Delete</button></td>
    `;
    tbody.appendChild(tr);
  });
  $$('[data-del-employee]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this employee?')) return;
      await api('/employees/' + btn.dataset.delEmployee, { method: 'DELETE' });
      loadEmployees();
    });
  });
}

$('#new-employee-btn').addEventListener('click', () => {
  openModal('Add Employee', [
    { name: 'employee_code', label: 'Employee Code', required: true, placeholder: 'EMP-007' },
    { name: 'name', label: 'Full Name', required: true },
    { name: 'email', label: 'Email' },
    { name: 'department', label: 'Department' },
    { name: 'fingerprint_id', label: 'Fingerprint / Device User ID', placeholder: 'Maps to ZKTeco device user id' },
  ], async (values) => {
    await api('/employees', { method: 'POST', body: JSON.stringify(values) });
    loadEmployees();
  });
});

// ---------------- Devices ----------------
async function loadDevices() {
  state.devices = await api('/devices');
  const tbody = $('#devices-table tbody');
  tbody.innerHTML = '';
  state.devices.forEach(dev => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${dev.name}</td>
      <td>${dev.branch_id}</td>
      <td>${dev.ip_address}:${dev.port}</td>
      <td><span class="badge ${dev.status}">${dev.status}</span></td>
      <td>${dev.last_sync ? fmtDateTime(dev.last_sync) : 'Never'}</td>
      <td>
        <button class="btn small" data-sync-device="${dev.id}">Sync Now</button>
        <button class="btn small danger" data-del-device="${dev.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  $$('[data-sync-device]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Syncing...';
      try {
        const result = await api('/devices/' + btn.dataset.syncDevice + '/sync', { method: 'POST' });
        alert(`Synced ${result.synced} new punch record(s) from ${result.device}`);
        loadDevices();
        loadDashboardStatsOnly();
      } catch (e) {
        alert(e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Sync Now';
      }
    });
  });
  $$('[data-del-device]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this device?')) return;
      await api('/devices/' + btn.dataset.delDevice, { method: 'DELETE' });
      loadDevices();
    });
  });
}

$('#new-device-btn').addEventListener('click', () => {
  openModal('Register Device', [
    { name: 'name', label: 'Device Name', required: true, placeholder: 'ZKTeco K40 - Main Gate' },
    { name: 'branch_id', label: 'Branch ID', required: true, placeholder: 'HQ' },
    { name: 'ip_address', label: 'IP Address', placeholder: '192.168.1.201' },
    { name: 'port', label: 'Port', placeholder: '4370' },
  ], async (values) => {
    values.port = values.port ? parseInt(values.port, 10) : 4370;
    await api('/devices', { method: 'POST', body: JSON.stringify(values) });
    loadDevices();
  });
});

// ---------------- Shifts ----------------
async function loadShifts() {
  state.shifts = await api('/shifts');
  const tbody = $('#shifts-table tbody');
  tbody.innerHTML = '';
  state.shifts.forEach(shift => {
    const scope = shift.employee_id ? `Employee #${shift.employee_id}` : (shift.department || 'All');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${shift.name}</td>
      <td>${shift.type}</td>
      <td>${shift.start_time}</td>
      <td>${shift.end_time}</td>
      <td>${shift.grace_minutes}</td>
      <td>${scope}</td>
      <td><button class="btn small danger" data-del-shift="${shift.id}">Delete</button></td>
    `;
    tbody.appendChild(tr);
  });
  $$('[data-del-shift]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this shift?')) return;
      await api('/shifts/' + btn.dataset.delShift, { method: 'DELETE' });
      loadShifts();
    });
  });
}

$('#new-shift-btn').addEventListener('click', () => {
  openModal('Add Shift', [
    { name: 'name', label: 'Shift Name', required: true, placeholder: 'Engineering Day Shift' },
    { name: 'type', label: 'Type', placeholder: 'fixed / flexible / rotational' },
    { name: 'start_time', label: 'Start Time (HH:MM)', required: true, placeholder: '09:00' },
    { name: 'end_time', label: 'End Time (HH:MM)', required: true, placeholder: '18:00' },
    { name: 'grace_minutes', label: 'Grace Period (minutes)', placeholder: '10' },
    { name: 'department', label: 'Department (optional scope)' },
  ], async (values) => {
    values.grace_minutes = values.grace_minutes ? parseInt(values.grace_minutes, 10) : 10;
    await api('/shifts', { method: 'POST', body: JSON.stringify(values) });
    loadShifts();
  });
});

// ---------------- Logs ----------------
async function loadEmployeeFilters() {
  if (state.employees.length === 0) await loadEmployeesData();
  [$('#logs-employee-filter'), $('#payroll-employee-filter')].forEach(sel => {
    const currentValue = sel.value;
    sel.innerHTML = '<option value="">All Employees</option>' +
      state.employees.map(e => `<option value="${e.id}">${e.name} (${e.employee_code})</option>`).join('');
    sel.value = currentValue;
  });
}

async function loadLogs() {
  await loadEmployeeFilters();
  const employeeId = $('#logs-employee-filter').value;
  const query = employeeId ? `?employee_id=${employeeId}` : '';
  const logs = await api('/attendance/logs' + query);
  const tbody = $('#logs-table tbody');
  tbody.innerHTML = '';
  logs.forEach(log => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${log.employee_name} <span class="muted">(${log.employee_code})</span></td>
      <td>${fmtDateTime(log.punch_time)}</td>
      <td><span class="badge ${log.punch_type === '0' ? 'checkin' : 'checkout'}">${log.punch_type === '0' ? 'Check-In' : 'Check-Out'}</span></td>
      <td>${log.verification_mode === '1' ? 'Fingerprint' : 'RFID Card'}</td>
      <td>${log.device_id || '-'}</td>
    `;
    tbody.appendChild(tr);
  });
}
$('#refresh-logs-btn').addEventListener('click', loadLogs);
$('#logs-employee-filter').addEventListener('change', loadLogs);

// ---------------- Payroll ----------------
$('#run-payroll-btn').addEventListener('click', async () => {
  const employeeId = $('#payroll-employee-filter').value;
  const from = $('#payroll-from').value;
  const to = $('#payroll-to').value;
  const params = new URLSearchParams();
  if (employeeId) params.set('employee_id', employeeId);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const report = await api('/payroll/report?' + params.toString());
  const tbody = $('#payroll-table tbody');
  tbody.innerHTML = '';
  report.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.employee_name}</td>
      <td>${row.date}</td>
      <td>${row.shift}</td>
      <td>${fmtTime(row.check_in)}</td>
      <td>${fmtTime(row.check_out)}</td>
      <td>${row.total_hours}</td>
      <td>${row.is_late ? `<span class="badge late">+${row.late_minutes}m</span>` : '-'}</td>
      <td>${row.is_early_departure ? `<span class="badge late">-${row.early_departure_minutes}m</span>` : '-'}</td>
      <td>${row.overtime_hours > 0 ? row.overtime_hours : '-'}</td>
    `;
    tbody.appendChild(tr);
  });
  if (!report.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#6b7686;padding:24px;">No records found for this range.</td></tr>';
  }
});

// ---------------- Modal ----------------
function openModal(title, fields, onSubmit) {
  $('#modal-title').textContent = title;
  const form = $('#modal-form');
  form.innerHTML = fields.map(f => `
    <label>${f.label}${f.required ? ' *' : ''}</label>
    <input name="${f.name}" placeholder="${f.placeholder || ''}" ${f.required ? 'required' : ''} />
  `).join('') + `
    <div class="modal-actions">
      <button type="button" class="btn secondary" id="modal-cancel">Cancel</button>
      <button type="submit" class="btn">Save</button>
    </div>
  `;
  $('#modal-overlay').classList.remove('hidden');
  $('#modal-cancel').addEventListener('click', closeModal);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const values = {};
    fields.forEach(f => {
      const v = form.elements[f.name].value.trim();
      if (v !== '') values[f.name] = v;
    });
    try {
      await onSubmit(values);
      closeModal();
    } catch (err) {
      alert(err.message);
    }
  };
}
function closeModal() {
  $('#modal-overlay').classList.add('hidden');
}
$('#modal-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'modal-overlay') closeModal();
});

// ---------------- Boot ----------------
if (state.token) {
  enterApp();
}
