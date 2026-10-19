# Oddjob desktop

An Electron shell around a running Oddjob server. It bundles no server: the
window loads an Oddjob origin and nothing else.

```bash
cd desktop
npm install
npm start                                 # loads http://localhost:5000
ODDJOB_URL=https://oddjob.example npm start
npm run dist                              # installer (NSIS on Windows), see below
```

`npm run dist` writes to `%LOCALAPPDATA%\oddjob-desktop-dist` on Windows, not
`desktop/dist`: OneDrive locks the freshly unpacked folder and electron-builder's
rename fails with EPERM. The installer is per-user (no admin) into
`%LOCALAPPDATA%\Programs\oddjob-desktop`, adds a Start Menu shortcut, and the
installed app registers `oddjob://` on first launch (dev runs never do).

electron-builder treats this folder as part of the root workspace (it finds the
root lockfile) and would bundle the whole root `node_modules`, ~1.4 GB. The
`!**/node_modules/**/*` files pattern and `npmRebuild: false` keep the app to
`src/`; after a build, `npx asar list <out>/win-unpacked/resources/app.asar`
should list only `package.json` and `src/`.

A packaged install reads the origin from `"url"` in `%APPDATA%\Oddjob\config.json`
(or `ODDJOB_URL`), defaulting to `http://localhost:5000`.

Kept outside the npm workspaces on purpose, so the root install never downloads Electron.

## What the shell adds

- **Approval notifications.** `BrowserNotificationService` is disabled in a plain
  browser; in the shell it starts enabled for every risk level and sends through
  `window.oddjobDesktop.notify`, so clicking a toast raises the window on
  `/assistant/workbench`. Web push (VAPID) does not work inside Electron.
- **Pending count.** Badge on macOS/Linux; on Windows, which has no app badge,
  the taskbar button flashes and the tray tooltip shows the count.
- **Tray.** Closing the window hides it so notifications keep arriving; quit from the tray menu.
- **`oddjob://path` links** open `/path` in the running instance.

## Security model

`contextIsolation`, `sandbox`, no `nodeIntegration`. The page reaches only the
three members in `src/preload.cjs`, and the main process ignores IPC from any
frame not on the configured origin. Off-origin navigation and popups open in the
system browser. Permission requests are granted to the Oddjob origin only.

There is no computer use (control of this machine's mouse and keyboard). Agents
drive the TryCua VM, which works in the shell as it does in a browser.

## Not done yet

- Auto-update (needs a release feed: GitHub Releases or a static host).
- Code signing: an unsigned installer triggers SmartScreen on Windows.
