
import { pgTable, text, serial, timestamp, decimal, integer, boolean, jsonb, index } from "drizzle-orm/pg-core";
import { orgs } from './auth.js';
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const governorConsensusCache = pgTable("governor_consensus_cache", {
    id: serial("id").primaryKey(),
    commandHash: text("command_hash").notNull(),
    contextHash: text("context_hash").notNull(),
    consensusScore: decimal("consensus_score", { precision: 5, scale: 3 }),
    outcome: text("outcome").notNull(), // 'APPROVED' | 'REJECTED'
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ============================================================================
// GOVERNANCE POLICIES
// ============================================================================

export const governorPolicies = pgTable("governor_policies", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    organizationId: integer("organization_id").references(() => orgs.id),
    type: text("type").notNull().default("custom"), // 'global', 'system', 'custom'
    isActive: boolean("is_active").default(true).notNull(),
    createdBy: text("created_by").notNull().default("system"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    index("idx_governor_policies_org_id").on(table.organizationId),
    index("idx_governor_policies_is_active").on(table.isActive),
]);

export const governorPolicyRules = pgTable("governor_policy_rules", {
    id: serial("id").primaryKey(),
    policyId: integer("policy_id")
        .references(() => governorPolicies.id, { onDelete: "cascade" })
        .notNull(),
    type: text("type").notNull(), // 'tool_allow', 'tool_deny', 'pii_redaction', 'budget_limit', 'require_approval', 'auto_approve'
    configuration: jsonb("configuration").notNull(), // { tools: ["sql_query"] } or { regex: "..." }
    isEnabled: boolean("is_enabled").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
    index("idx_governor_policy_rules_policy_id").on(table.policyId),
]);

export const agentSalaries = pgTable("agent_salaries", {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id").notNull(), // Links to assistants table
    sessionId: text("session_id").notNull(),
    organizationId: integer("organization_id").references(() => orgs.id),
    budgetTokens: integer("budget_tokens").notNull().default(100000), // Default 100k tokens
    currentSpendTokens: integer("current_spend_tokens").notNull().default(0),
    currency: text("currency").default("USD").notNull(),
    lastUpdated: timestamp("last_updated").defaultNow().notNull(),
    status: text("status").default("active").notNull(), // 'active', 'exhausted', 'frozen'
});

export const insertGovernorPolicySchema = createInsertSchema(governorPolicies, {
    name: z.string().min(1),
}).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export const insertGovernorPolicyRuleSchema = createInsertSchema(governorPolicyRules, {
    type: z.enum(['tool_allow', 'tool_deny', 'pii_redaction', 'budget_limit', 'require_approval', 'auto_approve', 'mcp_server_allow', 'mcp_server_deny', 'mcp_tool_allow', 'mcp_tool_deny']),
    configuration: z.union([
        z.object({ tools: z.array(z.string()) }), // tool_allow, tool_deny
        z.object({ servers: z.array(z.string()) }), // mcp_server_allow, mcp_server_deny
        z.object({ serverName: z.string(), tools: z.array(z.string()) }), // mcp_tool_allow, mcp_tool_deny
        z.object({ patterns: z.array(z.object({ name: z.string(), regex: z.string() })) }), // pii_redaction
        z.object({
            maxCostUSD: z.number().positive(),
            scope: z.enum(['mission', 'organization', 'daily_total']).default('mission')
        }), // budget_limit
        z.object({
            tools: z.array(z.string()),
            maxCostUSD: z.number().optional(),
            allowedTypes: z.array(z.string()).optional() // e.g., ["input_request"]
        }), // auto_approve
        z.any()
    ]),
}).omit({
    id: true,
    createdAt: true,
});

export type GovernorPolicy = typeof governorPolicies.$inferSelect;
export type GovernorPolicyRule = typeof governorPolicyRules.$inferSelect;



