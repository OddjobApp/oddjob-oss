// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — PLUGIN RUNTIME POD
// Full type contracts per spec §8-§16, §20-§21, §24, §26, §35-§36
// Replaces the initial types.ts with the complete specification.
// ============================================================================

// ---------------------------------------------------------------------------
// Execution Mode
// ---------------------------------------------------------------------------

export type ExecutionMode = "realtime" | "interactive" | "analysis" | "batch";
export type LatencyClass = "realtime" | "interactive" | "analysis" | "batch";
export type ExecutionModeSpec = "sync" | "async" | "hybrid";
export type PluginType = "typescript_in_process" | "typescript_service" | "python_service" | "agent_assisted";
export type RolloutStatus = "development" | "canary" | "active" | "deprecated" | "disabled";

// ---------------------------------------------------------------------------
// Trace Context
// ---------------------------------------------------------------------------

export interface TraceContext {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    startedAt: string;
    attributes: Record<string, string | number | boolean>;
}

// ---------------------------------------------------------------------------
// Plugin Manifest (spec §8)
// ---------------------------------------------------------------------------

export interface PluginManifest {
    name: string;
    version: string;
    pod: string;
    subPod: string;
    capability: string;
    description?: string;
    owner?: string;

    inputTypes: string[];
    outputTypes: string[];

    execution: {
        type: PluginType;
        mode: ExecutionModeSpec;
        latencyClass: LatencyClass;
        timeoutMs: number;
        retryable: boolean;
        maxRetries: number;
    };

    state: {
        readsState: boolean;
        writesState: boolean;
        stateKeys: string[];
    };

    storage: {
        postgres: { read: boolean; write: boolean; tables: string[] };
        qdrant: { read: boolean; write: boolean; collections: string[] };
        redis: { read: boolean; write: boolean; keyPrefixes: string[] };
        objectStorage: { read: boolean; write: boolean; buckets: string[] };
    };

    agents: {
        usesAgents: boolean;
        allowedForHotPath: boolean;
        maxAgentCalls: number;
    };

    safety: {
        deterministic: boolean;
        requiresGovernance: boolean;
        producesAction: boolean;
        producesInference: boolean;
        producesPrediction: boolean;
        mayIncreaseRisk: boolean;
    };

    dependencies: {
        requiredPlugins: string[];
        optionalPlugins: string[];
        externalServices: string[];
    };

    rollout: {
        status: RolloutStatus;
        trafficPercent: number;
        fallbackPlugin?: string;
        shadowMode?: boolean;
    };
}

// ---------------------------------------------------------------------------
// Plugin Decision (spec §10)
// ---------------------------------------------------------------------------

export interface PluginDecision {
    shouldRun: boolean;
    reason: string;
    priority: number;
    estimatedCost: {
        latencyMs: number;
        dbReads: number;
        vectorQueries: number;
        agentCalls: number;
    };
}

// ---------------------------------------------------------------------------
// Plugin Context (spec §11)
// ---------------------------------------------------------------------------

export interface PluginContext {
    requestId: string;
    correlationId: string;
    contextId: string;
    actorId?: string;

    now: string;
    mode: ExecutionMode;

    trace: TraceContext;
    config: Record<string, unknown>;

    services: {
        storage: StoragePort;
        vector: VectorPort;
        graph: GraphPort;
        cache: CachePort;
        eventBus: EventBusPort;
        agent?: AgentAssistPort;
    };

    limits: {
        timeoutMs: number;
        maxDbReads: number;
        maxDbWrites: number;
        maxVectorQueries: number;
        maxAgentCalls: number;
        maxMemoryMb?: number;
    };

    permissions: {
        canReadSensitiveData: boolean;
        canWriteInferences: boolean;
        canWritePredictions: boolean;
        canCallAgents: boolean;
        canUseGeographicData: boolean;
        canUseSpatialData: boolean;
    };
}

// ---------------------------------------------------------------------------
// Plugin Warning + Error
// ---------------------------------------------------------------------------

export interface PluginWarning {
    code: string;
    message: string;
    severity: "info" | "warn" | "error";
}

export interface PluginError {
    code: string;
    message: string;
    stack?: string;
}

// ---------------------------------------------------------------------------
// Plugin Metrics (spec §13)
// ---------------------------------------------------------------------------

export interface PluginMetrics {
    startedAt: string;
    completedAt: string;
    durationMs: number;
    dbReads: number;
    dbWrites: number;
    vectorQueries: number;
    cacheReads: number;
    cacheWrites: number;
    agentCalls: number;
    outputSizeBytes: number;
}

// ---------------------------------------------------------------------------
// Provenance (spec §14)
// ---------------------------------------------------------------------------

