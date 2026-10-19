// Oddjob desktop shell: one locked-down window onto a hosted Oddjob origin.
// The server is NOT bundled. The origin comes from ODDJOB_URL, else "url" in
// <userData>/config.json, else http://localhost:5000.
const { app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const APP_ID = "app.oddjob.desktop";
const ICON = path.join(__dirname, "icon.png");

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return null;
    }
}

function writeJson(file, value) {
    try {
        fs.writeFileSync(file, JSON.stringify(value, null, 2));
    } catch {
        // Losing window placement is not worth crashing over.
    }
}

function resolveOrigin() {
    const configured = process.env.ODDJOB_URL || readJson(path.join(app.getPath("userData"), "config.json"))?.url;
    try {
        return new URL(configured || "http://localhost:5000").origin;
    } catch {
        return "http://localhost:5000";
    }
}

let ORIGIN = "";
let win = null;
let tray = null;
let quitting = false;
let lastBadge = 0;

function isOddjob(url) {
    try {
        return new URL(url).origin === ORIGIN;
    } catch {
        return false;
    }
}

/** Only a same-origin path may be opened, mirroring safePushUrl on the server. */
function safePath(url) {
    return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? url : "/";
}

function createWindow() {
    const stateFile = path.join(app.getPath("userData"), "window-state.json");
    const saved = readJson(stateFile) ?? {};

    win = new BrowserWindow({
        width: saved.width ?? 1400,
        height: saved.height ?? 900,
        x: saved.x,
        y: saved.y,
        title: "Oddjob",
        icon: ICON,
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    if (saved.maximized) win.maximize();

    // Anything off-origin opens in the system browser, never inside the shell.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (isOddjob(url)) win.loadURL(url);
        else if (/^https?:/.test(url)) shell.openExternal(url);
        return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, url) => {
        if (!isOddjob(url)) {
            event.preventDefault();
            if (/^https?:/.test(url)) shell.openExternal(url);
        }
    });
    // Camera, mic, notifications, ... are granted to the Oddjob origin only.
    win.webContents.session.setPermissionRequestHandler((wc, _permission, callback, details) => {
        callback(isOddjob(details.requestingUrl || wc.getURL()));
    });

    win.webContents.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
        if (!isMainFrame || code === -3) return; // -3: navigation aborted, not a failure
        const message = `Could not reach ${ORIGIN} (${description}). Set ODDJOB_URL or "url" in ${path.join(app.getPath("userData"), "config.json")}.`;
        win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<body style="font:15px system-ui;padding:40px">${message.replace(/</g, "&lt;")}<p><button onclick="location.href='${ORIGIN}'">Retry</button></body>`)}`);
    });

    // Closing hides to the tray so approval notifications keep arriving.
    win.on("close", (event) => {
        writeJson(stateFile, { ...win.getNormalBounds(), maximized: win.isMaximized() });
        if (!quitting) {
            event.preventDefault();
            win.hide();
        }
    });
    win.on("focus", () => win.flashFrame(false));
    win.on("closed", () => { win = null; });

    win.loadURL(ORIGIN);
}

function showWindow() {
    if (!win) createWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
}

function openPath(p) {
    showWindow();
    win.loadURL(ORIGIN + safePath(p));
}

function createTray() {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
    tray.setToolTip("Oddjob");
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: "Open Oddjob", click: showWindow },
        { label: "Approvals", click: () => openPath("/assistant/workbench") },
        { type: "separator" },
        { label: "Quit", click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on("click", showWindow);
}

ipcMain.on("oddjob:notify", (event, payload) => {
    if (!isOddjob(event.senderFrame?.url)) return;
    const { title, body, url } = payload ?? {};
    const n = new Notification({ title: String(title ?? "Oddjob"), body: String(body ?? ""), icon: ICON });
    n.on("click", () => openPath(url));
    n.show();
});

ipcMain.on("oddjob:badge", (event, count) => {
    if (!isOddjob(event.senderFrame?.url)) return;
    const n = Math.max(0, Math.floor(Number(count) || 0));
    // Windows has no app badge: flash the taskbar button when the count rises.
    if (process.platform === "win32") {
        if (n > lastBadge && win && !win.isFocused()) win.flashFrame(true);
    } else {
        app.setBadgeCount(n);
    }
    tray?.setToolTip(n > 0 ? `Oddjob: ${n} pending approval${n === 1 ? "" : "s"}` : "Oddjob");
    lastBadge = n;
});

// oddjob://missions/12 opens /missions/12.
function handleDeepLink(link) {
    if (!link?.startsWith("oddjob://")) return false;
    openPath("/" + link.slice("oddjob://".length).replace(/^\/+/, ""));
    return true;
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    // Windows shows no toasts without an AUMID. The installer registers APP_ID on
    // its Start Menu shortcut; an unpackaged dev run has no shortcut, so it uses
    // the executable path, which Windows accepts in its place.
    app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath);
    // Only the installed app claims oddjob://. A dev run would register the bare
    // electron.exe, which opens Electron's default app, not this one.
    if (app.isPackaged) app.setAsDefaultProtocolClient("oddjob");
    app.on("second-instance", (_e, argv) => {
        if (!handleDeepLink(argv.find((a) => a.startsWith("oddjob://")))) showWindow();
    });
    app.on("open-url", (e, link) => { e.preventDefault(); handleDeepLink(link); });
    app.on("before-quit", () => { quitting = true; });
    app.whenReady().then(() => {
        ORIGIN = resolveOrigin();
        createTray();
        createWindow();
        handleDeepLink(process.argv.find((a) => a.startsWith("oddjob://")));
    });
    // The tray keeps the app alive on every platform; quit from its menu.
    app.on("window-all-closed", () => {});
    app.on("activate", showWindow);
}
