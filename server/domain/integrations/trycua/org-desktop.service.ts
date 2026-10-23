import { desktopBrokerCommand } from "./desktop-broker-client.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { and, eq, max, sql } from "drizzle-orm";
import { db } from "../../../db/index.js";
import { createLogger } from "../../../utils/logger.js";
import { ConfigurationError } from "../../../utils/errors.js";
import { trycuaSessions } from "../../../../shared/schema/index.js";

const execFileAsync = promisify(execFile);
const logger = createLogger("OrgDesktop");

const CONTAINER_PREFIX = "oddjob-desktop-org-";
const NETWORK = "oddjob-desktops";
const API_PORT = 8000;
const VIEWER_PORT = 6901;
/** socat relay to Chromium's DevTools endpoint (docker/cua-desktop). */
const CDP_PORT = 9223;
const DEFAULT_IMAGE = "oddjob/cua-desktop:latest";
const IMAGE_CONTEXT = "docker/cua-desktop";

export interface DesktopEndpoints {
    /** computer-server (actions, screenshots). */
    api: string;
    /** noVNC web viewer. Reached only through the authenticated proxy in desktop-viewer.ts. */
    viewer: string;
    /** Chromium DevTools (CDP), for skill recording and replay. Full browser control: loopback only. */
    cdp: string;
}

function desktopImage(): string {
    return process.env.TRYCUA_IMAGE || DEFAULT_IMAGE;
}

/**
 * Container command. cua-computer-server >= 0.3.x binds 127.0.0.1 by default and the
 * image's start script passes no --host, so a published port reaches nothing. Patch the
 * script to bind all interfaces (the host side stays loopback-only, and desktops cannot
 * reach each other), then run the image's normal command. Fails loudly if the script
 * stops matching rather than leaving a desktop that is up but unreachable.
 * Keep in sync with the cua-desktop service in docker-compose.yml.
 */
export const DESKTOP_BOOT_COMMAND = [
    "sh", "-c",
    "f=/usr/local/bin/start-computer-server.sh; "
    + "sed -i 's|-m computer_server --port|-m computer_server --host 0.0.0.0 --port|' \"$f\" "
    + "&& grep -q -- '--host 0.0.0.0' \"$f\" "
    + "|| { echo \"cannot bind computer-server to 0.0.0.0: $f changed\" >&2; exit 1; }; "
    // oddjob/cua-desktop only: make the recordable Chromium the user's default browser.
    + "if [ -x /usr/local/bin/oddjob-desktop-init ]; then /usr/local/bin/oddjob-desktop-init; fi; "
    + "exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf",
];

/**
 * One Linux desktop container per organization, for TRYCUA_PROVIDER_TYPE=org_desktop.
 *
 * Created on the org's first computer-use session (not at signup: most orgs never use
 * computer use, and each desktop holds ~1 GB), stopped after TRYCUA_DESKTOP_IDLE_MINUTES
 * with no active session, restarted on the next one. /home/cua is a named volume, so
 * browser profiles, downloads and logins survive a stop.
 *
 * Isolation: the container name is the only state, derived from the org id. The API port
 * has no auth, so it is published on loopback only, with a port Docker picks, and desktops
 * share a bridge with inter-container traffic disabled so one org's desktop cannot drive
 * another's. The noVNC viewer port is published the same way (loopback, no auth) and is
 * only exposed to people through desktop-viewer.ts, which checks login, org and a ticket.
 */
class OrgDesktopService {
    private readonly inFlight = new Map<number, Promise<DesktopEndpoints>>();
    /** Open viewer connections per org: a person logging in by hand has no session row. */
    private readonly openViewers = new Map<number, number>();
    private readonly lastViewerActivity = new Map<number, number>();

    containerName(organizationId: number): string {
        if (!Number.isInteger(organizationId) || organizationId <= 0) {
            throw new ConfigurationError(`A computer-use desktop needs a positive organization id, got ${organizationId}`);
        }
        return `${CONTAINER_PREFIX}${organizationId}`;
    }

    /** Returns "127.0.0.1:<port>" for the org's desktop API, starting or creating it first. */
    async ensureDesktop(organizationId: number): Promise<string> {
        return (await this.ensureEndpoints(organizationId)).api;
    }

    ensureEndpoints(organizationId: number): Promise<DesktopEndpoints> {
        // Two sessions opening at once must not race two `docker run`s for one name.
        const pending = this.inFlight.get(organizationId);
        if (pending) return pending;
        const promise = this.provision(organizationId).finally(() => this.inFlight.delete(organizationId));
        this.inFlight.set(organizationId, promise);
        return promise;
    }

