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
    json,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

// ============================================================================
// ALERTS (Foundational Enums)
// ============================================================================

export const alertSeverities = [
    "info",
    "warn",
    "warning",
    "error",
    "critical",
] as const;
export type AlertSeverity = (typeof alertSeverities)[number];

// ============================================================================
// SUPPRESSION POLICIES
// ============================================================================

export const suppressionPolicies = pgTable("suppression_policies", {
    id: serial("policy_id").primaryKey(),
    name: varchar("name", { length: 120 }).notNull().unique(),
    enableQuietHours: boolean("enable_quiet_hours").default(true).notNull(),
    enableSeverityBypass: boolean("enable_severity_bypass")
        .default(false)
        .notNull(),
    quietHoursBypassSeverities: text("quiet_hours_bypass_severities")
        .array()
        .default(sql`ARRAY[]::text[]`)
        .notNull(),
    enableUserFilters: boolean("enable_user_filters").default(true).notNull(),
    suppressNeverNotify: boolean("suppress_never_notify").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSuppressionPolicySchema = createInsertSchema(
    suppressionPolicies,
    {
        name: z.string().min(1, "Policy name is required").max(120),
        quietHoursBypassSeverities: z.array(z.enum(alertSeverities)).optional(),
    },
);

export type InsertSuppressionPolicy = z.infer<
    typeof insertSuppressionPolicySchema
>;
export type SuppressionPolicy = typeof suppressionPolicies.$inferSelect;

// ============================================================================
// ORGANIZATIONS
// ============================================================================

export const orgs = pgTable("orgs", {
    id: serial("org_id").primaryKey(),
    name: varchar("name", { length: 120 }).notNull().unique(),
    suppressionPolicyId: integer("suppression_policy_id").references(
        () => suppressionPolicies.id,
    ),
    // Stripe & Billing (Phase 6)
    /**
     * IANA timezone for the organization (e.g. "America/Los_Angeles").
     *
     * Drives locale-sensitive defaults such as the opening centre of the H3
     * spatial map. Deliberately NULLABLE rather than defaulting to "UTC":
     * "not configured" and "configured as UTC" are different facts, and only
     * the former should fall through to the viewer's browser timezone.
     */
    timezone: text("timezone"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    subscriptionStatus: text("subscription_status"), // 'active', 'canceled', 'past_due', etc.
    subscriptionPlan: text("subscription_plan"), // 'pro', 'enterprise', etc.
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    stripeCustIdx: index("orgs_stripe_cust_idx").on(table.stripeCustomerId),
    subStatusIdx: index("orgs_sub_status_idx").on(table.subscriptionStatus),
}));

export const insertOrgSchema = createInsertSchema(orgs, {
    name: z.string().min(1, "Organization name is required").max(120),
});

export type InsertOrg = z.infer<typeof insertOrgSchema>;
export type Org = typeof orgs.$inferSelect;

// ============================================================================
// ORGANIZATION SETTINGS
// ============================================================================

export const orgSettings = pgTable("org_settings", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" })
        .unique(),
    knowledgeStoreEnabled: boolean("knowledge_store_enabled").default(true).notNull(),
    knowledgeGraphEnabled: boolean("knowledge_graph_enabled").default(true).notNull(),
    psychologistEnabled: boolean("psychologist_enabled").default(true).notNull(),
    skillImportEnabled: boolean("skill_import_enabled").default(false).notNull(),
    mcpHttpEnabled: boolean("mcp_http_enabled").default(false).notNull(),  // MCP HTTP API access (default OFF)
    autoresearchEnabled: boolean("autoresearch_enabled").default(true).notNull(),
    trustgraphEnabled: boolean("trustgraph_enabled").default(true).notNull(),
    assistantSoulTraits: jsonb("assistant_soul_traits").default(sql`'{}'::jsonb`),
    assistantSoulArchetype: text("assistant_soul_archetype"),
    allowedAgentTools: text("allowed_agent_tools").array(),
    allowedJobTypes: text("allowed_job_types").array(),
    embedOAuthConfig: jsonb("embed_oauth_config").default(sql`'{}'::jsonb`), // { clientId, clientSecretRef, authUrl, tokenUrl, scopes, redirectUri }
    profileApiDomainAllowlist: text("profile_api_domain_allowlist").array(), // e.g. ["https://api.customer.com", "*.customer.com"]
    missionConcurrency: integer("mission_concurrency").default(1).notNull(), // Maximum parallel mission runs
    enterpriseRbacEnforced: boolean("enterprise_rbac_enforced").default(false).notNull(),

    // Financial Guardrails (Phase 1)
    monthlyBudgetUsd: decimal("monthly_budget_usd", { precision: 10, scale: 2 }).default("100.00"),
    currentMonthSpendUsd: decimal("current_month_spend_usd", { precision: 10, scale: 2 }).default("0.00"),
    budgetResetDay: integer("budget_reset_day").default(1).notNull(), // Day of month to reset spend
    lastBudgetResetAt: timestamp("last_budget_reset_at"),
    lastAlertThreshold: integer("last_alert_threshold").default(0), // 80 or 100
    lastAlertAt: timestamp("last_alert_at"),

    // Trycua Integration
    trycuaEnabled: boolean("trycua_enabled").default(false).notNull(),
    trycuaDefaultOs: text("trycua_default_os").default("linux").notNull(),
    trycuaMaxSessionTime: integer("trycua_max_session_time").default(60).notNull(),

    // Hardware-Aware Deployment Profile (Phase 4.5)
    // laptop | workstation | server | cluster
    // Controls parallelism, context-length caps, and local-model availability
    deploymentProfile: text("deployment_profile").default("laptop").notNull(),
    deploymentProfileOverrides: jsonb("deployment_profile_overrides").default(sql`'{}'::jsonb`),

    createdAt: timestamp("created_at").defaultNow().notNull(),

    datasetsEnabled: boolean("datasets_enabled").default(true).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const DEPLOYMENT_PROFILE_VALUES = ['laptop', 'workstation', 'server', 'cluster'] as const;
export type DeploymentProfile = typeof DEPLOYMENT_PROFILE_VALUES[number];

export const orgSettingsSchema = z.object({
    knowledgeStoreEnabled: z.boolean().default(true),
    knowledgeGraphEnabled: z.boolean().default(true),
    psychologistEnabled: z.boolean().default(true),
    skillImportEnabled: z.boolean().default(false),
    mcpHttpEnabled: z.boolean().default(false),
    autoresearchEnabled: z.boolean().default(true),
    trustgraphEnabled: z.boolean().default(true),
    assistantSoulTraits: z.record(z.string(), z.any()).optional(),
    assistantSoulArchetype: z.string().optional(),
    allowedAgentTools: z.array(z.string()).optional(),
    allowedJobTypes: z.array(z.string()).optional(),
    missionConcurrency: z.number().int().min(1).max(20).default(1),
    enterpriseRbacEnforced: z.boolean().default(false),
    monthlyBudgetUsd: z.coerce.number().min(0).default(100),
    currentMonthSpendUsd: z.coerce.number().min(0).default(0),
    budgetResetDay: z.number().int().min(1).max(31).default(1),
    lastBudgetResetAt: z.coerce.date().optional().nullable(),
    datasetsEnabled: z.boolean().default(true),
    trycuaEnabled: z.boolean().default(false),
    trycuaDefaultOs: z.enum(["linux", "windows", "macos"]).default("linux"),
    trycuaMaxSessionTime: z.number().int().min(1).max(1440).default(60),
    deploymentProfile: z.enum(DEPLOYMENT_PROFILE_VALUES).default('laptop'),
    deploymentProfileOverrides: z.record(z.any()).optional(),
});



export type OrgSettings = typeof orgSettings.$inferSelect;
export type InsertOrgSettings = typeof orgSettings.$inferInsert;


// ============================================================================
// USERS
// ============================================================================

export const users = pgTable("users", {
    id: text("id")
        .primaryKey()
        .default(sql`gen_random_uuid()`),
    username: text("username").notNull().unique(),
    password: text("password").notNull(),
    // Personal information
    email: text("email"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    // Organization
    defaultOrgId: integer("default_org_id"),
    // Quiet hours settings
    quietHoursEnabled: boolean("quiet_hours_enabled"),
    quietHoursStart: text("quiet_hours_start"), // Format: "HH:MM" (24-hour)
    quietHoursEnd: text("quiet_hours_end"), // Format: "HH:MM" (24-hour)
    quietHoursTimezone: text("quiet_hours_timezone"), // IANA timezone (e.g., "America/New_York")
    // Alert preferences
    alertFilters: jsonb("alert_filters"), // Custom alert suppression rules
    // Slack integration
    slackHandle: text("slack_handle"), // Slack username for user recognition
    // Security PIN (salted hash)
    pin: text("pin"),
    // CCPA/Legal Compliance
    privacyPolicyAccepted: boolean("privacy_policy_accepted").default(false).notNull(),
    privacyPolicyVersion: text("privacy_policy_version"),
    tosAccepted: boolean("tos_accepted").default(false).notNull(),
    tosVersion: text("tos_version"),
    legalAcceptedAt: timestamp("legal_accepted_at"),
});

export const insertUserSchema = createInsertSchema(users, {
    username: z.string().min(3, "Username must be at least 3 characters"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    pin: z.string().regex(/^\d{6,}$/, "PIN must be at least 6 numeric digits").optional().nullable(),
    email: z.string().email("Invalid email address").optional().nullable(),
    firstName: z.string().optional().nullable(),
    lastName: z.string().optional().nullable(),
    defaultOrgId: z.number().optional().nullable(),
    quietHoursEnabled: z.boolean().optional(),
    quietHoursStart: z
        .string()
        .regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/)
        .optional()
        .nullable(),
    quietHoursEnd: z
        .string()
        .regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/)
        .optional()
        .nullable(),
    quietHoursTimezone: z.string().optional().nullable(),
    alertFilters: z.record(z.string(), z.any()).optional().nullable(),
    slackHandle: z.string().optional().nullable(),
    // CCPA/Legal Compliance
    privacyPolicyAccepted: z.boolean().default(false),
    privacyPolicyVersion: z.string().optional().nullable(),
    tosAccepted: z.boolean().default(false),
    tosVersion: z.string().optional().nullable(),
    legalAcceptedAt: z.coerce.date().optional().nullable(),
});

export const updateUserSchema = insertUserSchema
    .partial()
    .omit({ password: true });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
export type User = typeof users.$inferSelect;

// ============================================================================
// USER_ORGS TABLE (Many-to-Many Junction)
// ============================================================================

export const userOrgs = pgTable(
    "user_orgs",
    {
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        orgId: integer("org_id")
            .notNull()
            .references(() => orgs.id, { onDelete: "cascade" }),
    },
    (table) => {
        return {
            pk: primaryKey({ columns: [table.userId, table.orgId] }),
        };
    },
);

export const insertUserOrgSchema = createInsertSchema(userOrgs);
export type InsertUserOrg = z.infer<typeof insertUserOrgSchema>;
export type UserOrg = typeof userOrgs.$inferSelect;

// ============================================================================
// ORGANIZATION OPERATIONAL ROLES
// ============================================================================

export const organizationRoleTypes = ["operator", "approver", "auditor", "administrator"] as const;
export type OrganizationRoleType = (typeof organizationRoleTypes)[number];

export const organizationRoleAssignments = pgTable(
    "organization_role_assignments",
    {
        id: serial("id").primaryKey(),
        organizationId: integer("organization_id")
            .notNull()
            .references(() => orgs.id, { onDelete: "cascade" }),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        role: text("role").notNull(),
        createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => ({
        assignmentUnique: uniqueIndex("organization_role_assignments_unique").on(
            table.organizationId,
            table.userId,
            table.role,
        ),
        orgUserIdx: index("organization_role_assignments_org_user_idx").on(
            table.organizationId,
            table.userId,
        ),
    }),
);

export const insertOrganizationRoleAssignmentSchema = createInsertSchema(organizationRoleAssignments, {
    role: z.enum(organizationRoleTypes),
});
export type InsertOrganizationRoleAssignment = z.infer<typeof insertOrganizationRoleAssignmentSchema>;
export type OrganizationRoleAssignment = typeof organizationRoleAssignments.$inferSelect;

// ============================================================================
// ADMIN ROLES TABLE
// ============================================================================

export const adminRoleTypes = ["super_admin", "org_admin"] as const;
export type AdminRoleType = (typeof adminRoleTypes)[number];

export const adminRoles = pgTable(
    "admin_roles",
    {
        id: serial("id").primaryKey(),
        userId: varchar("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        role: text("role").notNull(), // 'super_admin' | 'org_admin'
        organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }), // null for super_admin
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => ({
        // Ensure one role per user (user can be either super_admin OR org_admin, not both)
        userRoleUnique: uniqueIndex("admin_roles_user_unique").on(table.userId),
    })
);

export const insertAdminRoleSchema = createInsertSchema(adminRoles, {
    role: z.enum(adminRoleTypes),
});

export type InsertAdminRole = z.infer<typeof insertAdminRoleSchema>;
export type AdminRole = typeof adminRoles.$inferSelect;
// ============================================================================
// PASSWORD RESET TOKENS
// ============================================================================

export const passwordResetTokens = pgTable("password_reset_tokens", {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(), // Store hashed token for security
    expiresAt: timestamp("expires_at").notNull(),
    used: boolean("used").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    tokenIdx: index("token_hash_idx").on(table.tokenHash),
    userIdIdx: index("user_id_idx").on(table.userId),
}));

export const insertPasswordResetTokenSchema = createInsertSchema(passwordResetTokens);
export type InsertPasswordResetToken = z.infer<typeof insertPasswordResetTokenSchema>;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

// ============================================================================
// ORGANIZATION INVITES
// ============================================================================

export const organizationInvites = pgTable(
    "organization_invites",
    {
        id: serial("id").primaryKey(),
        organizationId: integer("organization_id")
            .notNull()
            .references(() => orgs.id, { onDelete: "cascade" }),
        email: text("email"),
        role: text("role").notNull(),
        tokenHash: text("token_hash").notNull().unique(),
        invitedBy: text("invited_by")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        usedAt: timestamp("used_at"),
        usedBy: text("used_by").references(() => users.id, { onDelete: "set null" }),
        expiresAt: timestamp("expires_at").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => ({
        tokenIdx: index("organization_invites_token_hash_idx").on(table.tokenHash),
        orgIdx: index("organization_invites_org_idx").on(table.organizationId),
    }),
);

export const insertOrganizationInviteSchema = createInsertSchema(organizationInvites, {
    role: z.enum(organizationRoleTypes),
    email: z.string().email().optional().nullable(),
});
export type InsertOrganizationInvite = z.infer<typeof insertOrganizationInviteSchema>;
export type OrganizationInvite = typeof organizationInvites.$inferSelect;

// ============================================================================
// PIN RESET TOKENS
// ============================================================================

export const pinResetTokens = pgTable("pin_reset_tokens", {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    used: boolean("used").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
    pinTokenIdx: index("pin_token_hash_idx").on(table.tokenHash),
    pinUserIdIdx: index("pin_user_id_idx").on(table.userId),
}));

export const insertPinResetTokenSchema = createInsertSchema(pinResetTokens);
export type InsertPinResetToken = z.infer<typeof insertPinResetTokenSchema>;
export type PinResetToken = typeof pinResetTokens.$inferSelect;

// ============================================================================
// EXPRESS SESSION (connect-pg-simple)
// ============================================================================

export const session = pgTable("session", {
    sid: varchar("sid").primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { precision: 6 }).notNull(),
});