export interface Provenance {
    source: string;
    method: string;
    pluginName: string;
    pluginVersion: string;
    modelVersion?: string;
    evidenceIds: string[];
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Plugin Result (spec §12)
// ---------------------------------------------------------------------------

export type PluginStatus = "success" | "partial" | "skipped" | "failed" | "timeout" | "policy_denied" | "invalid_output";

export interface PluginResult<TOutput = unknown> {
    pluginName: string;
    pluginVersion: string;
    status: PluginStatus;
    output?: TOutput;
    confidence: number;
    evidenceIds: string[];
    warnings: PluginWarning[];
    errors: PluginError[];
    metrics: PluginMetrics;
    provenance: Provenance;
    shadowMode?: boolean;
}

// ---------------------------------------------------------------------------
// Plugin Explanation (spec §15)
// ---------------------------------------------------------------------------

export interface PluginExplanation {
    pluginName: string;
    summary: string;
    reasoning: string[];
    evidenceIds: string[];
    confidence: number;
    caveats: string[];
}

// ---------------------------------------------------------------------------
// Plugin Health (spec §16)
// ---------------------------------------------------------------------------

export type PluginHealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export interface PluginHealth {
    pluginName: string;
    pluginVersion: string;
    status: PluginHealthStatus;
    lastCheckedAt: string;
    latencyP50Ms?: number;
    latencyP95Ms?: number;
    errorRate?: number;
    dependencyStatus: Record<string, PluginHealthStatus>;
}

// ---------------------------------------------------------------------------
// Pod Health
// ---------------------------------------------------------------------------

export interface PodHealth {
    podName: string;
    status: PluginHealthStatus;
    pluginStatuses: PluginHealth[];
    checkedAt: string;
}

export interface PodCapability {
    name: string;
    version: string;
    latencyClass: LatencyClass;
    mode: ExecutionModeSpec;
}

// ---------------------------------------------------------------------------
// Plugin Runtime Health (spec §36)
// ---------------------------------------------------------------------------

export interface PluginRuntimeHealth {
    status: PluginHealthStatus;
    registeredPluginCount: number;
    activePluginCount: number;
    degradedPlugins: string[];
    unhealthyPlugins: string[];
    averageLatencyMs: number;
    errorRate: number;
}

// ---------------------------------------------------------------------------
// Policy Guard (spec §24)
// ---------------------------------------------------------------------------

export interface PluginPolicyDecision {
    allowed: boolean;
    reason: string;
    adjustedLimits?: Partial<PluginContext["limits"]>;
    redactions?: string[];
}

// ---------------------------------------------------------------------------
// Standard Plugin Interface (spec §9)
// ---------------------------------------------------------------------------

export interface PredictionPlugin<TInput = unknown, TOutput = unknown> {
    manifest: PluginManifest;
    canHandle(input: TInput, context: PluginContext): Promise<PluginDecision>;
    execute(input: TInput, context: PluginContext): Promise<PluginResult<TOutput>>;
    explain?(input: TInput, output: TOutput, context: PluginContext): Promise<PluginExplanation>;
    health?(): Promise<PluginHealth>;
}

export type SubPodPlugin<TInput = unknown, TOutput = unknown> = PredictionPlugin<TInput, TOutput>;

// ---------------------------------------------------------------------------
// Execution Request / Response (spec §20-§21)
// ---------------------------------------------------------------------------

export interface PluginExecutionRequest<TInput = unknown> {
    pod: string;
    subPod?: string;
    capability?: string;
    inputType: string;
    input: TInput;
    mode: ExecutionMode;
    required?: boolean;
    maxPlugins?: number;
    /** Override manifest timeout */
    timeoutOverrideMs?: number;
    /** Run in shadow mode (result stored, not used) */
    shadowMode?: boolean;
}

export interface PluginExecutionResponse<TOutput = unknown> {
    requestId: string;
    selectedPlugins: string[];
    results: PluginResult<TOutput>[];
    skipped: { pluginName: string; reason: string }[];
    failed: { pluginName: string; reason: string }[];
    metrics: {
        totalDurationMs: number;
        totalDbReads: number;
        totalVectorQueries: number;
        totalAgentCalls: number;
    };
}

// ---------------------------------------------------------------------------
// Plugin Registry Entry (internal)
// ---------------------------------------------------------------------------

export interface PluginRegistryEntry {
    manifest: PluginManifest;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    plugin: PredictionPlugin<any, any>;
    registeredAt: string;
    enabled: boolean;
    // Rolling metrics
    callCount: number;
    errorCount: number;
    timeoutCount: number;
    totalDurationMs: number;
    recentLatenciesMs: number[];   // rolling window of last 100
    lastUsedAt?: string;
    lastError?: string;
}

// ---------------------------------------------------------------------------
// Plugin Filter (for list queries)
// ---------------------------------------------------------------------------

export interface PluginFilter {
    pod?: string;
    subPod?: string;
    capability?: string;
    latencyClass?: LatencyClass;
    rolloutStatus?: RolloutStatus;
    mode?: ExecutionMode;
    enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Plugin Runtime Port (spec §35)
// ---------------------------------------------------------------------------

export interface PluginRuntimePort {
    execute<TInput, TOutput>(
        request: PluginExecutionRequest<TInput>,
        context: PluginContext
    ): Promise<PluginExecutionResponse<TOutput>>;

