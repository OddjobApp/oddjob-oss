import path from "node:path";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { createLogger } from "@server/utils/logger.js";
import { tenantProcessEnv } from "@server/utils/tenant-process-env.js";

const logger = createLogger("LocalProcessService");

/** processName -> live ChildProcess. Cleared on server restart — that's intentional. */
const registry = new Map<string, ChildProcess>();

/** Slugs flow into process names — restrict to safe characters */
const SAFE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** Find Next.js binary — search workspace first, then walk up for pnpm/workspaces hoist */
async function findNextBin(workspacePath: string): Promise<string | null> {
    const candidates = [
        path.join(workspacePath, "node_modules", "next", "dist", "bin", "next"),
        path.join(workspacePath, "..", "node_modules", "next", "dist", "bin", "next"),
        path.join(workspacePath, "..", "..", "node_modules", "next", "dist", "bin", "next"),
        path.join(workspacePath, "..", "..", "..", "node_modules", "next", "dist", "bin", "next"),
    ];
    for (const candidate of candidates) {
        if (await fs.access(candidate).then(() => true).catch(() => false)) return candidate;
    }
    return null;
}

// Kill all child processes when the server exits so nothing is left orphaned
process.on("exit", () => {
    for (const [, child] of registry) {
        try { child.kill("SIGKILL"); } catch {}
    }
});

export const localProcessService = {
    /**
     * Spawns a Next.js app as a child process of this server.
     * Returns a stable id (oddjob-app-{slug}-{port}) usable with stop/isRunning.
     * When the server exits, all children are killed automatically.
     */
    /**
     * @param entryFile Relative path to a Node entry point, for apps that are
     *   not Next. Omitted, the workspace is started with `next start`, which is
     *   what every caller did before a second launch profile existed.
     */
    async startProcess(
        workspacePath: string,
        port: number,
        env: Record<string, string>,
        slug: string,
        entryFile?: string
    ): Promise<{ id: string; success: boolean; error?: string }> {
        const processName = `oddjob-app-${slug}-${port}`;

        if (!SAFE_SLUG_RE.test(slug)) {
            return { id: processName, success: false, error: `Invalid slug "${slug}" — must match ${SAFE_SLUG_RE}` };
        }

        // Stop any existing process with this name before launching a new one
        if (registry.has(processName)) {
            await this.stopProcess(processName);
        }

        logger.info(`[LocalProcess] Starting ${processName} in ${workspacePath} on port ${port}...`);

        // A plain Node service has no next binary and does not need one. Only
        // look for it when this workspace is actually a Next app.
        let spawnArgs: string[];
        if (entryFile) {
            spawnArgs = [entryFile];
        } else {
            const nextBin = await findNextBin(workspacePath);
            if (!nextBin) {
                return {
                    id: processName,
                    success: false,
                    error: `next binary not found in ${workspacePath} or parent node_modules — run npm install first`,
                };
            }
            // All public access goes through the authenticated platform proxy.
            spawnArgs = [nextBin, "start", "-p", String(port), "-H", "127.0.0.1"];
        }

        try {
            const logPath = path.join(workspacePath, ".server-logs.log");
            const logStream = createWriteStream(logPath, { flags: "a" });
            // Generated app code: an allowlisted environment, never the server's secrets.
            const childEnv = tenantProcessEnv({ ...env, PORT: String(port), HOSTNAME: '127.0.0.1' });

            // Spawned with the current Node binary and an argument array — never
            // through a shell — so nothing read out of package.json can become a
            // command. A Node service takes its port from PORT in childEnv.
            const child = spawn(process.execPath, spawnArgs, {
                cwd: workspacePath,
                env: childEnv,
                stdio: ["ignore", "pipe", "pipe"],
                detached: false,
            });

            child.stdout?.pipe(logStream);
            child.stderr?.pipe(logStream);

            child.on("exit", (code, signal) => {
                logger.info(`[LocalProcess] ${processName} exited (code=${code ?? "?"}, signal=${signal ?? "—"})`);
                registry.delete(processName);
                logStream.end();
            });

            child.on("error", (err) => {
                logger.error(`[LocalProcess] ${processName} spawn error: ${err.message}`);
                registry.delete(processName);
                logStream.end();
            });

            registry.set(processName, child);
            logger.info(`[LocalProcess] Spawned ${processName} pid=${child.pid}`);
            return { id: processName, success: true };
        } catch (err: any) {
            logger.error(`[LocalProcess] Failed to start ${processName}: ${err.message}`);
            return { id: processName, success: false, error: err.message };
        }
    },

    async isProcessRunning(id: string): Promise<boolean> {
        if (!id) return false;
        const child = registry.get(id);
        if (!child) return false;
        // exitCode is null while the process is still alive
        const alive = child.exitCode === null && !child.killed;
        if (!alive) registry.delete(id);
        return alive;
    },

    async stopProcess(id: string): Promise<boolean> {
        if (!id) return true;
        const child = registry.get(id);
        if (!child) return true;

        return new Promise((resolve) => {
            const done = () => { registry.delete(id); resolve(true); };

            const timeout = setTimeout(() => {
                try { child.kill("SIGKILL"); } catch {}
                done();
            }, 5000);

            child.once("exit", () => { clearTimeout(timeout); done(); });

            try {
                child.kill("SIGTERM");
            } catch (err: any) {
                logger.warn(`[LocalProcess] Could not signal ${id}: ${err.message}`);
                clearTimeout(timeout);
                done();
            }
        });
    },

    /**
     * Tail the last N lines of the log file.
     * Reads at most maxBytes from the tail so large logs never load into memory.
     */
    async getLogs(workspacePath: string, lines = 150, maxBytes = 1_000_000): Promise<string[]> {
        const logPath = path.join(workspacePath, ".server-logs.log");
        try {
            const stat = await fs.stat(logPath);
            const start = Math.max(0, stat.size - maxBytes);
            const fh = await fs.open(logPath, "r");
            try {
                const buf = Buffer.alloc(stat.size - start);
                await fh.read(buf, 0, buf.length, start);
                let sliceStart = 0;
                if (start > 0) {
                    const nl = buf.indexOf(0x0a);
                    sliceStart = nl >= 0 ? nl + 1 : buf.length;
                }
                return buf.subarray(sliceStart).toString("utf-8").split("\n").slice(-lines).filter(Boolean);
            } finally {
                await fh.close();
            }
        } catch {
            return [];
        }
    },
};
