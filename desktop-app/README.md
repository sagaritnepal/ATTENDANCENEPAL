# Attendance Nepal — Desktop App

A Windows desktop wrapper around the live admin-web dashboard (`main.js` just opens
`https://203-134-250-70.sslip.io` — see its comments) — a real taskbar app instead of a browser
tab, with a remembered window size and a proper offline/retry screen. It's the same dashboard,
same login, same per-company data — nothing about the web app itself changed.

## Building it

```
npm install
npx electron-packager . "Attendance Nepal" --platform=win32 --arch=x64 --icon=build/icon.ico --out=dist --overwrite
```

That produces `dist/Attendance Nepal-win32-x64/`, a folder containing `Attendance Nepal.exe` and
everything it needs alongside it — hand out that whole folder (zip it) and double-clicking the
`.exe` inside is the entire install step; there's no separate installer yet (see below).

`build/icon.ico` is generated from `admin-web/public/logo-mark.png` via `build/make-icon.js` — run
that again if the logo ever changes, and commit the resulting `.ico`.

## Known gap: no single-file installer yet

`electron-builder` (which produces a proper NSIS installer with Start Menu shortcuts, a real
uninstaller, etc.) needs a Windows symlink privilege this machine's account doesn't have by
default, which made its build fail here. Two ways to unblock it later:

- Enable **Developer Mode** (Settings → For Developers) on whichever machine does the official
  build, or
- Build in CI (e.g. a GitHub Actions Windows runner) instead of locally, where this restriction
  doesn't apply.

Once either is true, `npm run build` (electron-builder, already configured in `package.json`)
produces both an NSIS installer and a portable single-file `.exe`.