    register(plugin: PredictionPlugin): Promise<void>;
    health(): Promise<PluginRuntimeHealth>;
    listPlugins(filter?: PluginFilter): Promise<PluginManifest[]>;
}

// ---------------------------------------------------------------------------
// Storage / Port Contracts (spec §26) — full versions
// ---------------------------------------------------------------------------

export interface StorageReadQuery {
    table: string;
    where?: Record<string, unknown>;
    orderBy?: string;
    limit?: number;
}

export interface StorageWriteCommand<T = unknown> {
    table: string;
    data: T;
    onConflict?: "ignore" | "update";
}

export interface StorageWriteResult {
    rowsAffected: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface StorageTransaction {
    read<T>(query: StorageReadQuery): Promise<T[]>;
    write<T>(command: StorageWriteCommand<T>): Promise<StorageWriteResult>;
}

export interface StoragePort {
    read<T>(query: StorageReadQuery): Promise<T[]>;
    write<T>(command: StorageWriteCommand<T>): Promise<StorageWriteResult>;
    transaction<T>(fn: (tx: StorageTransaction) => Promise<T>): Promise<T>;
}

export interface VectorSearchInput {
    collection: string;
    vector: number[];
    topK: number;
    filter?: Record<string, unknown>;
}

export interface VectorSearchResult {
    id: string;
    score: number;
    payload: Record<string, unknown>;
}

export interface VectorUpsertInput {
    collection: string;
    id: string;
    vector: number[];
    payload: Record<string, unknown>;
}

export interface VectorUpsertResult { id: string }
export interface VectorDeleteInput { collection: string; id: string }
export interface VectorDeleteResult { deleted: boolean }

export interface VectorPort {
    search(input: VectorSearchInput): Promise<VectorSearchResult[]>;
    upsert(input: VectorUpsertInput): Promise<VectorUpsertResult>;
    delete(input: VectorDeleteInput): Promise<VectorDeleteResult>;
}

export interface GraphNode { id: string; label: string; properties: Record<string, unknown> }
export interface GraphPath { nodes: GraphNode[]; edges: string[] }
export interface GraphNeighborInput { nodeId: string; edgeType?: string; depth?: number }
export interface GraphPathInput { fromId: string; toId: string; edgeType?: string }
export interface GraphEdgeInput { fromId: string; toId: string; type: string; properties?: Record<string, unknown> }
export interface GraphEdgeResult { id: string }
export interface GraphDiffInput { contextId: string; sinceTimestamp: string }
export interface GraphDiff { added: GraphNode[]; removed: string[]; updated: GraphNode[] }

export interface GraphPort {
    getNeighbors(input: GraphNeighborInput): Promise<GraphNode[]>;
    findPath(input: GraphPathInput): Promise<GraphPath[]>;
    upsertEdge(input: GraphEdgeInput): Promise<GraphEdgeResult>;
    diff(input: GraphDiffInput): Promise<GraphDiff>;
}

export interface CachePort {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
    del(key: string): Promise<void>;
}

export interface EventBusPort {
    publish<T>(topic: string, message: T): Promise<void>;
    enqueue<T>(queue: string, job: T): Promise<void>;
}

export interface AgentAssistRequest {
    prompt: string;
    contextId: string;
    maxTokens?: number;
    temperature?: number;
}

export interface AgentAssistResult {
    output: string;
    confidence: number;
    model: string;
    tokensUsed: number;
}

export interface AgentAssistPort {
    ask(input: AgentAssistRequest): Promise<AgentAssistResult>;
}

// ---------------------------------------------------------------------------
// Domain Pod Interface (spec §34)
// ---------------------------------------------------------------------------

export interface DomainPod<TRequest = unknown, TResponse = unknown> {
    podName: string;
    version: string;
    handle(request: TRequest, context: PluginContext): Promise<TResponse>;
    health(): Promise<PodHealth>;
    capabilities(): Promise<PodCapability[]>;
}
