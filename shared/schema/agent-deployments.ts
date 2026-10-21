import { sql } from "drizzle-orm";
import {
    pgTable,
    text,
    serial,
    integer,
    timestamp,
    boolean,
    jsonb,
    uniqueIndex,
    index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from './auth.js';
import { jobs } from './jobs/table.js';

// Agent org roles within a tenant hierarchy
export const agentOrgRoles = [
    "executive",
    "manager",
    "lead",
    "worker",
    "specialist",
] as const;
export type AgentOrgRole = (typeof agentOrgRoles)[number];

// ============================================================================
// AGENT DEPLOYMENTS (Public Landing Pages)
// ============================================================================

export interface OceanTraits {
    o: number; // Openness
    c: number; // Conscientiousness
    e: number; // Extraversion
    a: number; // Agreeableness
    n: number; // Neuroticism
}

// ============================================================================
// AGENT FALLBACKS (Limp Mode)
// ============================================================================
// Every agent carries a manifest of deterministic routes it can serve with no
// model call at all. The platform derives this at synthesis/deploy time from
// what the agent already declares, so an agent cannot be created without one.
//
// The contract is deliberately narrow: a route either renders a form the agent
// already owns, runs a pipeline the caller already named, calls a read-safe
// tool, or states plainly that AI assist is offline. Nothing here guesses.

/** What a fallback route does when it fires. All are LLM-free. */
export const fallbackRouteKinds = [
    "serve_form",    // Render a cached form from formManifest
    "run_pipeline",  // Execute a pipeline the submission already identified by nonce
    "invoke_tool",   // Call a read-safe tool with literal/echoed params
    "static_reply",  // Terminal honest response
] as const;
export type FallbackRouteKind = (typeof fallbackRouteKinds)[number];

export interface FallbackRoute {
    kind: FallbackRouteKind;
    /** Stable id for telemetry and tests. */
    id: string;
    /**
     * When this route fires. Evaluated in manifest order; first match wins.
     * `always: true` marks the terminal catch-all.
     */
    match: {
        keywords?: string[];
        onFormSubmission?: boolean;
        always?: boolean;
    };
    /** serve_form: key into formManifest. */
    formId?: string;
    /** run_pipeline: pipeline id or `job_<id>` form-agent id. */
    pipelineId?: string;
    /** invoke_tool: registered tool name; must be read-safe. */
    tool?: string;
    /** invoke_tool: literal params merged over params echoed from the request. */
    params?: Record<string, unknown>;
    /** static_reply: the text to return. */
    message?: string;
    /** Where this route came from — derived routes are regenerated on every deploy. */
    source: "derived" | "blueprint" | "manual";
}

export interface AgentFallbackManifest {
    version: 1;
    generatedAt: string;
    /** Shown to the user whenever a fallback route serves the turn. */
    degradedNotice: string;
    routes: FallbackRoute[];
}

export const agentDeployments = pgTable("agent_deployments", {
    id: serial("id").primaryKey(),
    jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").notNull().references(() => orgs.id),
    /**
     * Project Space that owns this deployment. NULL means explicitly
     * org-global — visible from every project — matching the convention used by
     * event_primitives and operational_cycles.
     *
     * Filters MUST therefore read `projectId IS NULL OR projectId = :id`, never
     * a bare equality: every row predates this column and is NULL, so a strict
     * match would hide the entire existing fleet.
     */
    projectId: integer("project_id"),

    // Public Access Config
    slug: text("slug").notNull(), // Unique URL part
    title: text("title").notNull(),
    description: text("description"),
    welcomeMessage: text("welcome_message"),

    // Branding & UI
    brandingConfig: jsonb("branding_config").default(sql`'{}'::jsonb`), // { logoUrl, primaryColor, etc }

    // Security
    isActive: boolean("is_active").default(true),
    accessPolicy: text("access_policy").default("public"), // 'public', 'password', 'internal_only'
    accessPasswordHash: text("access_password_hash"),

    // Restrictions
    allowedFileTypes: text("allowed_file_types").array(), // e.g., ['image/*', '.pdf', '.csv']
    maxFileSizeMb: integer("max_file_size_mb").default(10),

    // Data Access Controls
    allowedTopicIds: integer("allowed_topic_ids").array(),
    allowedDatasetIds: integer("allowed_dataset_ids").array(),
    allowedPipelineIds: integer("allowed_pipeline_ids").array(),
    allowedTools: text("allowed_tools").array(), // Scoped system tools; empty = inherit all from job config
    formManifest: jsonb("form_manifest").default(sql`'{}'::jsonb`), // Cached form schemas for allowed pipelines
    // Deterministic routes served when the LLM is unavailable. Derived automatically
    // at deploy time from formManifest/allowedPipelineIds/allowedTools — see
    // AgentFallbackService.derive(). Never hand-maintained.
    fallbackManifest: jsonb("fallback_manifest").$type<AgentFallbackManifest | null>().default(sql`'{}'::jsonb`),

    // Embed personalization: { profileApiUrl, profileApiMethod?, profileApiTimeoutMs?, profileApiHeaders? }
    embedConfig: jsonb("embed_config").default(sql`'{}'::jsonb`),

    // Personalization: { openness, conscientiousness, extraversion, agreeableness, neuroticism }
    oceanTraits: jsonb("ocean_traits").default(sql`'{"o": 0.5, "c": 0.5, "e": 0.5, "a": 0.5, "n": 0.5}'::jsonb`),
    soulArchetype: text("soul_archetype").default("Lead Directive"), // Default archetype
    legend: text("legend"), // The autonomous record of the agent's identity and philosophy (QMD source)

    // -------------------------------------------------------------------------
    // Org Hierarchy (Paperclip alignment: tenant = company, agent = employee)
    // -------------------------------------------------------------------------
    // Self-referential FK: the agent this one reports to within the same org.
    // NULL = top of the org chart (CEO / root node).
    reportsToId: integer("reports_to_id"), // FK to agentDeployments.id — circular ref set below
    // Human-readable org role label for display in hierarchy UI
    orgRole: text("org_role").default("worker"), // agentOrgRoles

    // Durable send rules for this deployed agent — same semantics as
    // agent_cards.approval_boundary, resolved by the outbound send gate via
    // the executing job. "Never contact customers" hard-blocks, "always
    // review outbound" turns every send into a review card.
    approvalBoundary: text("approval_boundary"),

    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    slugUnique: uniqueIndex("agent_deployments_slug_unique").on(table.slug),
    jobUnique: uniqueIndex("agent_deployments_job_unique").on(table.jobId), // One deployment per job for now
    reportsToIdx: index("agent_deployments_reports_to_idx").on(table.reportsToId),
    orgHierarchyIdx: index("agent_deployments_org_hierarchy_idx").on(table.organizationId, table.reportsToId),
}));

