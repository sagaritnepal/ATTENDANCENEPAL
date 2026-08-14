// Attendance Nepal desktop wrapper: a real Windows app that opens the same
// live admin-web dashboard everyone already uses in a browser, in its own
// window instead of a browser tab — a taskbar icon, a Start Menu shortcut,
// remembers window size, and a proper offline/retry screen instead of
// Electron's default ugly error page. It doesn't run a second copy of the
// app locally: the dashboard and all its data are already fully hosted
// (Next.js on the VPS, data in Supabase), so pointing a window at the live
// URL gives 100% feature parity for free and always reflects whatever's
// currently deployed, with zero duplicate code to keep in sync.
//
// Logging into the dashboard inside this window works exactly like logging
// in via a browser — Supabase Auth, same per-company data via the same RLS
// rules — so this one build works for every company/customer, not just one;
// each admin just signs into their own account like they already do today.
//
// Also embeds the LAN device bridge (lan-bridge.js) — if a device bridge
// credential is configured (Tray icon → Configure Device Bridge…), this PC
// also pulls attendance from any ZKTeco terminal on its own local network
// and syncs it to the cloud, running in the background via the system tray
// even when this window is closed. Closing the window only hides it; Quit
// from the tray menu is what actually exits (and stops that background
// sync) — see the isQuitting flag below.
const { app, BrowserWindow, Menu, Tray, ipcMain, safeStorage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const lanBridge = require('./lan-bridge');

// Update this the day a real domain replaces the sslip.io placeholder — the
// whole app is this one line, nothing else needs to change.
const APP_URL = 'https://203-134-250-70.sslip.io';

const boundsFile = path.join(app.getPath('userData'), 'window-bounds.json');
const bridgeConfigFile = path.join(app.getPath('userData'), 'bridge-config.json');

let mainWindow = null;
let tray = null;
let isQuitting = false;

function loadBounds() {
  try {
    return JSON.parse(fs.readFileSync(boundsFile, 'utf8'));
  } catch {
    return { width: 1280, height: 800 };
  }
}

function saveBounds(win) {
  try {
    fs.writeFileSync(boundsFile, JSON.stringify(win.getBounds()));
  } catch {
    // Not worth surfacing to the user — worst case the window just opens at
    // the default size next time.
  }
}

// Encrypted at rest via the OS's own credential store (DPAPI on Windows) —
// falls back to plain JSON only on a system where that's unavailable, which
// is rare and still no worse than the .env file the standalone bridge uses.
function saveBridgeConfig(email, password) {
  const canEncrypt = safeStorage.isEncryptionAvailable();
  const payload = {
    email,
    encrypted: canEncrypt,
    password: canEncrypt ? safeStorage.encryptString(password).toString('base64') : password,
  };
  fs.writeFileSync(bridgeConfigFile, JSON.stringify(payload));
}

function loadBridgeConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(bridgeConfigFile, 'utf8'));
    const password = saved.encrypted ? safeStorage.decryptString(Buffer.from(saved.password, 'base64')) : saved.password;
    return { email: saved.email, password };
  } catch {
    return null;
  }
}

function errorPageUrl(message) {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Attendance Nepal</title>
<style>
  body { font-family: -apple-system, Segoe UI, sans-serif; background: #0f172a; color: #e2e8f0;
    display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .box { text-align: center; max-width: 360px; }
  h1 { font-size: 18px; margin-bottom: 8px; }
  p { color: #94a3b8; font-size: 13px; line-height: 1.5; }
  button { margin-top: 16px; padding: 10px 20px; border-radius: 8px; border: none;
    background: #2563eb; color: white; font-size: 14px; font-weight: 600; cursor: pointer; }
  button:hover { background: #1d4ed8; }
</style></head>
<body>
  <div class="box">
    <h1>Can't reach the dashboard</h1>
    <p>${message}</p>
    <p>Check the internet connection on this PC, then try again.</p>
    <button onclick="location.href='${APP_URL}'">Retry</button>
  </div>
</body></html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

function createWindow() {
  const bounds = loadBounds();
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, 'build', 'icon.png'),
    title: 'Attendance Nepal',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadURL(APP_URL);

  // A link the dashboard opens with target="_blank" (or window.open) should
  // go to the person's actual default browser, not spawn a second app
  // window with no menu/controls of its own.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    // -3 is Chromium's ERR_ABORTED, which fires harmlessly on normal
    // in-app navigations (e.g. clicking a sidebar link) — not a real
    // failure, so it's excluded here to avoid flashing the error screen.
    if (errorCode === -3) return;
    if (validatedURL && validatedURL.startsWith('data:')) return;
    win.loadURL(errorPageUrl(`${errorDescription} (${errorCode})`));
  });

  let saveTimeout;
  const scheduleSave = () => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => saveBounds(win), 500);
  };
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);

  // Closing the window (the X button) only hides it, so background device
  // sync keeps running — matches how a real background service behaves.
  // The tray menu's "Quit" is the only thing that actually exits the app.
  win.on('close', event => {
    if (isQuitting) return;
    event.preventDefault();
    win.hide();
  });

  mainWindow = win;
  return win;
}

function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

let settingsWindow = null;
function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 420,
    height: 560,
    resizable: false,
    title: 'Device Bridge Settings',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload-settings.js'),
    },
  });
  settingsWindow.setMenu(null);
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function buildTrayMenu() {
  const status = lanBridge.getStatus();
  const bridgeLabel = !status.configured
    ? 'Device bridge: not configured'
    : status.running
      ? 'Device bridge: syncing'
      : 'Device bridge: stopped';
  return Menu.buildFromTemplate([
    { label: 'Open Dashboard', click: showMainWindow },
    { label: bridgeLabel, enabled: false },
    { label: 'Configure Device Bridge…', click: openSettingsWindow },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'build', 'icon.ico'));
  tray.setToolTip('Attendance Nepal');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', showMainWindow);
  // Keeps the "syncing"/"stopped"/error state in the tray menu roughly
  // current without the user needing to reopen Settings to check it.
  setInterval(() => tray.setContextMenu(buildTrayMenu()), 15000);
}

ipcMain.handle('bridge:save', async (_event, { email, password }) => {
  try {
    await lanBridge.configure(email, password);
    saveBridgeConfig(email, password);
    if (tray) tray.setContextMenu(buildTrayMenu());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('bridge:status', () => lanBridge.getStatus());

ipcMain.handle('bridge:get-saved', () => {
  const saved = loadBridgeConfig();
  return saved ? { email: saved.email } : null;
});

app.whenReady().then(() => {
  // Nothing in the dashboard needs File/Edit/View/Window/Help — this is a
  // wrapped website, not a native editor, and that default Electron menu
  // just looks like leftover dev tooling.
  Menu.setApplicationMenu(null);
  createWindow();
  createTray();

  const saved = loadBridgeConfig();
  if (saved) {
    lanBridge.configure(saved.email, saved.password).catch(err => {
      console.error('[main] auto-starting device bridge failed:', err.message);
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

app.on('window-all-closed', () => {
  // Windows/Linux normally quit here once every window is gone — deliberately
  // not doing that: the tray icon is the app's real "still alive" indicator
  // now, since background device sync should keep running even with every
  // window closed. Quit only ever happens via the tray menu.
});

app.on('before-quit', () => {
  isQuitting = true;
});
