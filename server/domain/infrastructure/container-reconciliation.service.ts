import { db } from "@server/database_service.js";
import { appInstances, apps } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { execFile } from "child_process";
import { promisify } from "util";
import net from "node:net";
import { localProcessService } from "@domain/apps/infrastructure/local-process.service.js";

const execFileAsync = promisify(execFile);

/**
 * Lightweight TCP liveness probe — resolves true if something accepts a
 * connection on the local port within the timeout. Ground truth for "the
 * runtime exists": localProcessService only knows children this process
 * spawned, and neither an orphaned `next start` nor a Docker container's
 * published port are visible to it.
 */
function probePort(port: number, timeoutMs = 1500): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let settled = false;
        const finish = (ok: boolean) => { if (settled) return; settled = true; socket.destroy(); resolve(ok); };
        socket.setTimeout(timeoutMs);
        socket.once("connect", () => finish(true));
        socket.once("timeout", () => finish(false));
        socket.once("error", () => finish(false));
        socket.connect(port, "127.0.0.1");
    });
}

export interface ContainerStatus {
    containerId: string;
    name: string;
    status: string;
    state: string;
    running: boolean;
}

export interface ReconciliationReport {
    timestamp: string;
    totalInstancesChecked: number;
    healthyCount: number;
    divergentCount: number;
    remediatedCount: number;
    details: Array<{
        instanceId: number;
        deploymentId: number;
        containerId: string | null;
        dbStatus: string;
        dockerRunning: boolean;
        actionTaken: string;
    }>;
}

export class ContainerReconciliationService {
    private isRunning = false;
    private timer: NodeJS.Timeout | null = null;
    private dockerAvailable = true;
    private lastDockerCheckTimestamp = 0;
    private readonly DOCKER_COOLDOWN_MS = 300000; // 5 minutes

    /**
     * Inspect active Docker containers on the host.
     */
    async getDockerContainers(): Promise<Map<string, ContainerStatus>> {
        const containers = new Map<string, ContainerStatus>();
        const now = Date.now();

        // Skip execution if Docker previously failed within the cooldown window
        if (!this.dockerAvailable && now - this.lastDockerCheckTimestamp < this.DOCKER_COOLDOWN_MS) {
            return containers;
        }

        try {
            const { stdout } = await execFileAsync("docker", [
                "ps",
                "-a",
                "--format",
                "{{.ID}}|{{.Names}}|{{.Status}}|{{.State}}"
            ], { timeout: 3000 });

            this.dockerAvailable = true;
            this.lastDockerCheckTimestamp = now;

            const lines = stdout.split("\n").filter(Boolean);
            for (const line of lines) {
                const [id, name, status, state] = line.split("|");
                if (id) {
                    const isRunning = state?.toLowerCase() === "running";
                    containers.set(id.trim(), {
                        containerId: id.trim(),
                        name: name?.trim() ?? "",
                        status: status?.trim() ?? "",
                        state: state?.trim() ?? "",
                        running: isRunning
                    });
                }
            }
        } catch (err) {
            this.dockerAvailable = false;
            this.lastDockerCheckTimestamp = now;
            console.warn("[ContainerReconciliationService] Docker inspect warning (cooling down 5m):", (err as Error).message);
        }

        return containers;
    }

    /**
     * Perform a single audit & reconciliation pass across app_instances.
     */
    async reconcile(): Promise<ReconciliationReport> {
        const report: ReconciliationReport = {
            timestamp: new Date().toISOString(),
            totalInstancesChecked: 0,
            healthyCount: 0,
            divergentCount: 0,
            remediatedCount: 0,
            details: []
        };

        try {
            const instances = await db.select().from(appInstances);
            const activeDockerContainers = await this.getDockerContainers();

            report.totalInstancesChecked = instances.length;

            for (const instance of instances) {
                const dbContainerId = instance.containerId?.trim();
                const dbStatus = instance.status ?? "unknown";

                if (!dbContainerId) {
                    continue;
                }

                const isLocalProcessRunning = dbContainerId.startsWith("oddjob-app-")
                    && await localProcessService.isProcessRunning(dbContainerId);
                if (isLocalProcessRunning) {
                    report.healthyCount++;
                    continue;
                }

                const dockerInfo = activeDockerContainers.get(dbContainerId) ?? 
                    Array.from(activeDockerContainers.values()).find(c => c.containerId.startsWith(dbContainerId));

                const isDockerRunning = dockerInfo?.running ?? false;

                // A registry miss plus a Docker miss does not prove the app is
                // down. This sweep also runs in the standalone worker process
                // (worker-entrypoint.ts), whose localProcessService registry is
                // empty by construction, and a server restart orphans surviving
                // `next start` children either way. The instance's bound port
                // answers only if the runtime is actually alive — probe it
                // before condemning the row, or every serving local app gets
                // marked unhealthy and restarted once a minute.
                const isRuntimeUp = isDockerRunning
                    || (instance.port != null && await probePort(instance.port));

                if (isRuntimeUp) {
                    // Reinstate rows a previous sweep condemned while the
                    // process kept serving — without this, only a kill-and-
                    // respawn via proxy auto-start ever clears the flag.
                    if (dbStatus === "unhealthy") {
                        await db.update(appInstances)
                            .set({ status: "running" })
                            .where(eq(appInstances.id, instance.id));
                        report.details.push({
                            instanceId: instance.id,
                            deploymentId: instance.deploymentId,
                            containerId: dbContainerId,
                            dbStatus,
                            dockerRunning: isDockerRunning,
                            actionTaken: "reinstated_running_port_alive",
                        });
                    }
                    report.healthyCount++;
                    continue;
                }

                if (dbStatus === "running" && !isDockerRunning) {
                    report.divergentCount++;
                    let actionTaken = "marked_unhealthy";

                    // Attempt automated restart if Docker container exists but stopped
                    if (dockerInfo && !isDockerRunning) {
                        try {
                            await execFileAsync("docker", ["start", dockerInfo.containerId], { timeout: 10000 });
                            actionTaken = "restarted_container";
                            report.remediatedCount++;
                        } catch (restartErr) {
                            actionTaken = "restart_failed_marked_unhealthy";
                        }
                    }

                    if (actionTaken.includes("unhealthy")) {
                        await db.update(appInstances)
                            .set({ status: "unhealthy" })
                            .where(eq(appInstances.id, instance.id));
                    }

                    report.details.push({
                        instanceId: instance.id,
                        deploymentId: instance.deploymentId,
                        containerId: dbContainerId,
                        dbStatus,
                        dockerRunning: isDockerRunning,
                        actionTaken
                    });
                } else {
                    report.healthyCount++;
                }
            }
        } catch (err) {
            console.error("[ContainerReconciliationService] Error during reconciliation pass:", err);
        }

        return report;
    }

