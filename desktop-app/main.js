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
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Update this the day a real domain replaces the sslip.io placeholder — the
// whole app is this one line, nothing else needs to change.
const APP_URL = 'https://203-134-250-70.sslip.io';

const boundsFile = path.join(app.getPath('userData'), 'window-bounds.json');

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
}

app.whenReady().then(() => {
  // Nothing in the dashboard needs File/Edit/View/Window/Help — this is a
  // wrapped website, not a native editor, and that default Electron menu
  // just looks like leftover dev tooling.
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