    viewerOpened(organizationId: number): void {
        this.openViewers.set(organizationId, (this.openViewers.get(organizationId) ?? 0) + 1);
        this.lastViewerActivity.set(organizationId, Date.now());
    }

    viewerClosed(organizationId: number): void {
        const open = (this.openViewers.get(organizationId) ?? 1) - 1;
        if (open > 0) this.openViewers.set(organizationId, open);
        else this.openViewers.delete(organizationId);
        this.lastViewerActivity.set(organizationId, Date.now());
    }

    private async provision(organizationId: number): Promise<DesktopEndpoints> {
        const name = this.containerName(organizationId);
        let state = await this.containerState(name);

        if (state !== "missing" && !(await this.publishesAllPorts(name))) {
            // Created before the viewer or CDP ports existed (or from the plain Cua image).
            // Recreate it: the home volume, and with it browser logins, survives.
            logger.info("Recreating computer-use desktop to publish its viewer and CDP ports", { organizationId, name });
            await docker(["rm", "-f", name]);
            state = "missing";
        }

        if (state === "missing") {
            await this.ensureNetwork();
            await ensureImage();
            logger.info("Creating computer-use desktop", { organizationId, name });
            await docker([
                "run", "-d",
                "--name", name,
                "--label", "oddjob.role=computer-use-desktop",
                "--label", `oddjob.organization-id=${organizationId}`,
                "--network", NETWORK,
                "--restart", "no",
                "--memory", `${envInt("TRYCUA_DESKTOP_MEMORY_MB", 2048)}m`,
                "--cpus", String(envInt("TRYCUA_DESKTOP_CPUS", 1)),
                "--shm-size", "512m",
                "--pids-limit", "1024",
                "-e", `VNC_RESOLUTION=${process.env.TRYCUA_RESOLUTION || "1280x800"}`,
                "-v", `${name}-home:/home/cua`,
                "-p", `127.0.0.1::${API_PORT}`,
                "-p", `127.0.0.1::${VIEWER_PORT}`,
                "-p", `127.0.0.1::${CDP_PORT}`,
                desktopImage(),
                ...DESKTOP_BOOT_COMMAND,
            ], 10 * 60_000); // first run may pull the image
        } else if (state !== "running") {
            logger.info("Starting stopped computer-use desktop", { organizationId, name, state });
            await docker(["start", name]);
        }

        const api = await this.publishedHost(name, API_PORT);
        const timeout = envInt("TRYCUA_DESKTOP_READY_TIMEOUT_MS", 90_000);
        await waitForComputerServer(api, timeout);
        const viewer = await this.publishedHost(name, VIEWER_PORT);
        // The API may be ready before noVNC finishes its own startup delay.
        await waitForComputerServer(viewer, timeout, "/vnc.html");
        return {
            api,
            viewer,
            cdp: await this.publishedHost(name, CDP_PORT),
        };
    }

    /**
     * Makes sure the desktop's Chromium is running with remote debugging and returns its
     * CDP host. Launches it (as the desktop user, on the desktop's display) only when the
     * endpoint does not answer, since a second launch would open a new window.
     */
    async ensureBrowser(organizationId: number): Promise<string> {
        const { cdp } = await this.ensureEndpoints(organizationId);
        if (await cdpAnswers(cdp)) return cdp;
        const name = this.containerName(organizationId);
        await docker(["exec", "-d", "-u", "cua", "-e", "DISPLAY=:1", "-e", "HOME=/home/cua", name, "/usr/local/bin/oddjob-browser", "about:blank"]);
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
            if (await cdpAnswers(cdp)) return cdp;
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        throw new ConfigurationError(`The desktop browser did not open its DevTools endpoint at ${cdp}`);
    }

    /** Stops (keeps) desktops whose org has had no active session for the idle window. */
    async stopIdleDesktops(): Promise<string[]> {
        const running = (await docker([
            "ps", "--filter", "label=oddjob.role=computer-use-desktop", "--format", "{{.Names}}",
        ])).split(/\r?\n/).filter((line) => line.startsWith(CONTAINER_PREFIX));
        if (running.length === 0) return [];

        const idleMs = envInt("TRYCUA_DESKTOP_IDLE_MINUTES", 30) * 60_000;
        const stopped: string[] = [];
        for (const name of running) {
            const organizationId = Number(name.slice(CONTAINER_PREFIX.length));
            if (!Number.isInteger(organizationId)) continue;

            const [activity] = await db
                .select({
                    active: sql<number>`count(*) filter (where ${trycuaSessions.status} = 'active')`.mapWith(Number),
                    lastSeen: max(trycuaSessions.updatedAt),
                })
                .from(trycuaSessions)
                .where(and(eq(trycuaSessions.organizationId, organizationId), eq(trycuaSessions.provider, "cua")));

            if (activity?.active || this.inFlight.has(organizationId) || this.openViewers.has(organizationId)) continue;
            // A desktop just started for a session whose row is not written yet has no DB
            // activity, so its own start time counts as activity too.
            const startedAt = Date.parse((await docker(["inspect", "--format", "{{.State.StartedAt}}", name]).catch(() => "")).trim()) || 0;
            const lastSeen = Math.max(
                activity?.lastSeen ? new Date(activity.lastSeen).getTime() : 0,
                startedAt,
                this.lastViewerActivity.get(organizationId) ?? 0,
            );
            if (Date.now() - lastSeen < idleMs) continue;

            logger.info("Stopping idle computer-use desktop", { organizationId, name });
            await docker(["stop", "--time", "10", name]).catch((error) => {
                logger.warn("Failed to stop idle desktop", { name }, error);
            });
            stopped.push(name);
        }
        return stopped;
    }

