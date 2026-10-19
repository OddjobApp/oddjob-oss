import { sql } from "drizzle-orm";
import {
    pgTable,
    text,
    varchar,
    serial,
    boolean,
    timestamp,
    integer,
    jsonb,
    primaryKey,
    bigint,
    smallint,
    uuid,
    check,
    uniqueIndex,
    decimal,
    index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from "./auth.js";

// ============================================================================
// CREDENTIALS
// ============================================================================

// Supported AI providers
export const aiProviders = ["openai", "anthropic", "google", "midjourney", "ollama", "local_openai"] as const;
export type AIProvider = (typeof aiProviders)[number];

// Credential types
export const credentialTypes = [
    "api_key",
    "password",
    "oauth_token",
    "webhook",
    "ssh_key",
    "ai_provider",
    "jira",
    "airflow",
    "database",
    "smtp",
    "cloud_storage",
    "confluence",
    "browser_session",
] as const;
export type CredentialType = (typeof credentialTypes)[number];


// Provider-specific metadata schemas
export const openAIMetadataSchema = z.object({
    provider: z.literal("openai"),
    organizationId: z.string().optional(),
    apiVersion: z.string().optional(),
});

export const midjourneyMetadataSchema = z.object({
    provider: z.literal("midjourney"),
    baseUrl: z.string().url().describe("API Endpoint URL (Proxy)"),
    mode: z.enum(["fast", "relax"]).default("fast"),
});

export const anthropicMetadataSchema = z.object({
    provider: z.literal("anthropic"),
    apiVersion: z.string().default("2023-06-01"),
});

export const googleMetadataSchema = z.object({
    provider: z.literal("google"),
    projectId: z.string().optional(),
});

export const ollamaMetadataSchema = z.object({
    provider: z.literal("ollama"),
    baseUrl: z.string().url().default("http://localhost:11434"),
    model: z.string().optional(), // Default model override
});

export const multiTokenPredictionMetadataSchema = z.object({
    enabled: z.boolean().default(false),
    backend: z.enum(["vllm", "sglang", "custom"]).optional(),
    numSpeculativeTokens: z.number().int().min(1).max(16).optional(),
    requestPassthrough: z.boolean().default(false),
    extraRequestBody: z.record(z.any()).optional(),
});

export const localOpenAIMetadataSchema = z.object({
    provider: z.literal("local_openai"),
    baseUrl: z.string().url().default("http://localhost:1234/v1"),
    multiTokenPrediction: multiTokenPredictionMetadataSchema.optional(),
});

export const museMetadataSchema = z.object({
    provider: z.literal("muse"),
    baseUrl: z.string().url().default("https://api.meta.ai/v1"),
    model: z.string().optional(), // e.g. "muse-spark-1.3"; falls back to the service default
});

// Union schema for all AI provider metadata
export const aiProviderMetadataSchema = z.discriminatedUnion("provider", [
    openAIMetadataSchema,
    anthropicMetadataSchema,
    googleMetadataSchema,
    midjourneyMetadataSchema,
    ollamaMetadataSchema,
    localOpenAIMetadataSchema,
    museMetadataSchema,
]);

export type AIProviderMetadata = z.infer<typeof aiProviderMetadataSchema>;

// JIRA credential metadata schema
export const jiraMetadataSchema = z.object({
    apiKey: z.string(),
    account: z.string(),
    endpoint: z.string().url(),
});

export const airflowMetadataSchema = z.object({
    baseUrl: z.string().url(),
    authType: z.enum(["basic", "bearer", "none"]).default("none"),
    username: z.string().optional(),
});

export type JiraMetadata = z.infer<typeof jiraMetadataSchema>;
export type AirflowMetadata = z.infer<typeof airflowMetadataSchema>;

export const smtpMetadataSchema = z.object({
    host: z.string(),
    port: z.number().int(),
    secure: z.boolean().default(true),
    user: z.string(),
    fromEmail: z.string().email(),
});

export type SmtpMetadata = z.infer<typeof smtpMetadataSchema>;

export const databaseMetadataSchema = z.object({
    host: z.string(),
    port: z.number().int().default(5432),
    database: z.string(),
    user: z.string(),
    engine: z.enum(["postgres", "mysql", "mssql", "snowflake"]).default("postgres"),
    ssl: z.boolean().default(false).optional(),
});

export type DatabaseMetadata = z.infer<typeof databaseMetadataSchema>;

export const cloudStorageMetadataSchema = z.discriminatedUnion("provider", [
    // AWS S3
    z.object({
        provider: z.literal("aws"),
        accessKeyId: z.string(),
        secretAccessKey: z.string(),
        region: z.string().default("us-east-1"),
    }),
    // Google Cloud Storage (Service Account)
    z.object({
        provider: z.literal("gcp"),
        projectId: z.string(),
        clientEmail: z.string(),
        privateKey: z.string(), // PEM formatted
    }),
    // Azure Blob Storage
    z.object({
        provider: z.literal("azure"),
        connectionString: z.string(),
    }),
    // OAuth-based Drives (Drive/OneDrive)
    z.object({
        provider: z.literal("google_drive"),
        clientId: z.string(),
        clientSecret: z.string(),
        refreshToken: z.string(),
    }),
]);

export type CloudStorageMetadata = z.infer<typeof cloudStorageMetadataSchema>;

export const confluenceMetadataSchema = z.object({
    apiKey: z.string(),
    account: z.string(),
    endpoint: z.string().url(),
    domain: z.string().optional(),
    spaceKey: z.string().optional().describe("Lock this credential to a specific Confluence Space Key (e.g. ENG)"),
});

export type ConfluenceMetadata = z.infer<typeof confluenceMetadataSchema>;

export const browserSessionMetadataSchema = z.object({
    domain: z.string().describe("Primary domain for this session (e.g. linkedin.com)"),
    cookies: z.array(z.object({
        name: z.string(),
        value: z.string(),
        domain: z.string().optional(),
        path: z.string().optional(),
        expires: z.number().optional(),
        httpOnly: z.boolean().optional(),
        secure: z.boolean().optional(),
        sameSite: z.enum(["Lax", "None", "Strict"]).optional(),
    })).optional(),
    rawCookie: z.string().optional().describe("Raw cookie string for legacy/manual hand-off"),
});

export type BrowserSessionMetadata = z.infer<typeof browserSessionMetadataSchema>;

export type GoogleDriveMetadata = {
    provider: "google_drive";
    clientId: string;
    clientSecret: string;
    refreshToken: string;
};

// Amazon product-data providers (api_key credentials; the secret lives in the
// credential secret store — the client secret or provider API key — never here)
export const amazonProviderMetadataSchema = z.object({
    provider: z.enum(["amazon_creators", "amazon_rainforest", "amazon_serpapi"]),
    clientId: z.string().optional().describe("Creators API Credential ID (amazon_creators only)"),
    version: z.enum(["3.1", "3.2", "3.3"]).optional().describe("Creators API region: 3.1 NA, 3.2 EU, 3.3 FE"),
    partnerTag: z.string().optional().describe("Associates partner tag (amazon_creators only)"),
    marketplace: z.string().optional().describe("Marketplace domain, e.g. www.amazon.com"),
    amazonDomain: z.string().optional().describe("Rainforest/SerpApi marketplace spelling, e.g. amazon.com"),
});

export type AmazonProviderMetadata = z.infer<typeof amazonProviderMetadataSchema>;

// Union schema for all credential metadata types
export const credentialMetadataSchema = z.union([
    aiProviderMetadataSchema,
    jiraMetadataSchema,
    airflowMetadataSchema,
    databaseMetadataSchema,
    smtpMetadataSchema,
    cloudStorageMetadataSchema,
    confluenceMetadataSchema,
    browserSessionMetadataSchema,
    amazonProviderMetadataSchema,
    z.null(),
]);

export type CredentialMetadata = z.infer<typeof credentialMetadataSchema>;

export const credentials = pgTable("credentials", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").notNull(), // One of credentialTypes
    description: text("description"),
    // Reference to Odd Job Secret environment variable name
    envVarName: text("env_var_name").notNull(),
    // Provider-specific metadata (only for ai_provider type)
    metadata: jsonb("metadata"),
    organizationId: integer("organization_id").references(() => orgs.id),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Insert schema - requires validation
export const insertCredentialSchema = createInsertSchema(credentials, {
    name: z.string().min(1, "Name is required"),
    type: z.enum(credentialTypes),
    description: z.string().optional().nullable(),
    envVarName: z
        .string()
        .min(1, "Environment variable name is required")
        .regex(
            /^[A-Z][A-Z0-9_]*$/,
            "Must be uppercase with underscores (e.g., OPENAI_API_KEY)",
        ),
    metadata: credentialMetadataSchema.optional().nullable(),
    organizationId: z.number().int().positive().optional().nullable(),
    createdBy: z.string().min(1),
});

export const updateCredentialSchema = insertCredentialSchema.partial();

export type InsertCredential = z.infer<typeof insertCredentialSchema>;
export type UpdateCredential = z.infer<typeof updateCredentialSchema>;
export type Credential = typeof credentials.$inferSelect;

// Helper to validate AI provider credentials
export const validateAIProviderCredential = (credential: InsertCredential) => {
    if (credential.type === "ai_provider") {
        if (!credential.metadata) {
            throw new Error("AI provider credentials require metadata");
        }
        return aiProviderMetadataSchema.parse(credential.metadata);
    }
    return null;
};

// Helper to validate JIRA credentials
export const validateJiraCredential = (credential: InsertCredential) => {
    if (credential.type === "jira") {
        if (!credential.metadata) {
            throw new Error("JIRA credentials require metadata (apiKey, account, and endpoint)");
        }
        return jiraMetadataSchema.parse(credential.metadata);
    }
    return null;
};

// Helper to validate Airflow credentials
export const validateAirflowCredential = (credential: InsertCredential) => {
    if (credential.type === "airflow") {
        if (!credential.metadata) {
            throw new Error("Airflow credentials require metadata (baseUrl)");
        }
        return airflowMetadataSchema.parse(credential.metadata);
    }
    return null;
};

export const validateDatabaseCredential = (credential: InsertCredential) => {
    if (credential.type === "database") {
        if (!credential.metadata) {
            throw new Error("Database credentials require metadata");
        }
        return databaseMetadataSchema.parse(credential.metadata);
    }
    return null;
};

export const validateSmtpCredential = (credential: InsertCredential) => {
    if (credential.type === "smtp") {
        if (!credential.metadata) throw new Error("SMTP credentials require metadata");
        return smtpMetadataSchema.parse(credential.metadata);
    }
    return null;
};

export const validateCloudStorageCredential = (credential: InsertCredential) => {
    if (credential.type === "cloud_storage") {
        if (!credential.metadata) throw new Error("Cloud Storage credentials require metadata");
        return cloudStorageMetadataSchema.parse(credential.metadata);
    }
    return null;
};

export const validateBrowserSessionCredential = (credential: InsertCredential) => {
    if (credential.type === "browser_session") {
        if (!credential.metadata) throw new Error("Browser Session credentials require metadata");
        return browserSessionMetadataSchema.parse(credential.metadata);
    }
    return null;
};

// ============================================================================
// SYSTEM SETTINGS
// ============================================================================

export const systemSettings = pgTable("system_settings", {
    key: text("key").primaryKey().default("global"),
    settingsData: jsonb("settings_data")
        .default(sql`'{}'::jsonb`)
        .notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    updatedBy: text("updated_by_user_id"),
});

export const fallbackModelSchema = z.object({ provider: z.string(), model: z.string() });
export const systemAiDefaultsSchema = z.object({
    concierge: z.object({
        provider: z.string().default("ollama"),
        model: z.string().default("mistral:latest"),
        fallbackModels: z.array(fallbackModelSchema).optional(),
    }).optional(),
    copilot: z.object({
        provider: z.string().default("google"),
        model: z.string().default("gemini-1.5-pro"),
        maxIterations: z.number().min(1).max(50).default(5).optional(),
        timeoutMs: z.number().min(1000).default(120000).optional(),
        fallbackModels: z.array(fallbackModelSchema).optional(),
    }).optional(),
    faultAnalysis: z.object({
        provider: z.string().default("ollama"),
        model: z.string().default("llama3:8b"),
        fallbackModels: z.array(fallbackModelSchema).optional(),
    }).optional(),
    architect: z.object({
        provider: z.string().default("google"),
        model: z.string().default("gemini-1.5-pro"),
        fallbackModels: z.array(fallbackModelSchema).optional(),
    }).optional(),
    governor: z.object({
        provider: z.string().default("ollama"),
        model: z.string().default("llama3:8b"),
        fallbackModels: z.array(fallbackModelSchema).optional(),
    }).optional(),
    extraction: z.object({
        provider: z.string().default("ollama"),
        model: z.string().default("mistral:latest"),
        fallbackModels: z.array(fallbackModelSchema).optional(),
    }).optional(),
    ragEmbeddings: z.object({
        provider: z.string().default("google"),
        model: z.string().default("models/gemini-embedding-001"),
        fallbackModels: z.array(fallbackModelSchema).optional(),
    }).optional(),
    codegen: z.object({
        provider: z.string().default("google"),
        model: z.string().default("gemini-1.5-pro"),
        fallbackModels: z.array(fallbackModelSchema).optional(),
    }).optional(),
    ollama: z.object({
        provider: z.string().default("ollama"),
        model: z.string().default("deepseek-r1:latest"),
        baseUrl: z.string().default("http://localhost:11434"),
    }).optional(),
});

export const insertSystemSettingsSchema = createInsertSchema(systemSettings, {
    key: z.string().default("global"),
    settingsData: z.record(z.any()).default({}), // Keeping generic for now to avoid breaking existing generic access, but we can document structure
});

export type SystemAiDefaults = z.infer<typeof systemAiDefaultsSchema>;

export type InsertSystemSettings = z.infer<typeof insertSystemSettingsSchema>;
export type SystemSettings = typeof systemSettings.$inferSelect;

// ============================================================================
// AUDIT EVENTS
// ============================================================================

export const auditCategories = [
    "user",
    "job",
    "pipeline",
    "schedule",
    "credential",
    "org",
    "alert",
    "repeater",
    "openapi",
] as const;
export type AuditCategory = (typeof auditCategories)[number];

export const auditActions = [
    "create",
    "update",
    "delete",
    "execute",
    "login",
    "logout",
] as const;
export type AuditAction = (typeof auditActions)[number];

export const auditEvents = pgTable("audit_events", {
    id: serial("audit_id").primaryKey(),
    eventTime: timestamp("event_time").defaultNow().notNull(),
    category: varchar("category", { length: 40 }).notNull(),
    action: varchar("action", { length: 40 }).notNull(),
    actor: text("actor"),
    refType: varchar("ref_type", { length: 40 }),
    refId: integer("ref_id"),
    refName: text("ref_name"),
    details: jsonb("details")
        .default(sql`'{}'::jsonb`)
        .notNull(),
});

export const insertAuditEventSchema = createInsertSchema(auditEvents, {
    category: z.string().min(1),
    action: z.string().min(1),
    details: z.any().optional(),
    actor: z.string().optional().nullable(),
    refType: z.string().optional().nullable(),
    refId: z.number().int().optional().nullable(),
    refName: z.string().optional().nullable(),
});

export type InsertAuditEvent = z.infer<typeof insertAuditEventSchema>;
export type AuditEvent = typeof auditEvents.$inferSelect;

// ============================================================================
// STORED FILES (with versioning support)
// ============================================================================

export const storedFiles = pgTable("stored_files", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(), // Filename
    path: text("path").notNull(), // Full path relative to org root
    mimeType: text("mime_type"), // MIME type (image/png, application/pdf, etc.)
    size: bigint("size", { mode: "number" }).notNull(), // Current version size in bytes
    checksum: text("checksum"), // SHA256 of current version
    description: text("description"),
    tags: text("tags").array().default(sql`ARRAY[]::text[]`),
    versionCount: integer("version_count").default(1).notNull(),
    currentVersionId: integer("current_version_id"), // FK to storedFileVersions
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    deletedAt: timestamp("deleted_at"), // Soft delete
}, (table) => ({
    pathIdx: index("stored_file_path_idx").on(table.path),
    orgIdx: index("stored_file_org_idx").on(table.organizationId),
    mimeIdx: index("stored_file_mime_idx").on(table.mimeType),
    uniqueOrgPath: uniqueIndex("stored_file_org_path_unique").on(table.organizationId, table.path),
}));

export type StoredFile = typeof storedFiles.$inferSelect;
export type InsertStoredFile = typeof storedFiles.$inferInsert;

export const storedFileVersions = pgTable("stored_file_versions", {
    id: serial("id").primaryKey(),
    fileId: integer("file_id")
        .notNull()
        .references(() => storedFiles.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull().default(1),
    size: bigint("size", { mode: "number" }).notNull(),
    checksum: text("checksum").notNull(), // SHA256 of this version
    storagePath: text("storage_path").notNull(), // Actual path on disk (includes version suffix)
    changeDescription: text("change_description"), // What changed in this version
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    fileVersionIdx: index("file_version_idx").on(table.fileId, table.versionNumber),
}));

export type StoredFileVersion = typeof storedFileVersions.$inferSelect;
export type InsertStoredFileVersion = typeof storedFileVersions.$inferInsert;

export const insertStoredFileSchema = z.object({
    name: z.string().min(1, "Filename is required").max(255),
    path: z.string().min(1, "Path is required").max(1000),
    mimeType: z.string().max(100).optional().nullable(),
    size: z.number().int().min(0),
    checksum: z.string().max(64).optional().nullable(),
    description: z.string().max(1000).optional().nullable(),
    tags: z.array(z.string()).optional().default([]),
    organizationId: z.number().int().positive().optional().nullable(),
    createdBy: z.string().optional().nullable(),
});

export const updateStoredFileSchema = insertStoredFileSchema.partial().extend({
    description: z.string().max(1000).optional().nullable(),
    tags: z.array(z.string()).optional(),
});

export type CreateStoredFileInput = z.infer<typeof insertStoredFileSchema>;
export type UpdateStoredFileInput = z.infer<typeof updateStoredFileSchema>;



// ============================================================================
// SYSTEM DEPENDENCIES (3rd Party Libraries)
// ============================================================================

export const systemDependencies = pgTable("system_dependencies", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    version: text("version").notNull(),
    license: text("license"),
    feature: text("feature"), // Human-assigned feature tag
    securityAlertsCount: integer("security_alerts_count").default(0).notNull(),
    vulnerabilityDetails: jsonb("vulnerability_details").default(sql`'[]'::jsonb`),
    lastSyncedAt: timestamp("last_synced_at").defaultNow().notNull(),
    organizationId: integer("organization_id").references(() => orgs.id),
}, (table) => ({
    uniqueName: uniqueIndex("system_dep_name_unique").on(table.name),
}));

