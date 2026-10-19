import { db } from "@server/database_service.js";
import { pluginRegistryTable } from "@shared/schema/prediction/plugin-runtime.js";
import { eq, and } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import type {
    PredictionPlugin,
    PluginManifest,
    PluginRegistryEntry,
    PluginHealth,
    PluginHealthStatus,
    PluginFilter,
    RolloutStatus,
} from "./types.js";

const logger = createLogger("PluginRegistry");

const LATENCY_WINDOW = 100; // keep last N latencies for percentile calc

// ---------------------------------------------------------------------------
// Percentile helper
// ---------------------------------------------------------------------------
function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

// ============================================================================
// PLUGIN REGISTRY (Spec §22)
// In-memory hot path + Postgres persistence for startup recovery and admin.
// ============================================================================

class PluginRegistry {
    private readonly entries = new Map<string, PluginRegistryEntry>();
    private manifestQueue: Promise<unknown> = Promise.resolve();

    // -------------------------------------------------------------------------
    // Registration
    // -------------------------------------------------------------------------

    /** Register a plugin. Persists manifest to Postgres asynchronously. */
    register<TInput, TOutput>(plugin: PredictionPlugin<TInput, TOutput>): void {
        const key = this.key(plugin.manifest);
        const existing = this.entries.get(key);

        if (existing && existing.manifest.version !== plugin.manifest.version) {
            logger.warn(`[Registry] Overwriting ${key} v${existing.manifest.version} → v${plugin.manifest.version}`);
        }

        this.entries.set(key, {
            manifest: plugin.manifest,
            plugin: plugin as PredictionPlugin<unknown, unknown>,
            registeredAt: new Date().toISOString(),
            enabled: plugin.manifest.rollout.status !== "disabled",
            callCount: 0,
            errorCount: 0,
            timeoutCount: 0,
            totalDurationMs: 0,
            recentLatenciesMs: [],
        });

        // Persist to Postgres (non-blocking)
        this.persistManifest(plugin.manifest).catch(err =>
            logger.warn(`[Registry] Could not persist manifest ${key}: ${err?.message}`)
        );

        logger.info(`[Registry] Registered ${key} v${plugin.manifest.version} [${plugin.manifest.execution.latencyClass}] status=${plugin.manifest.rollout.status}`);
    }

    /** Unregister a plugin by name. */
    unregister(name: string): boolean {
        for (const [key, entry] of this.entries) {
            if (entry.manifest.name === name) {
                this.entries.delete(key);
                logger.info(`[Registry] Unregistered ${name}`);
                return true;
            }
        }
        return false;
    }

    /** Enable or disable a plugin at runtime. */
    setEnabled(name: string, enabled: boolean): void {
        const entry = this.get(name);
        if (entry) {
            entry.enabled = enabled;
            logger.info(`[Registry] Plugin '${name}' ${enabled ? "enabled" : "disabled"}`);
        }
    }

    // -------------------------------------------------------------------------
    // Lookup
    // -------------------------------------------------------------------------

    /** Lookup by plugin name (searches all pod/subPod combos). */
    get(name: string): PluginRegistryEntry | undefined {
        for (const [, entry] of this.entries) {
            if (entry.manifest.name === name) return entry;
        }
        return undefined;
    }

    /** Lookup by fully-qualified key `pod::subPod::name`. */
    getByKey(pod: string, subPod: string, name: string): PluginRegistryEntry | undefined {
        return this.entries.get(`${pod}::${subPod}::${name}`);
    }

    /** Lookup all plugins matching a capability string. */
    getByCapability(capability: string): PluginRegistryEntry[] {
        return Array.from(this.entries.values()).filter(e => e.manifest.capability === capability);
    }

    /**
     * Resolve the best plugin for a capability/pod/inputType combo.
     * Priority: active > canary > development; highest traffic % wins.
     */
    resolve(filter: PluginFilter): PluginRegistryEntry | undefined {
        const candidates = this.list(filter)
            .filter(e => e.enabled)
            .sort((a, b) => {
                const order: RolloutStatus[] = ["active", "canary", "development", "deprecated", "disabled"];
                const aIdx = order.indexOf(a.manifest.rollout.status);
                const bIdx = order.indexOf(b.manifest.rollout.status);
                if (aIdx !== bIdx) return aIdx - bIdx;
                return b.manifest.rollout.trafficPercent - a.manifest.rollout.trafficPercent;
            });
        return candidates[0];
    }

    /** List plugins, optionally filtered. */
    list(filter?: PluginFilter): PluginRegistryEntry[] {
        let all = Array.from(this.entries.values());
        if (!filter) return all;

        if (filter.pod) all = all.filter(e => e.manifest.pod === filter.pod);
        if (filter.subPod) all = all.filter(e => e.manifest.subPod === filter.subPod);
        if (filter.capability) all = all.filter(e => e.manifest.capability === filter.capability);
        if (filter.latencyClass) all = all.filter(e => e.manifest.execution.latencyClass === filter.latencyClass);
        if (filter.rolloutStatus) all = all.filter(e => e.manifest.rollout.status === filter.rolloutStatus);
        if (filter.enabled !== undefined) all = all.filter(e => e.enabled === filter.enabled);
        return all;
    }

