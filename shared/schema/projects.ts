import { sql } from "drizzle-orm";
import {
    pgTable,
    text,
    serial,
    integer,
    timestamp,
    decimal,
    jsonb,
    boolean,
    uniqueIndex,
    index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

import { orgs } from "./auth.js";

/**
 * PROJECT SPACES
 *
 * A durable, named scope between `orgs` (tenant) and `operational_cycles` (iteration).
 * A cycle closes; the effort it belonged to does not, so the durable identity —
 * objective, members, accumulated knowledge, produced apps — hangs here.
 *
 * Resources attach through ONE junction (`project_resources`) rather than a
 * `project_id` column on every table. That is the whole point: the schema already
 * carries 52 nullable mission_id/cycle_id columns across 36 files, and adding a 53rd
 * would be the pattern this is meant to stop. `operational_cycles` is the single
 * exception (§5.3) because cycle -> project is strict, always-present, and on the hot
 * path for budget rollup.
 *
 * See docs/PROJECT_SPACES_DESIGN.md.
 */

export const PROJECT_STATUSES = ["active", "paused", "archived"] as const;
export type ProjectStatus = typeof PROJECT_STATUSES[number];

export const PROJECT_VISIBILITIES = ["org", "private"] as const;
export type ProjectVisibility = typeof PROJECT_VISIBILITIES[number];

export const PROJECT_ROLES = ["owner", "editor", "operator", "viewer"] as const;
export type ProjectRole = typeof PROJECT_ROLES[number];

export const PROJECT_PRINCIPAL_TYPES = ["user", "agent"] as const;
export type ProjectPrincipalType = typeof PROJECT_PRINCIPAL_TYPES[number];

/**
 * Resource kinds attachable to a project. Adding a kind here costs nothing at the
 * schema level — that is the junction's payoff over a per-table column.
 */
export const PROJECT_RESOURCE_TYPES = [
    "cycle",
    "mission",
    "app",
    "dataset",
    "job_collection",
    "kb_document",
    // A CREW deliberation room. Its own project_id is the primary scope; junction
    // rows let a room be referenced from sibling projects without moving it.
    "crew_room",
    // A Form Studio form (an authored hil_forms template). In a private project it is
    // visible only to the project's members; see form-studio-access.ts.
    "form",
    // A workflow (pipeline draft + its releases/deployments). Ownership lives only
    // in this junction — workflows carries no project_id column of its own.
    "workflow",
] as const;
export type ProjectResourceType = typeof PROJECT_RESOURCE_TYPES[number];

/** A resource has exactly one `primary` project and may be `referenced` by others. */
export const PROJECT_RELATIONS = ["primary", "referenced"] as const;
export type ProjectRelation = typeof PROJECT_RELATIONS[number];

export const PROJECT_EVENT_KINDS = ["deadline", "milestone", "launch", "incident", "note"] as const;
export type ProjectEventKind = typeof PROJECT_EVENT_KINDS[number];

/** Deliberately the same ladder signals use, so authored and observed events sort together. */
export const PROJECT_EVENT_SEVERITIES = ["Low", "Medium", "High", "Critical"] as const;
export type ProjectEventSeverity = typeof PROJECT_EVENT_SEVERITIES[number];

export const projects = pgTable("projects", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
        .references(() => orgs.id, { onDelete: "cascade" })
        .notNull(),
    /** URL slug, unique per org, e.g. 'rescue-dispatch'. */
    key: text("key").notNull(),
    name: text("name").notNull(),
    objective: text("objective"),
    description: text("description"),
    status: text("status").notNull().default("active"),
    visibility: text("visibility").notNull().default("org"),
    ownerUserId: text("owner_user_id"),
    /** NULL = inherit org policy. The gate finance actually cares about. */
    budgetLimitUsd: decimal("budget_limit_usd", { precision: 12, scale: 2 }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    /** Exactly one per org; every unassigned resource lands here. */
    isDefault: boolean("is_default").notNull().default(false),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    archivedAt: timestamp("archived_at"),
}, (t) => [
    uniqueIndex("projects_org_key_unique").on(t.organizationId, t.key),
    uniqueIndex("projects_org_default_unique")
        .on(t.organizationId)
        .where(sql`is_default`),
    index("projects_org_status_idx").on(t.organizationId, t.status),
]);

/**
 * Project roles are ADDITIVE to org roles and never expand them — org admins keep
 * full access to every project regardless of membership. Agent principals get roles
 * too; that is the enforcement point for agent blast radius.
 */
export const projectMembers = pgTable("project_members", {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
        .references(() => projects.id, { onDelete: "cascade" })
        .notNull(),
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    role: text("role").notNull(),
    addedBy: text("added_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
    uniqueIndex("project_members_unique").on(t.projectId, t.principalType, t.principalId),
    index("project_members_principal_idx").on(t.principalType, t.principalId),
]);

/**
 * Finance roles a project owner gives a member for the project's QuickBooks
 * books (shared/finance-roles.ts holds what each role may do). A member holds
 * any number of them; their access is the union, and a member with none has no
 * QuickBooks access. Only user principals hold finance roles.
 */
export const projectFinanceRoles = pgTable("project_finance_roles", {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
        .references(() => projects.id, { onDelete: "cascade" })
        .notNull(),
    organizationId: integer("organization_id")
        .references(() => orgs.id, { onDelete: "cascade" })
        .notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    grantedBy: text("granted_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
    uniqueIndex("project_finance_roles_unique").on(t.projectId, t.userId, t.role),
    index("project_finance_roles_user_idx").on(t.organizationId, t.userId),
]);

export type ProjectFinanceRoleRow = typeof projectFinanceRoles.$inferSelect;

/**
 * The containment junction. `project_resources_primary_unique` is what enforces
 * "one home per resource" while still allowing a dataset to be *referenced* by
 * several projects.
 */
/**
 * Dated things a person puts on a project's timeline: a deadline, a milestone,
 * a launch, a known incident, a note about something happening outside the
 * system.
 *
 * This is the half of a project's timeline the platform cannot derive. Signals,
 * predictions and surprises are observed and arrive on their own; a regulatory
 * deadline or a customer commitment only exists because somebody said so. Both
 * halves belong on the same timeline, which is why these are shaped to sit
 * beside a signal rather than in a separate feature.
 *
 * Written to be referenceable: registered in the ontology so an agent can ask
 * about one by id, and drawn on for chat primers so a cold room in this project
 * opens already knowing what is coming up.
 */
export const projectEvents = pgTable("project_events", {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
        .notNull()
        .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    /** deadline | milestone | launch | incident | note */
    kind: text("kind").notNull().default("milestone"),
    /** Low | Medium | High | Critical — matches signal severity so the two sort together. */
    severity: text("severity").notNull().default("Medium"),
    /** When it happens. Point-in-time unless endsAt is set. */
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at"),
    /**
     * Standard 5-field cron, or null for a one-off.
     *
     * Occurrences are NOT stored. A weekly review for a year is one row and 52
     * derived dates; materialising them would mean a row explosion, an
     * unbounded horizon to pick, and a backfill every time the rule is edited.
     * The read path expands within the window being viewed instead, which is
     * how the scheduler already treats cycles.
     */
    recurrence: text("recurrence"),
    /** IANA zone the recurrence is evaluated in. "Every Monday 09:00" is local. */
    recurrenceTimezone: text("recurrence_timezone").notNull().default("UTC"),
    /** Optional stop date; null recurs indefinitely. */
    recurrenceUntil: timestamp("recurrence_until"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    // The timeline read: one project, ordered by when things happen.
    projectStartsAtIdx: index("project_events_project_starts_at_idx").on(table.projectId, table.startsAt),
    orgIdx: index("project_events_org_idx").on(table.organizationId),
    orgCreatedIdx: index("project_events_org_created_idx").on(table.organizationId, table.createdAt),
}));

export const projectResources = pgTable("project_resources", {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
        .references(() => projects.id, { onDelete: "cascade" })
        .notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: integer("resource_id").notNull(),
    relation: text("relation").notNull().default("primary"),
    addedBy: text("added_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
    uniqueIndex("project_resources_unique").on(t.projectId, t.resourceType, t.resourceId),
    uniqueIndex("project_resources_primary_unique")
        .on(t.resourceType, t.resourceId)
        .where(sql`relation = 'primary'`),
    index("project_resources_lookup").on(t.resourceType, t.resourceId),
    index("project_resources_by_project").on(t.projectId, t.resourceType),
]);

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;
export type ProjectMember = typeof projectMembers.$inferSelect;
export type InsertProjectMember = typeof projectMembers.$inferInsert;
export type ProjectResource = typeof projectResources.$inferSelect;
export type InsertProjectResource = typeof projectResources.$inferInsert;

/**
 * A project key is a URL slug and is also DNS-safe, so a project can name a
 * workspace/subdomain later without a second identifier.
 */
export const projectKeySchema = z
    .string()
    .min(2, "Project key must be at least 2 characters")
    .max(64)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Project key must be lowercase alphanumeric with single hyphens");

export const insertProjectSchema = createInsertSchema(projects, {
    key: projectKeySchema,
    name: z.string().min(1, "Project name is required").max(200),
    objective: z.string().max(2000).optional().nullable(),
    description: z.string().max(4000).optional().nullable(),
    status: z.enum(PROJECT_STATUSES).optional().default("active"),
    visibility: z.enum(PROJECT_VISIBILITIES).optional().default("org"),
    // Accept a JSON number but hand Drizzle the string its NUMERIC column expects.
    budgetLimitUsd: z
        .union([z.string(), z.number()])
        .transform((v) => String(v))
        .optional()
        .nullable(),
    metadata: z.record(z.any()).optional().default({}),
}).omit({ id: true, createdAt: true, updatedAt: true, archivedAt: true });

/**
 * Create payload. `key` is optional because the server derives it from the name and
 * de-duplicates it against the (org, key) unique index; a client-supplied key is
 * honoured but still normalised.
 */
export const createProjectSchema = insertProjectSchema
    .omit({ organizationId: true, createdBy: true, isDefault: true })
    .partial({ key: true });

export const updateProjectSchema = insertProjectSchema
    .partial()
    .omit({ organizationId: true, createdBy: true, isDefault: true });

export const insertProjectMemberSchema = createInsertSchema(projectMembers, {
    principalType: z.enum(PROJECT_PRINCIPAL_TYPES),
    principalId: z.string().min(1).max(200),
    role: z.enum(PROJECT_ROLES),
}).omit({ id: true, createdAt: true });

export const insertProjectResourceSchema = createInsertSchema(projectResources, {
    resourceType: z.enum(PROJECT_RESOURCE_TYPES),
    resourceId: z.number().int().positive(),
    relation: z.enum(PROJECT_RELATIONS).optional().default("primary"),
}).omit({ id: true, createdAt: true });

export type InsertProjectInput = z.infer<typeof insertProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type InsertProjectMemberInput = z.infer<typeof insertProjectMemberSchema>;
export type InsertProjectResourceInput = z.infer<typeof insertProjectResourceSchema>;

/**
 * Derive a project key from a free-text name. The result is always accepted by
 * `projectKeySchema` — callers derive keys without re-validating, so a name that
 * slugifies to something too short falls back rather than producing an invalid key.
 */
export function slugifyProjectKey(name: string): string {
    const slug = name
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64)
        .replace(/-+$/g, "");
    return slug.length >= 2 ? slug : "project";
}
