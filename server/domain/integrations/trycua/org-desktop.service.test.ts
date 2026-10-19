/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

// A fake docker daemon: containers by name, each with a state and a loopback port.
const containers = new Map<string, { status: string; port: number; startedAt: string; noViewer?: boolean }>();
let networkExists = false;
let nextPort = 55000;
const dockerCalls: string[][] = [];

vi.mock("node:child_process", () => ({
    execFile: (_cmd: string, args: string[], _opts: unknown, cb: (err: any, out?: { stdout: string; stderr: string }) => void) => {
        dockerCalls.push(args);
        const ok = (stdout = "") => setImmediate(() => cb(null, { stdout, stderr: "" }));
        const fail = (stderr: string) => setImmediate(() => cb(Object.assign(new Error(stderr), { stderr })));
        const [cmd, ...rest] = args;
        const name = rest[rest.length - 1];
        switch (cmd) {
            case "inspect": {
                const c = containers.get(name);
                if (!c) return fail(`Error: No such object: ${name}`);
                if (rest.includes("{{.State.StartedAt}}")) return ok(c.startedAt);
                if (rest.includes("{{json .HostConfig.PortBindings}}")) {
                    return ok(JSON.stringify(c.noViewer ? { "8000/tcp": [{}] } : { "8000/tcp": [{}], "6901/tcp": [{}], "9223/tcp": [{}] }));
                }
                return ok(c.status);
            }
            case "image":
                return ok("[]"); // image inspect: already built
            case "network":
                if (rest[0] === "inspect") return networkExists ? ok("[]") : fail("network not found");
                networkExists = true;
                return ok("id");
            case "run": {
                const cname = rest[rest.indexOf("--name") + 1];
                containers.set(cname, { status: "running", port: nextPort++, startedAt: new Date().toISOString() });
                return ok("containerid");
            }
            case "start":
                containers.get(name)!.status = "running";
                return ok(name);
            case "rm":
                containers.delete(name);
                return ok(name);
            case "stop":
                containers.get(name)!.status = "exited";
                return ok(name);
            case "port": {
                const c = containers.get(rest[0])!;
                return ok(`127.0.0.1:${c.port}\n`);
            }
            case "ps":
                return ok([...containers].filter(([, c]) => c.status === "running").map(([n]) => n).join("\n"));
            default:
                return fail(`unexpected docker ${cmd}`);
        }
    },
}));

// Per-org session activity the idle sweep reads.
const activity = new Map<number, { active: number; lastSeen: Date | null }>();
vi.mock("../../../db/index.js", () => ({
    db: {
        select: () => ({
            from: () => ({
                where: async (cond: any) => {
                    const orgId = findOrgId(cond);
                    return [activity.get(orgId) ?? { active: 0, lastSeen: null }];
                },
            }),
        }),
    },
}));

// The where() condition is a drizzle SQL tree; pull the org id param out of it.
function findOrgId(node: any, seen = new Set()): number {
    if (!node || typeof node !== "object" || seen.has(node)) return NaN;
    seen.add(node);
    if (node.constructor?.name === "Param" && typeof node.value === "number") return node.value;
    for (const value of Object.values(node)) {
        const found = Array.isArray(value) ? value.map((v) => findOrgId(v, seen)).find(Number.isInteger) : findOrgId(value, seen);
        if (Number.isInteger(found)) return found as number;
    }
    return NaN;
}

vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));

const { orgDesktopService } = await import("./org-desktop.service.js");

