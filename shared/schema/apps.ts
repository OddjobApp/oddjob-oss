import { sql } from "drizzle-orm";
import { pgTable, serial, text, varchar, timestamp, integer, boolean, jsonb, index, uniqueIndex, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs, users } from './auth.js';
import { pipelines } from './pipelines/pipeline-core.js';
import { missions } from './missions/core.js';
import { jobs } from './jobs/table.js';
import { knowledgeTopics } from './knowledge-base.js';

// ============================================================================
// JSONB COLUMN TYPES
// ============================================================================

export interface AppConfig {
    sync?: { lastSyncAt?: string; missionIds?: number[]; error?: string };
    syncMissions?: number[];
    copilotForAppSlug?: string;
    /**
     * Keep the row out of the marketplace listing. Set on the scaffold rows the
     * blueprint seeder registers per `server/blueprints/apps/*` directory: they
     * must exist (blueprint and app-record lookups resolve them by slug) but are
     * templates, not apps anyone would install from the shelf.
     */
    hiddenFromMarket?: boolean;
    [key: string]: unknown;
}

// ============================================================================
// APPS REGISTRY
// ============================================================================

export const apps = pgTable("apps", {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 120 }).notNull().unique(),
    slug: varchar("slug", { length: 120 }).notNull().unique(), // e.g. "social-copilot"
    description: text("description"),
    icon: text("icon"), // Lucide icon name or URL
    manifestUrl: text("manifest_url"), // URL to remote manifest for external apps
    isPublic: boolean("is_public").default(false).notNull(),
    isSystem: boolean("is_system").default(false).notNull(), // Built-in apps
    /**
     * Which shelf this app sits on: a platform "standard" built-in, an org's own
     * "custom" app, or one "listed" for demo and purchase.
     *
     * Explicit rather than derived. `isSystem` does identify a built-in, but
     * `isPublic` means "not access-restricted" — Org Forge sets it on everything it
     * installs — so no combination of the two can express a marketplace listing.
     */
    distribution: varchar("distribution", { length: 20 }).default("custom").notNull(),
    developerOrgId: integer("developer_org_id").references(() => orgs.id),
    organizationId: integer("organization_id").references(() => orgs.id), // Many places use this instead of developerOrgId
    blueprint: text("blueprint"), // The blueprint template used
    blueprintSlug: text("blueprint_slug"), // Slug of the blueprint
    status: varchar("status", { length: 50 }).default("active").notNull(), // "active", "draft", "failed", "archived"
    createdBy: text("created_by"), // User who created the app
    config: jsonb("config").$type<AppConfig>().default({}).notNull(), // App configuration
    version: varchar("version", { length: 20 }).default("1.0.0").notNull(),
    changelog: text("changelog"),
    vNextManifest: jsonb("v_next_manifest"),
    dockerImage: text("docker_image"), // Mach 3: Path to stored container image
    runtimeMetadata: jsonb("runtime_metadata").default({}).notNull(), // Mach 3: { containerId, assignedPort, status }
    stitchProjectId: text("stitch_project_id"), // Mapping to Stitch design project
    referenceAssetIds: integer("reference_asset_ids").array().default(sql`ARRAY[]::integer[]`), // RAG Assets for App Forge (specs, images)
    developmentPlan: jsonb("development_plan"), // The "Living Blueprint" (DevelopmentPlan JSON)
    lastApprovedPlan: jsonb("last_approved_plan"), // Track what was actually built
    planReviewStatus: varchar("plan_review_status", { length: 50 }).default("approved").notNull(), // "pending", "approved", "rejected"
    oddjobMissionId: integer("oddjob_mission_id").references(() => missions.id, { onDelete: "set null" }),
    projectId: integer("project_id"), // Project Space scoping

    // Monetization & Scaling (Phase 6)
    pricePerLaunchUsd: numeric("price_per_launch_usd", { precision: 10, scale: 2 }).default('0').notNull(),
    developerPayoutPercentage: integer("developer_payout_percentage").default(70).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    slugIdx: uniqueIndex("app_slug_unique").on(table.slug),
}));

