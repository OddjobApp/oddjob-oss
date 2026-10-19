/**
 * MCP API Tokens Schema
 * 
 * User-level API tokens for MCP HTTP access with granular permissions.
 * All permissions default to OFF until explicitly enabled.
 */

import {
    pgTable,
    serial,
    text,
    integer,
    boolean,
    timestamp,
    jsonb,
    index,
    uniqueIndex
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users, orgs } from './auth.js';

// ============================================================================
// MCP PERMISSIONS ENUM
// ============================================================================

export const mcpPermissions = [
    // Knowledge Graph
    "knowledge:read",           // search_knowledge_graph, get_entity_impact, get_graph_statistics
    "knowledge:write",          // create_entity, create_relationship, suggest_schema
    "knowledge:evolution",      // prune_knowledge, detect_knowledge_gaps

    // Pipelines
    "pipeline:read",            // list_pipelines, get_pipeline_details, list_recent_executions
    "pipeline:execute",         // run_pipeline, get_pipeline_execution_status
    "pipeline:write",           // create_pipeline, update_pipeline, delete_pipeline (future)

    // Jobs
    "job:read",                 // list_jobs, get_job_details
    "job:write",                // create_job, update_job, delete_job
    "job:execute",              // (future) run_job directly

    // Documents
    "document:read",            // search_documents, list_documents, get_document_content
    "document:write",           // (future) create_document, update_document

    // Datasets
    "dataset:read",             // list_datasets, get_dataset_details, query_dataset
    "dataset:write",            // create_dataset, add_dataset_items

    // Schedules
    "schedule:read",            // list_schedules, get_schedule_details
    "schedule:write",           // create_schedule, update_schedule, delete_schedule

    // Templates
    "template:read",            // list_templates, get_template_details
    "template:write",           // (future) create_template

    // SaaS Integrations
    "saas:read",                // list_saas_connectors, get_saas_connector_schema
    "saas:write",               // sync_saas_connector, update_saas_sync_config

    // Operational Cycles
    "cycle:read",               // list_cycles, get_cycle details â€” non-destructive fleet monitoring
    "cycle:write",              // launch, pause, resume, approve cycles

    // Admin (special)
    "admin:full",               // Bypass all permission checks (super admin only)
] as const;

export type McpPermission = typeof mcpPermissions[number];

// ============================================================================
// MCP API TOKENS TABLE
// ============================================================================

export const mcpApiTokens = pgTable("mcp_api_tokens", {
    id: serial("id").primaryKey(),

    // Token identification
    name: text("name").notNull(),                    // Human-readable name: "Onyx AI Integration"
    tokenHash: text("token_hash").notNull(),         // SHA-256 hash of the actual token
    tokenPrefix: text("token_prefix").notNull(),     // First 8 chars for identification: "mcp_abc1..."

    // Ownership
    userId: text("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),

    // Permissions (all default to false)
    permissions: jsonb("permissions").$type<McpPermission[]>().default([]).notNull(),
    resourceScoping: jsonb("resource_scoping").$type<Record<string, string[]>>().default({}).notNull(),

    // Status
    isActive: boolean("is_active").default(true).notNull(),

    // Expiration
    expiresAt: timestamp("expires_at"),              // null = never expires

    // Audit
    lastUsedAt: timestamp("last_used_at"),
    lastUsedIp: text("last_used_ip"),
    usageCount: integer("usage_count").default(0).notNull(),

    // Metadata
    description: text("description"),
    metadata: jsonb("metadata").$type<Record<string, any>>(), // runnerScope?: "local" for Persistent Local Runner

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    userIdx: index("mcp_token_user_idx").on(table.userId),
    orgIdx: index("mcp_token_org_idx").on(table.organizationId),
    tokenHashIdx: uniqueIndex("mcp_token_hash_unique").on(table.tokenHash),
    prefixIdx: index("mcp_token_prefix_idx").on(table.tokenPrefix),
    activeIdx: index("mcp_token_active_idx").on(table.isActive),
}));

export type McpApiToken = typeof mcpApiTokens.$inferSelect;
export type InsertMcpApiToken = typeof mcpApiTokens.$inferInsert;

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

/** Runner scope for MCP tokens: "local" = Persistent Local Runner (mission-heavy tasks execute on user machine) */
export const mcpRunnerScopes = ["local"] as const;
export type McpRunnerScope = (typeof mcpRunnerScopes)[number];

export const createMcpApiTokenSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    permissions: z.array(z.enum(mcpPermissions)).default([]),
    resourceScoping: z.record(z.array(z.string())).default({}),
    expiresAt: z.string().datetime().optional().nullable(),
    /** runnerScope: "local" for Persistent Local Runner tokens */
    metadata: z.object({ runnerScope: z.enum(mcpRunnerScopes).optional() }).optional(),
});

export const updateMcpApiTokenSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    permissions: z.array(z.enum(mcpPermissions)).optional(),
    resourceScoping: z.record(z.array(z.string())).optional(),
    isActive: z.boolean().optional(),
    expiresAt: z.string().datetime().optional().nullable(),
    metadata: z.object({ runnerScope: z.enum(mcpRunnerScopes).optional() }).optional(),
});

export type CreateMcpApiTokenInput = z.infer<typeof createMcpApiTokenSchema>;
export type UpdateMcpApiTokenInput = z.infer<typeof updateMcpApiTokenSchema>;

// ============================================================================
// TOOL -> PERMISSION MAPPING
// ============================================================================

