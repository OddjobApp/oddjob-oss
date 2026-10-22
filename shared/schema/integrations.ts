import { sql } from "drizzle-orm";
import { sealedJsonb } from "./sealed-json.js";
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
import { orgs, users } from './auth.js';
import { projects } from './projects.js';

// ============================================================================
// OPENAPI / SWAGGER INTEGRATION
// ============================================================================

export const apiSpecs = pgTable("api_specs", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    sourceUrl: text("source_url"),
    content: jsonb("content").notNull(), // The full OpenAPI/Swagger definition
    isSystemLevel: boolean("is_system_level").default(false).notNull(),
    status: text("status").default("draft").notNull(), // 'draft', 'testing', 'published', 'deprecated'
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertApiSpecSchema = createInsertSchema(apiSpecs, {
    content: z.record(z.string(), z.any()), // JSON validation
    status: z.enum(["draft", "testing", "published", "deprecated"]),
});

export type ApiSpec = typeof apiSpecs.$inferSelect;
export type InsertApiSpec = z.infer<typeof insertApiSpecSchema>;

export const orgSpecAccess = pgTable("org_spec_access", {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),
    specId: integer("spec_id")
        .notNull()
        .references(() => apiSpecs.id, { onDelete: "cascade" }),
    enabledAt: timestamp("enabled_at", { withTimezone: true }).defaultNow().notNull(),
    settings: jsonb("settings"), // Overrides like base URL specific to this org
}, (table) => ({
    // Ensure unique pairing of Org and Spec
    unq: uniqueIndex("org_spec_access_unq").on(table.orgId, table.specId),
}));

// ============================================================================
// SAAS INTEGRATIONS
// ============================================================================

export const saasConnectors = pgTable("saas_connectors", {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(), // 'slack', 'github', 'jira', 'teams', 'confluence'
    /**
     * The project space that owns this connection, or NULL for org-wide.
     *
     * A Jira project key or a Confluence space key lives in `config`, so without
     * this an org could bind only one of each — "this project syncs to the ENG
     * space" was unrepresentable. See migration 0080.
     */
    projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
    baseUrl: text("base_url"),
    status: text("status").default("disconnected").notNull(),
    config: jsonb("config").$type<Record<string, any>>().default({}).notNull(),
    /**
     * Encrypted at rest (sealed-json.ts): API keys, passwords and OAuth tokens.
     * Anything that must be queried (a Slack team_id) belongs in `config`.
     */
    credentials: sealedJsonb<Record<string, any>>("credentials").default({}).notNull(),
    credentialId: integer("credential_id"),
    lastSync: timestamp("last_sync", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    // Two partial indexes, not one: Postgres treats NULLs as distinct, so a
    // single (org_id, project_id, platform) index would let an org accumulate
    // unlimited org-wide connectors for the same platform.
    unq: uniqueIndex("saas_connector_org_platform_unq")
        .on(table.orgId, table.platform)
        .where(sql`project_id IS NULL`),
    projectUnq: uniqueIndex("saas_connector_org_project_platform_unq")
        .on(table.orgId, table.projectId, table.platform)
        .where(sql`project_id IS NOT NULL`),
    projectIdx: index("saas_connector_project_idx").on(table.projectId),
}));

export const userSaasConnections = pgTable("user_saas_connections", {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),
    userId: text("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    status: text("status").default("disconnected").notNull(),
    config: jsonb("config").$type<Record<string, any>>().default({}).notNull(),
    credentialId: integer("credential_id"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    userPlatformUnq: uniqueIndex("user_saas_connection_org_user_platform_unq").on(
        table.orgId,
        table.userId,
        table.platform
    ),
    orgIdx: index("user_saas_connection_org_idx").on(table.orgId),
    userIdx: index("user_saas_connection_user_idx").on(table.userId),
}));

export const insertUserSaasConnectionSchema = createInsertSchema(userSaasConnections);
export const selectUserSaasConnectionSchema = createSelectSchema(userSaasConnections);
export type UserSaasConnection = typeof userSaasConnections.$inferSelect;
export type InsertUserSaasConnection = z.infer<typeof insertUserSaasConnectionSchema>;

