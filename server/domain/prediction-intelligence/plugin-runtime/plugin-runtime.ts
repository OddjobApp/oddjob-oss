import { randomUUID } from "crypto";
import { createLogger } from "@server/utils/logger.js";
import { pluginRegistry } from "./plugin-registry.js";
import { pluginExecutor } from "./plugin-executor.js";
import type {
    PluginContext,
    PluginHealth,
    PodHealth,
    PodCapability,
    PluginManifest,
    ExecutionMode,
    TraceContext,
    PluginRuntimePort,
    PluginExecutionRequest,
    PluginExecutionResponse,
    PluginRuntimeHealth,
    PluginFilter,
    PredictionPlugin,
} from "./types.js";

const logger = createLogger("PluginRuntime");

// ============================================================================
// NULL ADAPTERS (used when the Storage Pod is not yet wired)
// ============================================================================

const nullStorage = {
    read: async () => [],
    write: async () => ({ rowsAffected: 0 }),
    transaction: async (fn: any) => fn({ read: async () => [], write: async () => ({ rowsAffected: 0 }) }),
};

const nullVector = {
    search: async () => [],
    upsert: async (input: any) => ({ id: input.id }),
    delete: async () => ({ deleted: false }),
};

const nullGraph = {
    getNeighbors: async () => [],
    findPath: async () => [],
    upsertEdge: async () => ({ id: randomUUID() }),
    diff: async () => ({ added: [], removed: [], updated: [] }),
};

const nullCache = {
    get: async () => null,
    set: async () => {},
    del: async () => {},
};

const nullEventBus = {
    publish: async () => {},
    enqueue: async () => {},
};

// ============================================================================
// DEFAULT PERMISSIONS (most restrictive — callers must grant explicitly)
// ============================================================================

const defaultPermissions: PluginContext["permissions"] = {
    canReadSensitiveData: false,
    canWriteInferences: false,
    canWritePredictions: false,
    canCallAgents: false,
    canUseGeographicData: false,
    canUseSpatialData: false,
};

const defaultLimits: PluginContext["limits"] = {
    timeoutMs: 5000,
    maxDbReads: 100,
    maxDbWrites: 10,
    maxVectorQueries: 5,
    maxAgentCalls: 0,
};

// ============================================================================
// CONTEXT FACTORY
// ============================================================================

export function createPluginContext(options: {
    contextId: string;
    mode?: ExecutionMode;
    requestId?: string;
    correlationId?: string;
    actorId?: string;
    traceId?: string;
    config?: Record<string, unknown>;
    services?: Partial<PluginContext["services"]>;
    limits?: Partial<PluginContext["limits"]>;
    permissions?: Partial<PluginContext["permissions"]>;
}): PluginContext {
    const now = new Date().toISOString();
    const traceId = options.traceId ?? randomUUID();

    const trace: TraceContext = {
        traceId,
        spanId: randomUUID(),
        startedAt: now,
        attributes: {
            "context.id": options.contextId,
            mode: options.mode ?? "realtime",
        },
    };

    return {
        requestId: options.requestId ?? randomUUID(),
        correlationId: options.correlationId ?? randomUUID(),
        contextId: options.contextId,
        actorId: options.actorId,
        now,
        mode: options.mode ?? "realtime",
        trace,
        config: options.config ?? {},
        services: {
            storage: nullStorage,
            vector: nullVector,
            graph: nullGraph,
            cache: nullCache,
            eventBus: nullEventBus,
            ...options.services,
        },
        limits: { ...defaultLimits, ...options.limits },
        permissions: { ...defaultPermissions, ...options.permissions },
    };
}

// ============================================================================
// PLUGIN RUNTIME — Spec §35-§36
// ============================================================================

class PluginRuntime implements PluginRuntimePort {
    readonly podName = "plugin-runtime";
    readonly version = "1.0.0";

    // Expose for convenience
    readonly registry = pluginRegistry;
    readonly executor = pluginExecutor;
    readonly createContext = createPluginContext;

    // -------------------------------------------------------------------------
    // PluginRuntimePort impl
    // -------------------------------------------------------------------------

    async execute<TInput, TOutput>(
        request: PluginExecutionRequest<TInput>,
        context: PluginContext
    ): Promise<PluginExecutionResponse<TOutput>> {
        return pluginExecutor.execute<TInput, TOutput>(request, context);
    }

    async register(plugin: PredictionPlugin): Promise<void> {
        pluginRegistry.register(plugin);
    }

    async listPlugins(filter?: PluginFilter): Promise<PluginManifest[]> {
        return pluginRegistry.list(filter).map(e => e.manifest);
    }

    // -------------------------------------------------------------------------
    // Health (spec §36)
    // -------------------------------------------------------------------------

    async health(): Promise<PluginRuntimeHealth> {
        const statuses = await pluginRegistry.collectHealth();
        const allEntries = pluginRegistry.list();
        const activeEntries = allEntries.filter(e => e.enabled && e.manifest.rollout.status === "active");

        const degraded = statuses.filter(s => s.status === "degraded").map(s => s.pluginName);
        const unhealthy = statuses.filter(s => s.status === "unhealthy").map(s => s.pluginName);

        const totalCalls = allEntries.reduce((s, e) => s + e.callCount, 0);
        const totalErrors = allEntries.reduce((s, e) => s + e.errorCount, 0);
        const totalMs = allEntries.reduce((s, e) => s + e.totalDurationMs, 0);

        const status = unhealthy.length > 0 ? "unhealthy" : degraded.length > 0 ? "degraded" : "healthy";

        return {
            status,
            registeredPluginCount: allEntries.length,
            activePluginCount: activeEntries.length,
            degradedPlugins: degraded,
            unhealthyPlugins: unhealthy,
            averageLatencyMs: totalCalls > 0 ? totalMs / totalCalls : 0,
            errorRate: totalCalls > 0 ? totalErrors / totalCalls : 0,
        };
    }

    async podHealth(): Promise<PodHealth> {
        const statuses = await pluginRegistry.collectHealth();
        const overall = statuses.some(s => s.status === "unhealthy")
            ? "unhealthy"
            : statuses.some(s => s.status === "degraded")
            ? "degraded"
            : "healthy";

        return {
            podName: this.podName,
            status: overall,
            pluginStatuses: statuses,
            checkedAt: new Date().toISOString(),
        };
    }

    async capabilities(pod?: string): Promise<PodCapability[]> {
        return pluginRegistry.list(pod ? { pod } : undefined).map(entry => ({
            name: entry.manifest.name,
            version: entry.manifest.version,
            latencyClass: entry.manifest.execution.latencyClass,
            mode: entry.manifest.execution.mode,
        }));
    }

    /** Admin: enable/disable a plugin at runtime. */
    setPluginEnabled(name: string, enabled: boolean): void {
        pluginRegistry.setEnabled(name, enabled);
    }

    /** Registry snapshot for admin. */
    registrySnapshot(): PluginManifest[] {
        return pluginRegistry.snapshot();
    }

    /** Telemetry for dashboards. */
    telemetrySummary() {
        return pluginRegistry.telemetrySummary();
    }
}

export const pluginRuntime = new PluginRuntime();
export type { PluginRuntime };
