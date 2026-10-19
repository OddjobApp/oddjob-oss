/** @vitest-environment node */
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const viewerOpened = vi.fn();
const viewerClosed = vi.fn();
vi.mock("./org-desktop.service.js", () => ({
    orgDesktopService: { viewerOpened, viewerClosed, ensureEndpoints: vi.fn() },
}));

// Membership lookups: user_orgs, then users.default_org_id, then admin_roles, in that order.
const dbRows: unknown[][] = [];
vi.mock("../../../db/index.js", () => ({
    db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => dbRows.shift() ?? [] }) }) }) },
}));

const viewer = await import("./desktop-viewer.js");

// A fake noVNC container: serves files and accepts a WebSocket-style upgrade, echoing bytes.
let upstream: http.Server;
let upstreamHost: string;
const upstreamRequests: Array<{ url?: string; headers: http.IncomingHttpHeaders; upgrade: boolean }> = [];

// Oddjob, with just the viewer routes and upgrade hook.
let app: http.Server;
let appHost: string;
// Upgraded sockets leave the servers' own connection tracking, so close() would wait on them.
const openSockets = new Set<net.Socket>();
const track = (server: http.Server) => server.on("connection", (s: net.Socket) => {
    openSockets.add(s);
    s.on("close", () => openSockets.delete(s));
});

beforeAll(async () => {
    upstream = http.createServer((req, res) => {
        upstreamRequests.push({ url: req.url, headers: req.headers, upgrade: false });
        res.writeHead(200, { "content-type": "text/html", "set-cookie": "novnc=1" });
        res.end(`served ${req.url}`);
    });
    upstream.on("upgrade", (req, socket) => {
        upstreamRequests.push({ url: req.url, headers: req.headers, upgrade: true });
        socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
        socket.on("data", (chunk) => socket.write(Buffer.concat([Buffer.from("echo:"), chunk])));
    });
    track(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    upstreamHost = `127.0.0.1:${(upstream.address() as AddressInfo).port}`;

    const expressApp = express();
    expressApp.get(/^\/api\/integrations\/trycua\/desktop\/viewer\/o\/42\/(.+)$/, (req, res, next) => {
        viewer.proxyViewerAsset(req, res, 42, String((req.params as Record<string, string>)[0])).catch(next);
    });
    expressApp.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(err?.statusCode ?? err?.status ?? 500).send(err?.message);
    });
    app = http.createServer(expressApp);
    app.on("upgrade", (req, socket, head) => {
        if (!viewer.handleViewerUpgrade(req, socket, head)) socket.destroy();
    });
    track(app);
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    appHost = `127.0.0.1:${(app.address() as AddressInfo).port}`;
});