// ============================================================================
// AGENT HIERARCHY NODE (Virtual type for tree traversal)
// ============================================================================
export interface AgentHierarchyNode {
    id: number;
    slug: string;
    title: string;
    orgRole: string | null;
    reportsToId: number | null;
    children: AgentHierarchyNode[];
}

export const insertAgentDeploymentSchema = createInsertSchema(agentDeployments, {
    slug: z.string().min(3).regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
    title: z.string().min(1),
    brandingConfig: z.object({
        logoUrl: z.string().optional(),
        primaryColor: z.string().optional(),
        theme: z.enum(['light', 'dark', 'system']).optional(),
    }).optional(),
    allowedFileTypes: z.array(z.string()).optional(),
    maxFileSizeMb: z.number().int().min(1).max(100).optional(),
    allowedTopicIds: z.array(z.number().int()).optional(),
    allowedDatasetIds: z.array(z.number().int()).optional(),
    allowedPipelineIds: z.array(z.number().int()).optional(),
    allowedTools: z.array(z.string()).optional(),
    formManifest: z.record(z.string(), z.any()).optional(), // pipelineId -> form schema
    embedConfig: z.object({
        allowChatInput: z.boolean().optional(), // Missing means enabled for existing deployments.
        buttons: z.array(z.object({
            id: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(80),
            label: z.string().min(1).max(100),
            message: z.string().min(1).max(2000),
        })).max(12).optional(),
        profileApiUrl: z.string().url().optional(),
        profileApiMethod: z.string().optional(),
        profileApiTimeoutMs: z.number().int().positive().optional(),
        profileApiHeaders: z.record(z.string(), z.string()).optional(),
        profileCacheTtlSeconds: z.number().int().min(0).max(300).optional(), // 0 = disabled, default 120
        allowedEmbedOrigins: z.array(z.string()).optional(), // Origins allowed to send credentials via postMessage
        enableHttpRequest: z.boolean().optional(), // When true, add http_request to allowed tools (subject to org allowlist)
    }).optional(),
}).extend({
    password: z.string().optional(),
}).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    createdBy: true,
    organizationId: true,
});

export type AgentDeployment = typeof agentDeployments.$inferSelect;
export type InsertAgentDeployment = z.infer<typeof insertAgentDeploymentSchema>;

// Zod schemas for hierarchy management
export const setReportsToSchema = z.object({
    supervisorId: z.number().int().positive().nullable(),
    orgRole: z.enum(agentOrgRoles).optional(),
});

/**
 * Recursive tree node for the agent org chart.
 * Each node may have children (direct reports).
 */
export interface AgentHierarchyNode {
    id: number;
    slug: string;
    title: string;
    orgRole: string | null;
    reportsToId: number | null;
    children: AgentHierarchyNode[];
}
