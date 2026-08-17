// Renderer script for settings.html — talks to the main process only
// through the narrow bridgeAPI the preload script exposes (contextIsolation
// stays on, no direct Node/IPC access from this page itself).
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');
const currentEl = document.getElementById('current');

function showStatus(message, ok) {
  statusEl.textContent = message;
  statusEl.className = ok ? 'ok' : 'err';
}

function renderCurrent(status) {
  if (!status.configured) {
    currentEl.textContent = 'Not connected yet.';
    return;
  }
  const lines = [`<b>Connected</b> — company ${status.companyId}`];
  lines.push(status.running ? 'Background sync is running.' : 'Sync is stopped.');
  lines.push(status.lastSyncAt ? `Last successful sync: ${new Date(status.lastSyncAt).toLocaleString()}` : 'No successful sync yet.');
  if (status.lastError) lines.push(`<span style="color:#f87171">Last error: ${status.lastError}</span>`);
  currentEl.innerHTML = lines.join('<br>');
}

async function refreshCurrent() {
  const status = await window.bridgeAPI.getStatus();
  renderCurrent(status);
}

async function init() {
  const saved = await window.bridgeAPI.getSaved();
  if (saved?.email) emailInput.value = saved.email;
  await refreshCurrent();
}

saveBtn.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) {
    showStatus('Both email and password are required.', false);
    return;
  }
  saveBtn.disabled = true;
  saveBtn.textContent = 'Connecting…';
  const result = await window.bridgeAPI.save(email, password);
  saveBtn.disabled = false;
  saveBtn.textContent = 'Save & Connect';
  if (result.ok) {
    showStatus('Connected — background sync started.', true);
    passwordInput.value = '';
    await refreshCurrent();
  } else {
    showStatus(result.error, false);
  }
});

init();
setInterval(refreshCurrent, 5000);