export const saasSyncConfigs = pgTable("saas_sync_configs", {
    id: serial("id").primaryKey(),
    connectorId: integer("connector_id")
        .notNull()
        .references(() => saasConnectors.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").default(true).notNull(),
    syncInterval: integer("sync_interval").default(15).notNull(), // minutes
    conflictResolution: text("conflict_resolution").default("last_write_wins").notNull(),
    mappings: jsonb("mappings").$type<Record<string, any>>().default({}).notNull(),
    filters: jsonb("filters").$type<Record<string, any>>().default({}).notNull(),
    lastDailyBrief: timestamp("last_daily_brief", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    unq: uniqueIndex("saas_sync_config_connector_unq").on(table.connectorId),
}));

/**
 * The external resources a project reaches through a connection.
 *
 * A connector is the site plus credential; a Confluence space or a Jira project
 * is a resource inside it. Keeping them apart lets one Confluence connection
 * serve ENG and DOCS as two bindings, each its own assembly piece. See
 * migration 0081.
 *
 * This is an organizing boundary, not a security one — credentials live on the
 * connector, so a binding does not stop the same token reading other spaces.
 */
export const projectSaasBindings = pgTable("project_saas_bindings", {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),
    projectId: integer("project_id")
        .notNull()
        .references(() => projects.id, { onDelete: "cascade" }),
    connectorId: integer("connector_id")
        .notNull()
        .references(() => saasConnectors.id, { onDelete: "cascade" }),
    /** 'confluence_space' | 'jira_project' — text, so a new platform needs no migration. */
    resourceKind: text("resource_kind").notNull(),
    /** The stable identifier the remote system uses: a space key, a project key. */
    resourceKey: text("resource_key").notNull(),
    resourceName: text("resource_name"),
    /** ConfluenceSpace.type (global/personal) or JiraProject.projectTypeKey. */
    resourceType: text("resource_type"),
    externalId: text("external_id"),
    webUrl: text("web_url"),
    boundBy: text("bound_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    unq: uniqueIndex("project_saas_binding_unq").on(table.projectId, table.connectorId, table.resourceKey),
    projectIdx: index("project_saas_binding_project_idx").on(table.projectId),
    connectorIdx: index("project_saas_binding_connector_idx").on(table.connectorId),
}));

export const insertProjectSaasBindingSchema = createInsertSchema(projectSaasBindings);
export const selectProjectSaasBindingSchema = createSelectSchema(projectSaasBindings);

export const saasSchemaSnapshots = pgTable("saas_schema_snapshots", {
    id: serial("id").primaryKey(),
    connectorId: integer("connector_id")
        .notNull()
        .references(() => saasConnectors.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    fields: jsonb("fields").$type<any[]>().notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    connectorIdx: index("saas_schema_snapshot_connector_idx").on(table.connectorId),
}));

export const insertSaasConnectorSchema = createInsertSchema(saasConnectors);
export const selectSaasConnectorSchema = createSelectSchema(saasConnectors);
export type SaasConnector = typeof saasConnectors.$inferSelect;
export type InsertSaasConnector = z.infer<typeof insertSaasConnectorSchema>;

export const insertSaasSyncConfigSchema = createInsertSchema(saasSyncConfigs);
export const selectSaasSyncConfigSchema = createSelectSchema(saasSyncConfigs);
export type SaasSyncConfig = typeof saasSyncConfigs.$inferSelect;
export type InsertSaasSyncConfig = z.infer<typeof insertSaasSyncConfigSchema>;

export const insertSaasSchemaSnapshotSchema = createInsertSchema(saasSchemaSnapshots);
export const selectSaasSchemaSnapshotSchema = createSelectSchema(saasSchemaSnapshots);
export type SaasSchemaSnapshot = typeof saasSchemaSnapshots.$inferSelect;
export type InsertSaasSchemaSnapshot = z.infer<typeof insertSaasSchemaSnapshotSchema>;