export const insertSystemDependencySchema = createInsertSchema(systemDependencies).omit({
    id: true,
    lastSyncedAt: true,
});

export const updateSystemDependencySchema = insertSystemDependencySchema.partial();

export type SystemDependency = typeof systemDependencies.$inferSelect;
export type InsertSystemDependency = typeof systemDependencies.$inferInsert;

// ============================================================================
// INTEGRATION LOGS
// ============================================================================

export const integrationLogs = pgTable("integration_logs", {
    id: serial("id").primaryKey(),
    platform: varchar("platform", { length: 50 }).notNull(), // e.g., 'jira', 'confluence', 'google-ai'
    action: varchar("action", { length: 100 }),
    method: varchar("method", { length: 10 }).notNull(),
    url: text("url").notNull(),

    // Payload Context
    requestHeaders: jsonb("request_headers"),
    requestBody: jsonb("request_body"),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    error: text("error"),
    durationMs: integer("duration_ms"),

    // Rate Limiting (SaaS/AI)
    rateLimitLimit: integer("rate_limit_limit"),
    rateLimitRemaining: integer("rate_limit_remaining"),
    rateLimitReset: timestamp("rate_limit_reset", { withTimezone: true }),

    // AI Specific
    model: text("model"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    costUsd: decimal("cost_usd", { precision: 12, scale: 6 }),

    // Governance Context
    organizationId: integer("organization_id").references(() => orgs.id),
    userId: text("user_id"),
    traceId: text("trace_id"),
    missionId: integer("mission_id"),
    isPriority: boolean("is_priority").default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    platformIdx: index("int_log_platform_idx").on(table.platform),
    orgIdx: index("int_log_org_idx").on(table.organizationId),
    createdAtIdx: index("int_log_created_at_idx").on(table.createdAt),
    statusIdx: index("int_log_status_idx").on(table.responseStatus),
}));

export const insertIntegrationLogSchema = createInsertSchema(integrationLogs);
export type IntegrationLog = typeof integrationLogs.$inferSelect;
export type InsertIntegrationLog = typeof integrationLogs.$inferInsert;