afterAll(async () => {
    for (const s of openSockets) s.destroy();
    await new Promise((resolve) => app.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
});

beforeEach(() => {
    process.env.TRYCUA_PROVIDER = "cua";
    process.env.TRYCUA_PROVIDER_TYPE = "local";
    process.env.TRYCUA_LOCAL_VIEWER_HOST = upstreamHost;
    upstreamRequests.length = 0;
    viewerOpened.mockClear();
    viewerClosed.mockClear();
    viewer.resetViewerStateForTests();
});

afterEach(() => {
    delete process.env.TRYCUA_LOCAL_VIEWER_HOST;
});

/** Raw WebSocket handshake; resolves with the first response chunk and the socket. */
function upgrade(path: string, origin: string | null = `http://${appHost}`): Promise<{ head: string; socket: net.Socket }> {
    return new Promise((resolve, reject) => {
        const socket = net.connect(Number(appHost.split(":")[1]), "127.0.0.1", () => {
            const lines = [
                `GET ${path} HTTP/1.1`,
                `Host: ${appHost}`,
                "Upgrade: websocket",
                "Connection: Upgrade",
                "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
                "Sec-WebSocket-Version: 13",
                "Sec-WebSocket-Protocol: binary",
                "Cookie: oddjob.sid=secret-session",
            ];
            if (origin) lines.push(`Origin: ${origin}`);
            socket.write(lines.join("\r\n") + "\r\n\r\n");
        });
        socket.once("data", (chunk) => resolve({ head: chunk.toString(), socket }));
        socket.once("error", reject);
        socket.once("close", () => resolve({ head: "", socket }));
    });
}

const ticketFor = (org = 42) => viewer.issueViewerTicket({ organizationId: org, userId: "u1", viewerHost: upstreamHost });
const wsPath = (org = 42) => `${viewer.viewerOrgPath(org)}/websockify`;

describe("viewer tickets", () => {
    it("are single use and expire after a minute", () => {
        const t = ticketFor();
        expect(viewer.consumeViewerTicket(t)).toMatchObject({ organizationId: 42, userId: "u1" });
        expect(viewer.consumeViewerTicket(t)).toBeUndefined();

        const old = viewer.issueViewerTicket({ organizationId: 42, userId: "u1", viewerHost: upstreamHost }, Date.now() - 61_000);
        expect(viewer.consumeViewerTicket(old)).toBeUndefined();
        expect(viewer.consumeViewerTicket(null)).toBeUndefined();
    });

    it("point noVNC at the proxied socket with only the allowed settings", () => {
        const url = new URL(viewer.viewerPageUrl(42, "T0K"), "http://x");
        expect(url.pathname).toBe("/api/integrations/trycua/desktop/viewer/o/42/vnc.html");
        expect(Object.fromEntries(url.searchParams)).toEqual({
            autoconnect: "true", resize: "scale", reconnect: "false", path: "websockify?ticket=T0K",
        });
        // noVNC resolves `path` against the page: this is the URL its socket will open.
        expect(new URL(url.searchParams.get("path")!, url).pathname).toBe(wsPath(42));
    });

    it("asks noVNC for a watch-only view when the studio is not in takeover", () => {
        const url = new URL(viewer.viewerPageUrl(42, "T0K", { viewOnly: true }), "http://x");
        expect(url.searchParams.get("view_only")).toBe("true");
        expect(new URL(viewer.viewerPageUrl(42, "T0K"), "http://x").searchParams.has("view_only")).toBe(false);
    });
});

describe("handleViewerUpgrade", () => {
    it("bridges a ticketed same-origin socket to the desktop without Oddjob's cookies", async () => {
        const { head, socket } = await upgrade(`${wsPath()}?ticket=${ticketFor()}`);
        expect(head).toContain("101 Switching Protocols");

        const up = upstreamRequests.find((r) => r.upgrade)!;
        expect(up.url).toBe("/websockify");
        expect(up.headers.host).toBe(upstreamHost);
        expect(up.headers.cookie).toBeUndefined();
        expect(up.headers["sec-websocket-protocol"]).toBe("binary");
        expect(viewerOpened).toHaveBeenCalledWith(42);

        const echoed = new Promise<string>((resolve) => socket.once("data", (c) => resolve(c.toString())));
        socket.write("frame");
        expect(await echoed).toBe("echo:frame");

        socket.destroy();
        await vi.waitFor(() => expect(viewerClosed).toHaveBeenCalledWith(42));
    });

    it("refuses a missing, reused or forged ticket", async () => {
        expect((await upgrade(wsPath())).head).toContain("401");
        expect((await upgrade(`${wsPath()}?ticket=forged`)).head).toContain("401");

        const t = ticketFor();
        (await upgrade(`${wsPath()}?ticket=${t}`)).socket.destroy();
        expect((await upgrade(`${wsPath()}?ticket=${t}`)).head).toContain("401");
    });

    it("refuses a ticket used on another org's socket path", async () => {
        expect((await upgrade(`${wsPath(7)}?ticket=${ticketFor(42)}`)).head).toContain("403");
        expect(upstreamRequests).toHaveLength(0);
    });

    it("refuses cross-site sockets even with a valid ticket", async () => {
        expect((await upgrade(`${wsPath()}?ticket=${ticketFor()}`, "https://evil.example")).head).toContain("403");
        expect((await upgrade(`${wsPath()}?ticket=${ticketFor()}`, null)).head).toContain("403");
        expect(upstreamRequests).toHaveLength(0);
    });

    it("leaves other upgrade paths to other gateways", () => {
        const socket = { write: vi.fn(), destroy: vi.fn() } as any;
        expect(viewer.handleViewerUpgrade({ url: "/api/agora", headers: {} } as any, socket, Buffer.alloc(0))).toBe(false);
        expect(socket.write).not.toHaveBeenCalled();
    });
});

describe("proxyViewerAsset", () => {
    const get = (path: string, headers: Record<string, string> = {}) =>
        fetch(`http://${appHost}${viewer.viewerOrgPath(42)}/${path}`, { headers });

    it("serves noVNC files without forwarding cookies or passing cookies back", async () => {
        const res = await get("app/ui.js", { cookie: "oddjob.sid=secret-session", authorization: "Bearer x" });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("served /app/ui.js");
        expect(res.headers.get("set-cookie")).toBeNull();
        expect(upstreamRequests[0].headers.cookie).toBeUndefined();
        expect(upstreamRequests[0].headers.authorization).toBeUndefined();
    });

    it("keeps the page's settings in the browser and marks the page uncacheable", async () => {
        const res = await get(`vnc.html?autoconnect=true&path=${encodeURIComponent("websockify?ticket=abc")}`);
        expect(res.status).toBe(200);
        expect(upstreamRequests[0].url).toBe("/vnc.html"); // the ticket is not sent to the container
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    });

    it("rejects noVNC settings that could send the session elsewhere", async () => {
        const res = await get("vnc.html?autoconnect=true&record_url=https%3A%2F%2Fevil.example%2Fsink");
        expect(res.status).toBe(400);
        expect(upstreamRequests).toHaveLength(0);
    });

    it("only serves noVNC's own files", async () => {
        for (const path of ["vnc_lite.html", "demo_collector.html", "utils/novnc_proxy", "app/%2e%2e/%2e%2e/etc/passwd"]) {
            expect((await get(path)).status).toBe(404);
        }
        expect(upstreamRequests).toHaveLength(0);
    });
});

describe("assertViewerAccess", () => {
    beforeEach(() => {
        dbRows.length = 0;
    });

    it("lets super-admins in without a lookup", async () => {
        await expect(viewer.assertViewerAccess({ userId: "root", isSuperAdmin: true }, 7)).resolves.toBeUndefined();
    });

    it("admits members, and users whose default org or admin role is the org", async () => {
        dbRows.push([{ orgId: 7 }]);
        await expect(viewer.assertViewerAccess({ userId: "member", isSuperAdmin: false }, 7)).resolves.toBeUndefined();

        dbRows.push([], [{ defaultOrgId: 7 }], []);
        await expect(viewer.assertViewerAccess({ userId: "default-org", isSuperAdmin: false }, 7)).resolves.toBeUndefined();

        dbRows.push([], [{ defaultOrgId: 1 }], [{ organizationId: 7 }]);
        await expect(viewer.assertViewerAccess({ userId: "org-admin", isSuperAdmin: false }, 7)).resolves.toBeUndefined();
    });

    it("refuses a logged-in user naming an org they do not belong to (?orgId= is not checked upstream)", async () => {
        dbRows.push([], [{ defaultOrgId: 1 }], [{ organizationId: 1 }]);
        await expect(viewer.assertViewerAccess({ userId: "outsider", isSuperAdmin: false }, 7)).rejects.toThrow(/not a member/);
    });
});