    private async containerState(name: string): Promise<"missing" | "running" | string> {
        try {
            return (await docker(["inspect", "--format", "{{.State.Status}}", name])).trim();
        } catch (error: any) {
            if (/no such (object|container)/i.test(String(error?.stderr ?? error?.message))) return "missing";
            throw error;
        }
    }

    private async publishedHost(name: string, port: number): Promise<string> {
        // e.g. "127.0.0.1:55012". Re-read on every provision: a restart gets a new port.
        const host = process.env.TRYCUA_DESKTOP_BROKER_SOCKET ? (process.env.TRYCUA_DESKTOP_HOST || "127.0.0.1") : "127.0.0.1";
        const out = (await docker(["port", name, `${port}/tcp`])).split(/\r?\n/).find((line) => line.startsWith(`${host}:`));
        if (!out) throw new ConfigurationError(`Desktop ${name} has no loopback port for ${port}/tcp`);
        return out.trim();
    }

    private async publishesAllPorts(name: string): Promise<boolean> {
        const bindings = await docker(["inspect", "--format", "{{json .HostConfig.PortBindings}}", name]);
        return bindings.includes(`"${VIEWER_PORT}/tcp"`) && bindings.includes(`"${CDP_PORT}/tcp"`);
    }

    private async ensureNetwork(): Promise<void> {
        try {
            await docker(["network", "inspect", NETWORK]);
        } catch {
            await docker([
                "network", "create",
                "--label", "oddjob.role=computer-use-desktops",
                "-o", "com.docker.network.bridge.enable_icc=false",
                NETWORK,
            ]).catch((error: any) => {
                // Another process created it between our inspect and create.
                if (!/already exists/i.test(String(error?.stderr ?? error?.message))) throw error;
            });
        }
    }
}

/** Builds oddjob/cua-desktop from docker/cua-desktop the first time it is missing. */
async function ensureImage(): Promise<void> {
    const image = desktopImage();
    try {
        await docker(["image", "inspect", image]);
        return;
    } catch {
        if (image !== DEFAULT_IMAGE) return; // a custom image is pulled by docker run
    }
    logger.info("Building the computer-use desktop image (first run only)", { image });
    await docker(["build", "-t", image, IMAGE_CONTEXT], 20 * 60_000);
}

async function cdpAnswers(host: string): Promise<boolean> {
    try {
        const res = await fetch(`http://${host}/json/version`, { signal: AbortSignal.timeout(2000) });
        return res.ok;
    } catch {
        return false;
    }
}

async function docker(args: string[], timeout = 60_000): Promise<string> {
    if (process.env.TRYCUA_DESKTOP_BROKER_SOCKET) {
        return desktopBrokerCommand(process.env.TRYCUA_DESKTOP_BROKER_SOCKET, args, timeout);
    }
    try {
        const { stdout } = await execFileAsync("docker", args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
        return stdout;
    } catch (error: any) {
        if (error?.code === "ENOENT") {
            throw new ConfigurationError("TRYCUA_PROVIDER_TYPE=org_desktop needs the docker CLI on the server's PATH");
        }
        throw error;
    }
}

async function waitForComputerServer(host: string, timeoutMs: number, path = "/status"): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError = "no response";
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`http://${host}${path}`, { signal: AbortSignal.timeout(3000) });
            if (res.ok) return;
            lastError = `HTTP ${res.status}`;
        } catch (error: any) {
            lastError = error?.message ?? String(error);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new ConfigurationError(`Computer-use desktop at ${host} was not ready after ${Math.round(timeoutMs / 1000)}s (${lastError})`);
}

function envInt(name: string, fallback: number): number {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const orgDesktopService = new OrgDesktopService();