export const toolPermissionMap: Record<string, McpPermission[]> = {
    // Knowledge Graph tools
    "search_knowledge_graph": ["knowledge:read"],
    "get_entity_impact": ["knowledge:read"],
    "get_graph_statistics": ["knowledge:read"],
    "create_entity": ["knowledge:write"],
    "create_relationship": ["knowledge:write"],
    "suggest_schema": ["knowledge:write"],
    "search_videos": ["knowledge:read"],

    // Pipeline tools
    "list_pipelines": ["pipeline:read"],
    "get_pipeline_details": ["pipeline:read"],
    "run_pipeline": ["pipeline:execute"],
    "get_pipeline_execution_status": ["pipeline:read"],
    "list_recent_executions": ["pipeline:read"],
    "create_pipeline": ["pipeline:write"],
    "update_pipeline": ["pipeline:write"],
    "delete_pipeline": ["pipeline:write"],
    "add_pipeline_step": ["pipeline:write"],
    "update_pipeline_step": ["pipeline:write"],
    "delete_pipeline_step": ["pipeline:write"],

    // Job tools
    "list_jobs": ["job:read"],
    "get_job_details": ["job:read"],
    "create_job": ["job:write"],
    "update_job": ["job:write"],
    "delete_job": ["job:write"],

    // Document tools
    "search_documents": ["document:read"],
    "list_documents": ["document:read"],
    "get_document_content": ["document:read"],

    // Dataset tools
    "list_datasets": ["dataset:read"],
    "get_dataset_details": ["dataset:read"],
    "query_dataset": ["dataset:read"],
    "create_dataset": ["dataset:write"],
    "add_dataset_items": ["dataset:write"],

    // Schedule tools
    "list_schedules": ["schedule:read"],
    "get_schedule_details": ["schedule:read"],
    "create_schedule": ["schedule:write"],
    "update_schedule": ["schedule:write"],
    "delete_schedule": ["schedule:write"],
    "list_scheduled_jobs": ["schedule:read"],
    "get_scheduled_job_details": ["schedule:read"],
    "get_upcoming_scheduled_runs": ["schedule:read"],
    "create_scheduled_job": ["schedule:write"],
    "update_scheduled_job": ["schedule:write"],
    "delete_scheduled_job": ["schedule:write"],

    // Template tools
    "list_templates": ["template:read"],
    "get_template_details": ["template:read"],

    // SaaS tools
    "list_saas_connectors": ["saas:read"],
    "sync_saas_connector": ["saas:write"],
    "get_saas_connector_schema": ["saas:read"],
    "update_saas_sync_config": ["saas:write"],
    "add_jira_comment": ["saas:write"],
    "transition_jira_issue": ["saas:write"],
    "update_jira_issue": ["saas:write"],

    // Maturity & Evolution tools
    "prune_knowledge": ["knowledge:evolution"],
    "detect_knowledge_gaps": ["knowledge:evolution"],
};

/**
 * Check if a set of permissions allows access to a specific tool
 */
export function hasToolPermission(userPermissions: McpPermission[], toolName: string): boolean {
    // Admin bypass
    if (userPermissions.includes("admin:full")) {
        return true;
    }

    const requiredPermissions = toolPermissionMap[toolName];

    // If tool not in map, deny by default (secure by default)
    if (!requiredPermissions) {
        console.warn(`[MCP Auth] Unknown tool "${toolName}" - denying access`);
        return false;
    }

    // Check if user has at least one of the required permissions
    return requiredPermissions.some(perm => userPermissions.includes(perm));
}

/**
 * Check if a resource matches any of the given glob patterns
 */
export function isResourceAllowed(patterns: string[], resource: string): boolean {
    if (!patterns || patterns.length === 0) return true; // No restrictions = allowed

    return patterns.some(pattern => {
        // Handle exact ID matching (numeric)
        if (!isNaN(parseInt(resource, 10)) && !isNaN(parseInt(pattern, 10))) {
            return resource === pattern;
        }

        // Handle glob matching (* and **)
        // Escape regex specials (including *)
        let p = pattern.replace(/[.+*?^${}()|[\]\\]/g, '\\$&'); 
        
        // Convert escaped globs to regex
        // We need to handle ** first (greedy match including slashes)
        // then * (non-slash match)
        p = p.replace(/\\\*\\\*/g, '___DOUBLE_STAR___');
        p = p.replace(/\\\*/g, '___SINGLE_STAR___');
        
        p = p.replace(/___DOUBLE_STAR___/g, '.*');
        p = p.replace(/___SINGLE_STAR___/g, '[^/]*');
        
        const regex = new RegExp(`^${p}$`, 'i');
        return regex.test(resource);
    });
}

/**
 * Granular permission check: Tool + Resource scoping
 */
export function hasResourcePermission(
    userPermissions: McpPermission[],
    toolName: string,
    resource: string,
    resourceScoping?: Record<string, string[]>
): boolean {
    // 1. Basic tool permission check
    if (!hasToolPermission(userPermissions, toolName)) {
        return false;
    }

    // 2. Admin bypass
    if (userPermissions.includes("admin:full")) {
        return true;
    }

    // 3. Resource scoping check
    if (!resourceScoping) {
        return true; // No scoping defined = allowed if tool is allowed
    }

    // Check scoping for either the specific tool or the general permission
    const requiredPermissions = toolPermissionMap[toolName] || [];
    
    // Check if any rule exists for either the tool name or its required permissions
    const patterns = [
        ...(resourceScoping[toolName] || []),
        ...requiredPermissions.flatMap(perm => resourceScoping[perm] || [])
    ];

    if (patterns.length === 0) {
        return true; // No patterns for this resource type = allowed
    }

    return isResourceAllowed(patterns, resource);
}



