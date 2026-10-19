/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fake of @trycua/computer 0.1.6: only a CloudComputer, whose constructor hashes
// apiKey (throws when absent) and whose run() resolves the host via fetchAndCacheHost.
const calls: Array<[string, ...unknown[]]> = [];
const constructed: any[] = [];

vi.mock("@trycua/computer", () => {
    const iface = new Proxy({} as Record<string, unknown>, {
        get(_target, method: string) {
            if (method === "then") return undefined;
            return async (...args: unknown[]) => {
                calls.push([method, ...args]);
                if (method === "screenshot") return Buffer.from("\x89PNGfake");
                if (method === "getCurrentWindowId") return 42;
                return undefined;
            };
        },
    });

    class Computer {
        apiKey?: string;
        cachedHost?: string;
        connectedHost?: string;
        connectedWithKey?: string;
        constructor(public config: Record<string, any>) {
            if (typeof config.apiKey !== "string") throw new TypeError("data argument must be a string");
            this.apiKey = config.apiKey;
            constructed.push(this);
        }
        async fetchAndCacheHost() {
            return `${this.config.name}.sandbox.cua.ai`;
        }
        async run() {
            this.connectedHost = await this.fetchAndCacheHost();
            this.connectedWithKey = this.apiKey;
        }
        get interface() {
            return iface;
        }
        async stop() {}
    }

    return { Computer, OSType: { LINUX: "linux", WINDOWS: "windows", MACOS: "macos" }, ProviderType: { CLOUD: "cloud" } };
});

const ensureDesktop = vi.fn(async (organizationId: number) => `127.0.0.1:${55000 + organizationId}`);
vi.mock("./org-desktop.service.js", () => ({ orgDesktopService: { ensureDesktop } }));

const { CuaComputerProvider } = await import("./trycua-service.js");

describe("CuaComputerProvider (org_desktop)", () => {
    const envBefore = { ...process.env };

    beforeEach(() => {
        calls.length = 0;
        constructed.length = 0;
        ensureDesktop.mockClear();
        process.env.TRYCUA_PROVIDER_TYPE = "org_desktop";
    });

    afterEach(() => {
        process.env = { ...envBefore };
    });

    it("connects each org to its own desktop", async () => {
        const provider = new CuaComputerProvider();
        await provider.createSession({ os: "linux", organizationId: 1 });
        await provider.createSession({ os: "linux", organizationId: 2 });
        expect(constructed.map((c) => c.connectedHost)).toEqual(["127.0.0.1:55001", "127.0.0.1:55002"]);
        expect(constructed.every((c) => c.connectedWithKey === undefined)).toBe(true);
    });

    it("ignores a caller-chosen sandboxName, which would key a shared connection", async () => {
        const provider = new CuaComputerProvider();
        const a = await provider.createSession({ os: "linux", organizationId: 1, sandboxName: "shared" });
        const b = await provider.createSession({ os: "linux", organizationId: 2, sandboxName: "shared" });
        expect(a.providerSessionId).not.toBe(b.providerSessionId);
        expect(a.providerSessionId).toMatch(/^org-1-/);
        expect(b.providerSessionId).toMatch(/^org-2-/);
    });

    it("reconnects after a restart to the desktop of the session's org column", async () => {
        const provider = new CuaComputerProvider();
        const row = { providerSessionId: "org-3-abc", organizationId: 3, os: "linux", metadata: { providerType: "org_desktop" } } as any;
        await provider.getScreenshot(row);
        expect(ensureDesktop).toHaveBeenCalledWith(3);
        expect(constructed[0].connectedHost).toBe("127.0.0.1:55003");
    });

    it("does not boot a stopped desktop just to end a session", async () => {
        const provider = new CuaComputerProvider();
        await provider.terminateSession({ providerSessionId: "org-3-gone", metadata: { providerType: "org_desktop" } });
        expect(ensureDesktop).not.toHaveBeenCalled();
    });

    it("refuses to provision without an org", async () => {
        await expect(new CuaComputerProvider().createSession({ os: "linux" })).rejects.toThrow(/organization id/);
    });
});