describe("orgDesktopService", () => {
    beforeEach(() => {
        containers.clear();
        activity.clear();
        dockerCalls.length = 0;
        networkExists = false;
        nextPort = 55000;
        process.env.TRYCUA_DESKTOP_IDLE_MINUTES = "30";
    });

    it("creates one isolated desktop per org, reachable only on loopback", async () => {
        const hostA = await orgDesktopService.ensureDesktop(7);
        const hostB = await orgDesktopService.ensureDesktop(8);

        expect(hostA).toBe("127.0.0.1:55000");
        expect(hostB).toBe("127.0.0.1:55001");
        const runs = dockerCalls.filter(([cmd]) => cmd === "run");
        expect(runs).toHaveLength(2);

        const run = runs[0];
        const flag = (f: string) => run[run.indexOf(f) + 1];
        expect(flag("--name")).toBe("oddjob-desktop-org-7");
        expect(flag("--network")).toBe("oddjob-desktops");
        expect(flag("-p")).toBe("127.0.0.1::8000");
        // API, noVNC viewer and Chromium DevTools relay, all on loopback with a port Docker picks.
        expect(run.filter((a, i) => run[i - 1] === "-p")).toEqual(["127.0.0.1::8000", "127.0.0.1::6901", "127.0.0.1::9223"]);
        expect(flag("-v")).toBe("oddjob-desktop-org-7-home:/home/cua");
        expect(run).toContain("oddjob.organization-id=7");

        const create = dockerCalls.find(([cmd, sub]) => cmd === "network" && sub === "create")!;
        expect(create).toContain("com.docker.network.bridge.enable_icc=false");
    });

    it("provisions once when two sessions for the same org open together", async () => {
        const [a, b] = await Promise.all([orgDesktopService.ensureDesktop(7), orgDesktopService.ensureDesktop(7)]);
        expect(a).toBe(b);
        expect(dockerCalls.filter(([cmd]) => cmd === "run")).toHaveLength(1);
    });

    it("restarts a stopped desktop instead of creating a new one", async () => {
        containers.set("oddjob-desktop-org-7", { status: "exited", port: 56000, startedAt: new Date(0).toISOString() });
        expect(await orgDesktopService.ensureDesktop(7)).toBe("127.0.0.1:56000");
        expect(dockerCalls.map(([cmd]) => cmd)).toContain("start");
        expect(dockerCalls.map(([cmd]) => cmd)).not.toContain("run");
    });

    it("recreates a desktop created before the viewer port existed, keeping its home volume", async () => {
        containers.set("oddjob-desktop-org-7", { status: "running", port: 56000, startedAt: new Date().toISOString(), noViewer: true });
        await orgDesktopService.ensureEndpoints(7);
        expect(dockerCalls.find(([cmd]) => cmd === "rm")).toEqual(["rm", "-f", "oddjob-desktop-org-7"]);
        const run = dockerCalls.find(([cmd]) => cmd === "run")!;
        expect(run).toContain("oddjob-desktop-org-7-home:/home/cua");
    });

    it("does not stop a desktop someone is viewing, nor one viewed within the idle window", async () => {
        const longAgo = new Date(Date.now() - 2 * 60 * 60_000);
        containers.set("oddjob-desktop-org-5", { status: "running", port: 1, startedAt: longAgo.toISOString() });
        activity.set(5, { active: 0, lastSeen: longAgo });

        orgDesktopService.viewerOpened(5);
        expect(await orgDesktopService.stopIdleDesktops()).toEqual([]);
        orgDesktopService.viewerClosed(5); // closing counts as recent activity
        expect(await orgDesktopService.stopIdleDesktops()).toEqual([]);
    });

    it("rejects org ids that could not come from the orgs table", () => {
        expect(() => orgDesktopService.containerName(0)).toThrow();
        expect(() => orgDesktopService.containerName(Number.NaN)).toThrow();
    });

    it("stops only desktops that are idle past the window", async () => {
        const longAgo = new Date(Date.now() - 2 * 60 * 60_000);
        const running = (startedAt: Date) => ({ status: "running", port: 1, startedAt: startedAt.toISOString() });
        containers.set("oddjob-desktop-org-1", running(longAgo)); // idle
        containers.set("oddjob-desktop-org-2", running(longAgo)); // has an active session
        containers.set("oddjob-desktop-org-3", running(longAgo)); // session ended 5 min ago
        containers.set("oddjob-desktop-org-4", running(new Date())); // just started, no row yet
        activity.set(1, { active: 0, lastSeen: longAgo });
        activity.set(2, { active: 1, lastSeen: longAgo });
        activity.set(3, { active: 0, lastSeen: new Date(Date.now() - 5 * 60_000) });

        expect(await orgDesktopService.stopIdleDesktops()).toEqual(["oddjob-desktop-org-1"]);
        expect(containers.get("oddjob-desktop-org-1")!.status).toBe("exited");
    });
});