    /**
     * Start background periodic reconciliation loop.
     */
    start(intervalMs: number = 60000): void {
        if (this.isRunning) return;
        this.isRunning = true;
        console.log(`[ContainerReconciliationService] Started background reconciliation loop (${intervalMs}ms interval).`);

        this.timer = setInterval(async () => {
            if (!this.isRunning) return;
            const report = await this.reconcile();
            if (report.divergentCount > 0) {
                console.info(`[ContainerReconciliationService] Reconciliation report: Checked ${report.totalInstancesChecked}, Divergent: ${report.divergentCount}, Remediated: ${report.remediatedCount}`);
            }
            this.lastReport = report;
        }, intervalMs);
    }

    /**
     * Stop background reconciliation loop.
     */
    stop(): void {
        this.isRunning = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        console.log("[ContainerReconciliationService] Stopped background reconciliation loop.");
    }

    private lastReport: ReconciliationReport | null = null;

    /**
     * Trigger immediate event-driven reconciliation pass without waiting for interval.
     */
    async triggerImmediateReconciliation(): Promise<ReconciliationReport> {
        console.log("[ContainerReconciliationService] Immediate event-driven reconciliation triggered.");
        const report = await this.reconcile();
        this.lastReport = report;
        return report;
    }

    /**
     * Get statistics from the most recent reconciliation run.
     */
    getLastReconciliationStats() {
        return {
            status: this.isRunning ? "running" : "stopped",
            dockerAvailable: this.dockerAvailable,
            lastRun: this.lastReport?.timestamp ?? null,
            totalChecked: this.lastReport?.totalInstancesChecked ?? 0,
            healthy: this.lastReport?.healthyCount ?? 0,
            divergent: this.lastReport?.divergentCount ?? 0,
            remediated: this.lastReport?.remediatedCount ?? 0
        };
    }

    private allocatedPortPool = new Set<number>();
    private readonly MIN_PORT = 3000;
    private readonly MAX_PORT = 3999;

    /**
     * Reserve an available port from the dynamic pool for a new application instance.
     */
    reservePort(preferredPort?: number): number {
        if (preferredPort && preferredPort >= this.MIN_PORT && preferredPort <= this.MAX_PORT) {
            if (!this.allocatedPortPool.has(preferredPort)) {
                this.allocatedPortPool.add(preferredPort);
                return preferredPort;
            }
        }

        for (let p = this.MIN_PORT; p <= this.MAX_PORT; p++) {
            if (!this.allocatedPortPool.has(p)) {
                this.allocatedPortPool.add(p);
                return p;
            }
        }

        throw new Error("Port pool exhausted: No available host ports in range 3000-3999.");
    }

    /**
     * Reclaim stale or unused ports from stopped or unhealthy containers.
     */
    reclaimStalePort(port: number): boolean {
        const existed = this.allocatedPortPool.has(port);
        this.allocatedPortPool.delete(port);
        if (existed) {
            console.log(`[ContainerReconciliationService] Reclaimed stale port ${port} back to dynamic pool.`);
        }
        return existed;
    }

    /**
     * Inspect allocated ports in current pool.
     */
    getAllocatedPorts(): number[] {
        return Array.from(this.allocatedPortPool);
    }
}

export const containerReconciliationService = new ContainerReconciliationService();