describe("CuaComputerProvider (local VM)", () => {
    const envBefore = { ...process.env };
    let provider: InstanceType<typeof CuaComputerProvider>;
    let session: any;

    beforeEach(async () => {
        calls.length = 0;
        constructed.length = 0;
        process.env.TRYCUA_PROVIDER_TYPE = "local";
        process.env.TRYCUA_LOCAL_HOST = "127.0.0.1:8010";
        delete process.env.CUA_API_KEY;
        delete process.env.TRYCUA_API_KEY;
        provider = new CuaComputerProvider();
        const created = await provider.createSession({ os: "linux", sandboxName: "vm-1" });
        session = { providerSessionId: created.providerSessionId, sandboxName: created.sandboxName, os: "linux", metadata: created.metadata };
    });

    afterEach(() => {
        process.env = { ...envBefore };
    });

    it("connects to the local host without an API key instead of the cloud", () => {
        expect(constructed).toHaveLength(1);
        expect(constructed[0].connectedHost).toBe("127.0.0.1:8010");
        expect(constructed[0].connectedWithKey).toBeUndefined();
        expect(session.metadata).toMatchObject({ providerType: "local", localHost: "127.0.0.1:8010" });
    });

    it("returns screenshots as a PNG data URL, not a stringified Buffer", async () => {
        const shot = await provider.getScreenshot(session);
        expect(shot).toBe(`data:image/png;base64,${Buffer.from("\x89PNGfake").toString("base64")}`);
    });

    it("presses keys by the names computer-server knows, and sends '+' combos as hotkeys", async () => {
        // The trycua_key_press tool documents both of these; before, both silently did nothing.
        await provider.executeAction(session, { action: "key_press", params: { key: "Enter" } });
        await provider.executeAction(session, { action: "key_press", params: { key: "ctrl+A" } });
        await provider.executeAction(session, { action: "key_press", params: { key: "+" } });
        expect(calls).toEqual([["pressKey", "enter"], ["hotkey", "ctrl", "a"], ["pressKey", "+"]]);
    });

    it("spreads hotkey keys", async () => {
        await provider.executeAction(session, { action: "hotkey", params: { keys: ["ctrl", "l"] } });
        expect(calls).toEqual([["hotkey", "ctrl", "l"]]);
    });

    it("drags by moving to the start, then dragTo(end, button, seconds)", async () => {
        await provider.executeAction(session, { action: "drag", params: { startX: 1, startY: 2, endX: 30, endY: 40, durationMs: 500 } });
        expect(calls).toEqual([["moveCursor", 1, 2], ["dragTo", 30, 40, "left", 0.5]]);
    });

    it("maps mouse_move to moveCursor", async () => {
        await provider.executeAction(session, { action: "mouse_move", params: { x: 5, y: 6 } });
        expect(calls).toEqual([["moveCursor", 5, 6]]);
    });

    it("scrolls by delta for tool callers and at a position for planner callers", async () => {
        await provider.executeAction(session, { action: "scroll", params: { deltaX: 0, deltaY: 3 } });
        await provider.executeAction(session, { action: "scroll", params: { x: 100, y: 200, clicks: -2 } });
        // Callers mean positive = down; pynput (under computer-server) means positive = up.
        expect(calls).toEqual([["scroll", 0, -3], ["moveCursor", 100, 200], ["scroll", 0, 2]]);
    });

    it("opens http(s) URLs and rejects anything else", async () => {
        await provider.executeAction(session, { action: "browser_navigate", params: { url: "https://example.com" } });
        // Opens in the recordable Chromium on oddjob/cua-desktop (xdg-open only if launch fails).
        expect(calls).toEqual([["launch", "/usr/local/bin/oddjob-browser", ["https://example.com"]]]);
        await expect(provider.executeAction(session, { action: "browser_navigate", params: { url: "file:///etc/passwd" } }))
            .rejects.toThrow(/http\(s\) url/);
    });

    it("maximizes the current window", async () => {
        await provider.executeAction(session, { action: "window_maximize" });
        expect(calls).toEqual([["getCurrentWindowId"], ["maximizeWindow", 42]]);
    });

    it("says plainly which actions it cannot do yet", async () => {
        await expect(provider.executeAction(session, { action: "file_upload", params: { path: "/tmp/x" } }))
            .rejects.toThrow("file_upload is not supported by the cua provider yet");
    });
});
