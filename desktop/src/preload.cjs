// The only surface the Oddjob page can reach. Node stays out of the renderer.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("oddjobDesktop", {
    isDesktop: true,
    /** Show a native notification; clicking it navigates to a same-origin path. */
    notify: (title, body, url) => ipcRenderer.send("oddjob:notify", { title, body, url }),
    /** Unread count on the dock/taskbar badge; 0 clears it. */
    setBadge: (count) => ipcRenderer.send("oddjob:badge", count),
});