// ============================================================================
// APP TELEMETRY â€” real-time status from Mission Bridge SDK
// ============================================================================

export const appTelemetry = pgTable("app_telemetry", {
    id: serial("id").primaryKey(),
    appId: integer("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    orgId: integer("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    event: varchar("event", { length: 100 }).notNull(), // 'page_view', 'hil_request', 'mission_trigger', etc.
    level: varchar("level", { length: 20 }).default("info").notNull(), // 'info', 'warn', 'error', 'debug'
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    appIdx: index("app_telemetry_app_idx").on(table.appId),
    orgIdx: index("app_telemetry_org_idx").on(table.orgId),
}));

// ============================================================================
// APP AUDIT LOGS â€” findings from ForgeShadowService (Selenium QA)
// ============================================================================

export const appAuditLogs = pgTable("app_audit_logs", {
    id: serial("id").primaryKey(),
    appId: integer("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    orgId: integer("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    findingType: varchar("finding_type", { length: 100 }).notNull(), // 'regression', 'security', 'ux', 'performance'
    severity: varchar("severity", { length: 20 }).notNull(), // 'critical', 'warning', 'info'
    description: text("description").notNull(),
    recommendation: text("recommendation"),
    qaTrace: jsonb("qa_trace").default([]).notNull(), // The full Selenium trace
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    appIdx: index("app_audit_logs_app_idx").on(table.appId),
    orgIdx: index("app_audit_logs_org_idx").on(table.orgId),
}));


