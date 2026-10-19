import {
    pgTable,
    text,
    boolean,
    doublePrecision,
    uuid,
    integer,
    timestamp,
    jsonb,
    primaryKey,
    index,
} from "drizzle-orm/pg-core";

// ============================================================================
// PREDICTION INTELLIGENCE â€” PLUGIN RUNTIME POD â€” DRIZZLE SCHEMA
// Spec Â§22.2 (plugin_registry) + Â§23 (plugin_runs)
// ============================================================================

// ---------------------------------------------------------------------------
// plugin_registry (spec Â§22.2)
// ---------------------------------------------------------------------------

export const pluginRegistryTable = pgTable("plugin_registry", {
    name: text("name").notNull(),
    version: text("version").notNull(),
    pod: text("pod").notNull(),
    subPod: text("sub_pod").notNull(),
    capability: text("capability").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    manifest: jsonb("manifest").notNull(),
    rolloutStatus: text("rollout_status").notNull().default("development"),
    trafficPercent: doublePrecision("traffic_percent").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
    pk: primaryKey({ columns: [t.name, t.version] }),
    capabilityIdx: index("idx_plugin_registry_capability").on(t.capability),
    podSubPodIdx: index("idx_plugin_registry_pod_subpod").on(t.pod, t.subPod),
    rolloutIdx: index("idx_plugin_registry_rollout").on(t.rolloutStatus),
}));

// ---------------------------------------------------------------------------
// plugin_runs (spec Â§23)
// ---------------------------------------------------------------------------

export const pluginRuns = pgTable("plugin_runs", {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    contextId: uuid("context_id"),
    pluginName: text("plugin_name").notNull(),
    pluginVersion: text("plugin_version").notNull(),
    pod: text("pod").notNull(),
    subPod: text("sub_pod").notNull(),
    capability: text("capability").notNull(),
    mode: text("mode").notNull(),
    status: text("status").notNull(),
    confidence: doublePrecision("confidence"),
    shadowMode: boolean("shadow_mode").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    metrics: jsonb("metrics").notNull().default({}),
    inputSummary: jsonb("input_summary").notNull().default({}),
    outputSummary: jsonb("output_summary").notNull().default({}),
    warnings: jsonb("warnings").notNull().default([]),
    errors: jsonb("errors").notNull().default([]),
}, (t) => ({
    ctxTimeIdx: index("idx_plugin_runs_context_time").on(t.contextId, t.startedAt),
    pluginTimeIdx: index("idx_plugin_runs_plugin_time").on(t.pluginName, t.startedAt),
    statusIdx: index("idx_plugin_runs_status").on(t.status),
    requestIdx: index("idx_plugin_runs_request").on(t.requestId),
}));