export const gatewayRequestLogs = pgTable("gateway_request_logs", {
    id: serial("id").primaryKey(),
    platform: text("platform").notNull(),
    action: text("action").notNull(),
    method: text("method").notNull(),
    url: text("url").notNull(),
    requestHeaders: jsonb("request_headers"),
    requestBody: jsonb("request_body"),
    responseStatus: integer("response_status"),
    responseHeaders: jsonb("response_headers"),
    responseBody: jsonb("response_body"),
    durationMs: integer("duration_ms"),
    organizationId: integer("organization_id").references(() => orgs.id),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertGatewayRequestLogSchema = createInsertSchema(gatewayRequestLogs);
export const selectGatewayRequestLogSchema = createSelectSchema(gatewayRequestLogs);
export type GatewayRequestLog = typeof gatewayRequestLogs.$inferSelect;
export type InsertGatewayRequestLog = z.infer<typeof insertGatewayRequestLogSchema>;

export const saasEventWorkflows = pgTable("saas_event_workflows", {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(), // 'jira', 'slack', etc.
    triggerEvent: text("trigger_event").notNull(), // 'issue_created', 'message_received'
    workflowId: text("workflow_id").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    conditions: jsonb("conditions").$type<Record<string, any>>().default({}).notNull(),
    transformation: jsonb("transformation").$type<Record<string, any>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    unq: uniqueIndex("saas_event_workflow_org_platform_id_unq").on(table.orgId, table.platform, table.workflowId),
}));

export const insertSaasEventWorkflowSchema = createInsertSchema(saasEventWorkflows);
export const selectSaasEventWorkflowSchema = createSelectSchema(saasEventWorkflows);
export type SaasEventWorkflow = typeof saasEventWorkflows.$inferSelect;
export type InsertSaasEventWorkflow = z.infer<typeof insertSaasEventWorkflowSchema>;

/**
 * Remote-record ↔ local-record pairs written by SaaS sync.
 *
 * Each row links one remote object (e.g. a QuickBooks invoice) to the local
 * record that mirrors it (an app_records row), recording the remote revision
 * so incremental sync can upsert rather than duplicate, and so writes the
 * platform itself made through an approval (`direction = 'out'`) do not echo
 * back in as "new" remote records. See migration 0145.
 */
export const saasSyncLinks = pgTable("saas_sync_links", {
    id: serial("id").primaryKey(),
    connectorId: integer("connector_id")
        .notNull()
        .references(() => saasConnectors.id, { onDelete: "cascade" }),
    orgId: integer("org_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),
    /** 'in' = remote record mirrored locally by sync; 'out' = local write pushed to the remote. */
    direction: text("direction").default("in").notNull(),
    /** The local collection holding the mirror (e.g. 'receivables', 'transactions', 'dataset'). */
    localCollection: text("local_collection").notNull(),
    localRecordId: text("local_record_id").notNull(),
    /** Remote entity type — 'Invoice', 'Payment', … (QuickBooks) or the platform equivalent. */
    remoteEntity: text("remote_entity").notNull(),
    remoteId: text("remote_id").notNull(),
    /** Remote revision marker — QuickBooks SyncToken — used for last_write_wins checks. */
    remoteSyncToken: text("remote_sync_token"),
    remoteData: jsonb("remote_data"), // Latest source snapshot for financial ontology, never an inferred balance
    remoteUpdatedAt: timestamp("remote_updated_at", { withTimezone: true }),
    /** Hash of the mirrored local payload, to detect local edits between syncs. */
    localHash: text("local_hash"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    remoteUnq: uniqueIndex("saas_sync_link_remote_unq").on(table.connectorId, table.remoteEntity, table.remoteId),
    localUnq: uniqueIndex("saas_sync_link_local_unq").on(table.connectorId, table.localCollection, table.localRecordId),
    orgIdx: index("saas_sync_link_org_idx").on(table.orgId),
}));

export const insertSaasSyncLinkSchema = createInsertSchema(saasSyncLinks);
export const selectSaasSyncLinkSchema = createSelectSchema(saasSyncLinks);
export type SaasSyncLink = typeof saasSyncLinks.$inferSelect;
export type InsertSaasSyncLink = z.infer<typeof insertSaasSyncLinkSchema>;