export const appDeployments = pgTable("app_deployments", {
    id: serial("id").primaryKey(),
    appId: integer("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 50 }).default("installed").notNull(), // "installed", "active", "suspended", "queued", "failed"
    config: jsonb("config").default({}).notNull(),

    // Publishing Fields
    publicSlug: text("public_slug"),
    url: text("url"), // The runtime URL of the containerized application
    isPublished: boolean("is_published").default(false).notNull(),
    title: text("title"),
    description: text("description"),
    brandingConfig: jsonb("branding_config").default(sql`'{}'::jsonb`),
    accessPolicy: text("access_policy").default("public"), // 'public', 'password', 'internal_only'
    accessPasswordHash: text("access_password_hash"),

    // Usage & Constraints
    budgetLimitUsd: numeric("budget_limit_usd", { precision: 10, scale: 2 }),
    currentSpendUsd: numeric("current_spend_usd", { precision: 10, scale: 2 }).default('0').notNull(),
    userBudgetLimit: numeric("user_budget_limit", { precision: 10, scale: 2 }),
    defaultModel: varchar("default_model", { length: 100 }),
    systemPrompt: text("system_prompt"),
    appMemoryEnabled: boolean("app_memory_enabled").default(false).notNull(),
    webhookUrl: text("webhook_url"),
    webhookType: varchar("webhook_type", { length: 20 }).default("generic").notNull(), // 'generic', 'slack', 'discord'
    webhookSecret: text("webhook_secret"),
    nextPipelineId: integer("next_pipeline_id").references(() => pipelines.id), // For App Chaining
    oddjobMissionId: integer("oddjob_mission_id").references(() => missions.id, { onDelete: "set null" }),
    projectId: integer("project_id"), // Scoped Project Space
    hilEnabled: boolean("hil_enabled").default(false).notNull(),

    // Personalization: { openness, conscientiousness, extraversion, agreeableness, neuroticism }
    oceanTraits: jsonb("ocean_traits").default(sql`'{"o": 0.5, "c": 0.5, "e": 0.5, "a": 0.5, "n": 0.5}'::jsonb`),
    soulArchetype: text("soul_archetype").default("Lead Directive"), // Default archetype

    // Expertise Hub Integration (Mach 3 stabilization)
    expertiseJobId: integer("expertise_job_id").references(() => jobs.id, { onDelete: "set null" }),
    allowedTopicIds: integer("allowed_topic_ids").array().default(sql`ARRAY[]::integer[]`),
    allowedDatasetIds: integer("allowed_dataset_ids").array().default(sql`ARRAY[]::integer[]`),
    allowedAgentIds: integer("allowed_agent_ids").array().default(sql`ARRAY[]::integer[]`),
    allowedPipelineIds: integer("allowed_pipeline_ids").array().default(sql`ARRAY[]::integer[]`),
    defaultCollections: text("default_collections").array().default(sql`ARRAY[]::text[]`),
    allowedTools: text("allowed_tools").array(),
    reasoningProtocol: text("reasoning_protocol").default("json_manifest"),
    intelligenceCategory: text("intelligence_category"),
    deploymentMode: text("deployment_mode").default("chat"), // 'chat', 'browser_autopilot'
    browserStartUrl: text("browser_start_url"),
    browserGoal: text("browser_goal"),
    browserConfig: jsonb("browser_config").default(sql`'{}'::jsonb`),
    navigationalMemoryShared: boolean("navigational_memory_shared").default(true).notNull(),

    // Scaling & High Availability
    minReplicas: integer("min_replicas").default(1).notNull(),
    maxReplicas: integer("max_replicas").default(3).notNull(),
    targetConcurrency: integer("target_concurrency").default(5).notNull(), // Sessions per instance

    // Secure back-channel token for forged apps calling the Oddjob platform API.
    // appTokenHash: SHA-256 of the plaintext (fast lookup); never exposed to callers.
    // appTokenEncrypted: AES-256-GCM ciphertext; decrypted server-side for container injection.
    // appTokenCapabilities: the platform services this deployment is allowed to call.
    appTokenHash: text("app_token_hash"),
    appTokenEncrypted: text("app_token_encrypted"),
    appTokenCapabilities: text("app_token_capabilities").array().default(sql`ARRAY[]::text[]`),

    /**
     * How this org came to be running the app: "internal" (its own install),
     * "trial" (a demo, which must carry an expiry), or "purchased".
     *
     * A demo is not a second copy of an app — it is this row with a budget and a
     * date, which is why budgetLimitUsd and expiresAt live together here.
     */
    plan: varchar("plan", { length: 20 }).default("internal").notNull(),
    expiresAt: timestamp("expires_at"),

    installedAt: timestamp("installed_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    orgAppUnq: uniqueIndex("app_deployment_org_app_unq").on(table.organizationId, table.appId),
    publicSlugUnq: uniqueIndex("app_deployment_public_slug_unq").on(table.publicSlug),
    isPublishedIdx: index("app_deployments_published_idx").on(table.isPublished),
    publicSlugIdx: index("app_deployments_public_slug_idx").on(table.publicSlug),
}));

export const appInstances = pgTable("app_instances", {
    id: serial("id").primaryKey(),
    deploymentId: integer("deployment_id").notNull().references(() => appDeployments.id, { onDelete: "cascade" }),
    containerId: text("container_id").notNull(),
    port: integer("port").notNull(),
    status: varchar("status", { length: 20 }).default("starting").notNull(), // "starting", "running", "unhealthy", "stopped"
    lastHeartbeatAt: timestamp("last_heartbeat_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    deploymentIdx: index("app_instances_deployment_idx").on(table.deploymentId),
    statusIdx: index("app_instances_status_idx").on(table.status),
}));

export const insertAppInstanceSchema = createInsertSchema(appInstances).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export type AppInstance = typeof appInstances.$inferSelect;

export const appUserUsage = pgTable("app_user_usage", {
    id: serial("id").primaryKey(),
    deploymentId: integer("deployment_id").notNull().references(() => appDeployments.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    dailySpendUsd: numeric("daily_spend_usd", { precision: 10, scale: 2 }).default('0').notNull(),
    monthlySpendUsd: numeric("monthly_spend_usd", { precision: 10, scale: 2 }).default('0').notNull(),
    lastSpendAt: timestamp("last_spend_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    deploymentUserUnq: uniqueIndex("app_user_usage_deployment_user_unq").on(table.deploymentId, table.userId),
}));

export const appPayouts = pgTable("app_payouts", {
    id: serial("id").primaryKey(),
    developerOrgId: integer("developer_org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    appId: integer("app_id").notNull().references(() => apps.id, { onDelete: "set null" }), // Keep payout record even if app deleted
    amountUsd: numeric("amount_usd", { precision: 10, scale: 2 }).notNull(),
    status: varchar("status", { length: 20 }).default("pending").notNull(), // "pending", "paid", "failed"
    stripePayoutId: text("stripe_payout_id"),
    missionRunId: integer("mission_run_id"), // Idempotency key â€” only one payout per run
    processedAt: timestamp("processed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    devOrgIdx: index("app_payouts_dev_org_idx").on(table.developerOrgId),
    uniqueRunPayout: uniqueIndex("app_payouts_unique_run").on(table.appId, table.missionRunId),
}));

// ============================================================================
// APP RECORDS â€” app-scoped data store for forged apps
// Replaces localStorage/in-memory state with durable, server-side records.
// All reads/writes are namespaced by (appId, orgId, collection) â€” enforced
// platform-side from the deployment token, never from caller input.
// ============================================================================

export const appRecords = pgTable("app_records", {
    id: serial("id").primaryKey(),
    appId: integer("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    orgId: integer("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    collection: varchar("collection", { length: 100 }).notNull(),
    recordId: varchar("record_id", { length: 100 }).notNull(),
    data: jsonb("data").notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    collectionIdx: index("app_records_collection_idx").on(table.appId, table.orgId, table.collection),
    uniqueRecord: uniqueIndex("app_records_unique_record").on(table.appId, table.orgId, table.collection, table.recordId),
}));

export type AppRecord = typeof appRecords.$inferSelect;

export const insertAppSchema = createInsertSchema(apps);
export const selectAppSchema = createSelectSchema(apps);
export type App = typeof apps.$inferSelect;
export type InsertApp = z.infer<typeof insertAppSchema>;

export const insertAppDeploymentSchema = createInsertSchema(appDeployments, {
    publicSlug: z.string().min(3).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens").optional().nullable(),
    title: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    brandingConfig: z.object({
        logoUrl: z.string().optional(),
        primaryColor: z.string().optional(),
        theme: z.enum(['light', 'dark', 'system']).optional(),
        hidePoweredBy: z.boolean().optional(),
    }).optional(),
    budgetLimitUsd: z.union([z.string(), z.number()]).optional().nullable(),
    currentSpendUsd: z.union([z.string(), z.number()]).optional().nullable(),
    userBudgetLimit: z.union([z.string(), z.number()]).optional().nullable(),
    defaultModel: z.string().optional().nullable(),
    systemPrompt: z.string().optional().nullable(),
    appMemoryEnabled: z.boolean().optional(),
    webhookUrl: z.string().url().optional().nullable().or(z.literal("")),
    webhookType: z.enum(['generic', 'slack', 'discord']).optional(),
    webhookSecret: z.string().optional().nullable(),
    nextPipelineId: z.number().optional().nullable(),
    hilEnabled: z.boolean().optional(),
    expertiseJobId: z.number().optional().nullable(),
    allowedTopicIds: z.array(z.number()).optional(),
    allowedDatasetIds: z.array(z.number()).optional(),
    allowedAgentIds: z.array(z.number()).optional(),
    allowedPipelineIds: z.array(z.number()).optional(),
    defaultCollections: z.array(z.string()).optional(),
    deploymentMode: z.enum(['chat', 'browser_autopilot']).optional(),
    browserStartUrl: z.string().url().optional().nullable().or(z.literal("")),
    browserGoal: z.string().optional().nullable(),
    browserConfig: z.record(z.any()).optional(),
    navigationalMemoryShared: z.boolean().optional(),
}).partial().extend({
    password: z.string().optional(),
});
export const selectAppDeploymentSchema = createSelectSchema(appDeployments);
export type AppDeployment = typeof appDeployments.$inferSelect;
export type InsertAppDeployment = z.infer<typeof insertAppDeploymentSchema>;

export const insertAppUserUsageSchema = createInsertSchema(appUserUsage);
export const selectAppUserUsageSchema = createSelectSchema(appUserUsage);
export type AppUserUsage = typeof appUserUsage.$inferSelect;
export type InsertAppUserUsage = z.infer<typeof insertAppUserUsageSchema>;

export const insertAppPayoutSchema = createInsertSchema(appPayouts);
export const selectAppPayoutSchema = createSelectSchema(appPayouts);
export type AppPayout = typeof appPayouts.$inferSelect;
export type InsertAppPayout = z.infer<typeof insertAppPayoutSchema>;

export const insertAppTelemetrySchema = createInsertSchema(appTelemetry);
export const selectAppTelemetrySchema = createSelectSchema(appTelemetry);
export type AppTelemetry = typeof appTelemetry.$inferSelect;

export const insertAppAuditLogSchema = createInsertSchema(appAuditLogs);
export const selectAppAuditLogSchema = createSelectSchema(appAuditLogs);
export type AppAuditLog = typeof appAuditLogs.$inferSelect;

export const appAudits = pgTable("app_audits", {
    id: serial("id").primaryKey(),
    appId: integer("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    jobId: text("job_id"), // The forge job ID
    success: boolean("success").notNull(),
    summary: text("summary").notNull(),
    output: text("output"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    appIdx: index("app_audits_app_idx").on(table.appId),
    jobIdx: index("app_audits_job_idx").on(table.jobId),
}));

export type AppAudit = typeof appAudits.$inferSelect;



// ============================================================================
// APP VERSIONS â€” Git-like version control for forged apps
// Tracks changes, supports branching, diffing, and rollback operations
// ============================================================================

export const appVersions: any = pgTable("app_versions", {
    id: text("id").primaryKey(),
    appId: integer("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
    
    // Version metadata
    versionNumber: integer("version_number").notNull(),
    commitHash: varchar("commit_hash", { length: 64 }).notNull(),
    message: text("message").notNull(),
    author: varchar("author", { length: 255 }).notNull(),
    branch: varchar("branch", { length: 100 }).default("main").notNull(),
    
    // Versioning links - using any to break circular reference
    parentVersionId: text("parent_version_id").references((): any => appVersions.id, { onDelete: "set null" }),
    tags: text("tags").array().default(sql`ARRAY[]::text[]`),
    
    // Snapshot info
    snapshotPath: text("snapshot_path").notNull(),
    fileCount: integer("file_count").default(0).notNull(),
    
    // Change statistics
    linesAdded: integer("lines_added").default(0).notNull(),
    linesRemoved: integer("lines_removed").default(0).notNull(),
    filesChanged: integer("files_changed").default(0).notNull(),
    
    // Status
    isRollback: boolean("is_rollback").default(false).notNull(),
    rolledBackAt: timestamp("rolled_back_at"),
    
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    appIdx: index("app_versions_app_idx").on(table.appId),
    orgIdx: index("app_versions_org_idx").on(table.organizationId),
    commitHashIdx: uniqueIndex("app_versions_commit_hash_idx").on(table.appId, table.commitHash),
    versionNumberIdx: uniqueIndex("app_versions_version_number_idx").on(table.appId, table.versionNumber),
    branchIdx: index("app_versions_branch_idx").on(table.appId, table.branch),
}));

export const insertAppVersionSchema = createInsertSchema(appVersions);
export const selectAppVersionSchema = createSelectSchema(appVersions);
export type AppVersion = typeof appVersions.$inferSelect;
export type InsertAppVersion = z.infer<typeof insertAppVersionSchema>;