    /** Return all manifests (snapshot for admin/debug). */
    snapshot(): PluginManifest[] {
        return Array.from(this.entries.values()).map(e => e.manifest);
    }

    // -------------------------------------------------------------------------
    // Telemetry
    // -------------------------------------------------------------------------

    recordSuccess(name: string, durationMs: number): void {
        const entry = this.get(name);
        if (!entry) return;
        entry.callCount++;
        entry.totalDurationMs += durationMs;
        entry.lastUsedAt = new Date().toISOString();
        entry.recentLatenciesMs.push(durationMs);
        if (entry.recentLatenciesMs.length > LATENCY_WINDOW) entry.recentLatenciesMs.shift();
    }

    recordError(name: string, error: string, durationMs: number, timedOut = false): void {
        const entry = this.get(name);
        if (!entry) return;
        entry.callCount++;
        entry.errorCount++;
        if (timedOut) entry.timeoutCount++;
        entry.totalDurationMs += durationMs;
        entry.lastError = error;
        entry.lastUsedAt = new Date().toISOString();
    }

    // -------------------------------------------------------------------------
    // Health aggregation
    // -------------------------------------------------------------------------

    async collectHealth(): Promise<PluginHealth[]> {
        const results: PluginHealth[] = [];

        for (const [, entry] of this.entries) {
            let h: PluginHealth;

            if (entry.plugin.health) {
                try {
                    h = await entry.plugin.health();
                } catch {
                    h = {
                        pluginName: entry.manifest.name,
                        pluginVersion: entry.manifest.version,
                        status: "unhealthy",
                        lastCheckedAt: new Date().toISOString(),
                        dependencyStatus: {},
                        errorRate: 1,
                    };
                }
            } else {
                const errorRate = entry.callCount > 0 ? entry.errorCount / entry.callCount : 0;
                const sorted = [...entry.recentLatenciesMs].sort((a, b) => a - b);
                let status: PluginHealthStatus = "healthy";
                if (errorRate > 0.5) status = "unhealthy";
                else if (errorRate > 0.1 || (sorted.length > 0 && percentile(sorted, 95) > entry.manifest.execution.timeoutMs * 0.8)) status = "degraded";

                h = {
                    pluginName: entry.manifest.name,
                    pluginVersion: entry.manifest.version,
                    status,
                    latencyP50Ms: sorted.length > 0 ? percentile(sorted, 50) : undefined,
                    latencyP95Ms: sorted.length > 0 ? percentile(sorted, 95) : undefined,
                    errorRate,
                    lastCheckedAt: new Date().toISOString(),
                    dependencyStatus: {},
                };
            }

            results.push(h);
        }

        return results;
    }

    // -------------------------------------------------------------------------
    // Runtime summary for dashboards
    // -------------------------------------------------------------------------

    telemetrySummary() {
        const entries = Array.from(this.entries.values());
        return {
            totalPlugins: entries.length,
            activePlugins: entries.filter(e => e.enabled && e.manifest.rollout.status === "active").length,
            totalCalls: entries.reduce((s, e) => s + e.callCount, 0),
            totalErrors: entries.reduce((s, e) => s + e.errorCount, 0),
            totalTimeouts: entries.reduce((s, e) => s + e.timeoutCount, 0),
            plugins: entries.map(e => ({
                name: e.manifest.name,
                pod: e.manifest.pod,
                rolloutStatus: e.manifest.rollout.status,
                enabled: e.enabled,
                callCount: e.callCount,
                errorCount: e.errorCount,
                timeoutCount: e.timeoutCount,
                avgLatencyMs: e.callCount > 0 ? e.totalDurationMs / e.callCount : 0,
                lastUsedAt: e.lastUsedAt,
                lastError: e.lastError,
            })),
        };
    }

    // -------------------------------------------------------------------------
    // Postgres persistence
    // -------------------------------------------------------------------------

    private async persistManifest(manifest: PluginManifest): Promise<void> {
        const op = this.manifestQueue.then(async () => {
            await db.insert(pluginRegistryTable).values({
                name: manifest.name,
                version: manifest.version,
                pod: manifest.pod,
                subPod: manifest.subPod,
                capability: manifest.capability,
                enabled: manifest.rollout.status !== "disabled",
                manifest: manifest as any,
                rolloutStatus: manifest.rollout.status,
                trafficPercent: manifest.rollout.trafficPercent,
            }).onConflictDoUpdate({
                target: [pluginRegistryTable.name, pluginRegistryTable.version],
                set: {
                    manifest: manifest as any,
                    rolloutStatus: manifest.rollout.status,
                    trafficPercent: manifest.rollout.trafficPercent,
                    updatedAt: new Date(),
                },
            });
        });
        this.manifestQueue = op.catch(() => {});
        await op;
    }

    private key(manifest: PluginManifest): string {
        return `${manifest.pod}::${manifest.subPod}::${manifest.name}`;
    }
}

export const pluginRegistry = new PluginRegistry();
