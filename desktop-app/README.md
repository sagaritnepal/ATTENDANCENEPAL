# Attendance Nepal — Desktop App

A Windows desktop wrapper around the live admin-web dashboard (`main.js` just opens
`https://203-134-250-70.sslip.io` — see its comments) — a real taskbar app instead of a browser
tab, with a remembered window size and a proper offline/retry screen. It's the same dashboard,
same login, same per-company data — nothing about the web app itself changed.

It also embeds the LAN device bridge (same logic as `zkteco-bridge/index.js`) — so a single
install on a PC that's on the same local network as a ZKTeco terminal can both show the dashboard
*and* pull attendance from that device, without needing a second always-running program. Configure
it from the tray icon → **Configure Device Bridge…**, pasting in a credential generated from the
dashboard's Devices page. Once connected, sync keeps running in the background even with the
window closed — closing the window only hides it to the tray; **Quit** from the tray menu is what
actually exits (and stops sync). The credential is stored encrypted at rest via the OS's own
credential store (Windows DPAPI, through Electron's `safeStorage`), not plain text.

The bridge logic isn't frozen into the `.exe` the way it first was — the canonical copy lives at
`admin-web/public/lan-bridge.js` and is served live at `<domain>/lan-bridge.js`. Every time the app
starts, it fetches that file fresh and runs whatever's currently there (caching the last
successful fetch to disk as a fallback for an offline launch). So a fix to the bridge itself ships
the moment `admin-web/public/lan-bridge.js` is deployed, exactly like a dashboard change — no new
`.exe` needed. The copy of `lan-bridge.js` bundled in this folder is only a last-resort fallback
for a machine's very first launch with no internet yet; **keep both copies in sync** (this file and
`admin-web/public/lan-bridge.js`) whenever the bridge logic changes, since the bundled one only
ever gets used before a fetch has ever succeeded.

## Building it

```
npm install
npm run build
```

That produces two files in `dist/`, both genuinely standalone — no accompanying folder needed,
hand out either one by itself:

- **`Attendance Nepal 1.0.0.exe`** — portable. Copy it anywhere (including a different PC) and
  double-click; it runs directly, no install step. This is what "just transfer one file" wants.
- **`Attendance Nepal Setup 1.0.0.exe`** — a real installer: Start Menu shortcut, Desktop shortcut,
  proper uninstall entry in Windows Settings. Better for a machine this will live on long-term.

`build/icon.ico` is generated from `admin-web/public/logo-mark.png` via `build/make-icon.js` — run
that again if the logo ever changes, and commit the resulting `.ico`.

`signAndEditExecutable: false` in `package.json`'s `build.win` config is intentional: without it,
electron-builder unconditionally downloads a macOS-targeted signing/resource-editing bundle (even
though nothing here is ever actually code-signed) and that download fails to extract without a
Windows symlink privilege most accounts don't have by default. Skipping that step is what makes
`npm run build` work without needing Developer Mode enabled or an admin account — the small
tradeoff is the bundled `Attendance Nepal.exe` sitting inside the packed app (never seen directly;
only the outer installer/portable exe's icon, which comes from NSIS itself, is user-visible) keeps
a generic Electron icon instead of the logo.
