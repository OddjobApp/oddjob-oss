import { sql } from "drizzle-orm";
import { z } from "zod";
import {
    pgTable,
    text,
    serial,
    timestamp,
    integer,
    jsonb,
    uniqueIndex,
    index,
    boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

import { orgs } from "../auth.js";
import { missionRuns } from "../missions/index.js";

/**
 * AIP-style Ontology (business Object Types + typed Actions).
 *
 * Distinct from the knowledge graph (knowledgeNodes/Edges/graphSchemaDefs), which
 * models *extracted* facts. This layer models *curated* business objects the assistant
 * can query and act on. Every table is org-scoped exactly like graphSchemaDefs:
 * organization_id -> orgs.id (cascade), org indexes, uniqueIndex(org, name).
 *
 * See docs/specs/ONTOLOGY_SERVICE_DESIGN.md.
 */

// Object Type = a business entity definition (AIP "Object Type").
export const ontologyObjectTypes = pgTable("ontology_object_types", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
        .references(() => orgs.id, { onDelete: "cascade" })
        .notNull(),
    name: text("name").notNull(), // e.g. "TaskTicket", "Mission"
    description: text("description"),
    // JSON-Schema-ish property map: { title: {type:"string"}, status:{type:"string"} }
    propertiesSchema: jsonb("properties_schema").notNull().default(sql`'{}'::jsonb`),
    titleProperty: text("title_property"), // which property is the display title
    icon: text("icon"),
    // Backing strategy: "materialized" (rows in ontology_objects) | "virtual" (adapter)
    backing: text("backing").notNull().default("materialized"),
    sourceAdapter: text("source_adapter"), // for "virtual": registered adapter key
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
    uniqueIndex("ontology_object_type_org_name_unique").on(t.organizationId, t.name),
    index("ontology_object_type_org_idx").on(t.organizationId),
]);

// Object instance (only for backing = "materialized").
export const ontologyObjects = pgTable("ontology_objects", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
        .references(() => orgs.id, { onDelete: "cascade" })
        .notNull(),
    objectTypeId: integer("object_type_id")
        .references(() => ontologyObjectTypes.id, { onDelete: "cascade" })
        .notNull(),
    externalId: text("external_id"), // caller-facing id; unique per (org, type)
    properties: jsonb("properties").notNull().default(sql`'{}'::jsonb`),
    kgNodeId: integer("kg_node_id"), // optional bridge to knowledge_nodes.id
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
    uniqueIndex("ontology_object_org_type_extid_unique")
        .on(t.organizationId, t.objectTypeId, t.externalId)
        .where(sql`external_id IS NOT NULL`),
    index("ontology_object_org_type_idx").on(t.organizationId, t.objectTypeId),
]);

// Action = a typed, governed operation.
export const ontologyActions = pgTable("ontology_actions", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
        .references(() => orgs.id, { onDelete: "cascade" })
        .notNull(),
    name: text("name").notNull(), // e.g. "assign_technician"
    description: text("description"),
    objectTypeId: integer("object_type_id")
        .references(() => ontologyObjectTypes.id, { onDelete: "cascade" }),
    parametersSchema: jsonb("parameters_schema").notNull().default(sql`'{}'::jsonb`),
    effect: text("effect").notNull().default("read"), // "read" | "write"
    handlerKind: text("handler_kind").notNull(), // "builtin" | "pipeline" | "tool" | "sql"
    handlerRef: text("handler_ref").notNull(),
    requiresApproval: boolean("requires_approval").notNull().default(true),
    riskLevel: text("risk_level").notNull().default("medium"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
    uniqueIndex("ontology_action_org_name_unique").on(t.organizationId, t.name),
    index("ontology_action_org_idx").on(t.organizationId),
]);

// Audit log for every executed Action.
export const ontologyActionLog = pgTable("ontology_action_log", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
        .references(() => orgs.id, { onDelete: "cascade" })
        .notNull(),
    actionId: integer("action_id")
        .references(() => ontologyActions.id, { onDelete: "set null" }),
    actorUserId: text("actor_user_id"),
    params: jsonb("params"),
    approvalId: integer("approval_id"), // decision-router request id, when gated
    missionRunId: integer("mission_run_id")
        .references(() => missionRuns.id, { onDelete: "set null" }),
    status: text("status").notNull(), // "executed" | "denied" | "failed"
    result: jsonb("result"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
    index("ontology_action_log_org_idx").on(t.organizationId),
    index("ontology_action_log_run_idx").on(t.missionRunId),
]);

/**
 * Link Type = a declared, named, typed relationship between two Object Types
 * (AIP "Link Type"). This is what turns a set of Object Types into a graph the
 * assistant can traverse: `Mission --produces--> Alert`, read from the other end
 * as `Alert --raised_by--> Mission`.
 *
 * `backing` mirrors the Object Type split, for the same reason:
 *
 * - "derived"      — the relationship ALREADY exists as a foreign key on the
 *                    source's underlying table, and the adapters already project
 *                    it into their property maps (app_deployments.appId,
 *                    apps.projectId, swarm_tasks.missionId, ...). The link is a
 *                    declaration over those properties, resolved at query time.
 *                    Nothing is stored, so it can never go stale.
 * - "materialized" — an edge with no underlying foreign key, stored as rows in
 *                    ontology_links. Only valid between materialized Object
 *                    Types, and written through a governed action.
 *
 * Every default Object Type is currently `virtual`, so every seeded link is
 * `derived`; ontology_links exists for org-defined objects that have no source
 * table to derive from.
 */
export const ontologyLinkTypes = pgTable("ontology_link_types", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
        .references(() => orgs.id, { onDelete: "cascade" })
        .notNull(),
    // Forward name, read source -> target: "produces".
    name: text("name").notNull(),
    // Reverse name, read target -> source: "raised_by". NOT NULL on purpose — an
    // unnamed reverse direction is what makes an ontology unnavigable from the
    // other end, which is most of the value of declaring the link at all.
    inverseName: text("inverse_name").notNull(),
    description: text("description"),
    sourceTypeId: integer("source_type_id")
        .references(() => ontologyObjectTypes.id, { onDelete: "cascade" })
        .notNull(),
    // NULL => polymorphic: the concrete target type is named by a property on the
    // source row (see targetTypeProperty), as with Project Resource.
    targetTypeId: integer("target_type_id")
        .references(() => ontologyObjectTypes.id, { onDelete: "cascade" }),
    cardinality: text("cardinality").notNull().default("one_to_many"), // one_to_one | one_to_many | many_to_many
    backing: text("backing").notNull().default("derived"), // derived | materialized | path
    // --- backing = "path" only ---
    // Ordered link NAMES to follow, e.g. ["has_resource", "resource_of"] to reach a
    // project's missions through the project_resources junction. Names, not ids, so
    // the declaration reads as a sentence and survives a hop being redeclared.
    path: jsonb("path").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    // --- backing = "derived" only ---
    // Property on the SOURCE object carrying the join key (e.g. "appId").
    sourceProperty: text("source_property"),
    // Property on the TARGET object it matches (almost always "id").
    targetProperty: text("target_property").default("id"),
    // --- polymorphic derived links only ---
    // Property on the source naming the target's type (e.g. "resourceType")...
    targetTypeProperty: text("target_type_property"),
    // ...and how those raw values map to Object Type names:
    // { "mission": "Mission", "app": "App" }
    targetTypeMap: jsonb("target_type_map").notNull().default(sql`'{}'::jsonb`),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
    // Scoped by source type, not org-wide: "owns" may legitimately mean different
    // things from Project and from App, and both are useful names to keep.
    uniqueIndex("ontology_link_type_org_source_name_unique")
        .on(t.organizationId, t.sourceTypeId, t.name),
    index("ontology_link_type_org_idx").on(t.organizationId),
    index("ontology_link_type_source_idx").on(t.sourceTypeId),
    index("ontology_link_type_target_idx").on(t.targetTypeId),
]);

/**
 * A stored edge, for `backing = "materialized"` link types only. Derived links
 * never write here — their edges live in the source table's foreign key.
 */
export const ontologyLinks = pgTable("ontology_links", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
        .references(() => orgs.id, { onDelete: "cascade" })
        .notNull(),
    linkTypeId: integer("link_type_id")
        .references(() => ontologyLinkTypes.id, { onDelete: "cascade" })
        .notNull(),
    sourceObjectId: integer("source_object_id")
        .references(() => ontologyObjects.id, { onDelete: "cascade" })
        .notNull(),
    targetObjectId: integer("target_object_id")
        .references(() => ontologyObjects.id, { onDelete: "cascade" })
        .notNull(),
    properties: jsonb("properties").notNull().default(sql`'{}'::jsonb`),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
    uniqueIndex("ontology_link_type_src_tgt_unique")
        .on(t.organizationId, t.linkTypeId, t.sourceObjectId, t.targetObjectId),
    index("ontology_link_org_type_idx").on(t.organizationId, t.linkTypeId),
    // Inbound traversal (target -> source) reads by target; without this it is a
    // sequential scan of every edge in the org.
    index("ontology_link_target_idx").on(t.organizationId, t.targetObjectId),
]);

export type OntologyObjectType = typeof ontologyObjectTypes.$inferSelect;
export type InsertOntologyObjectType = typeof ontologyObjectTypes.$inferInsert;
export type OntologyObject = typeof ontologyObjects.$inferSelect;
export type InsertOntologyObject = typeof ontologyObjects.$inferInsert;
export type OntologyAction = typeof ontologyActions.$inferSelect;
export type InsertOntologyAction = typeof ontologyActions.$inferInsert;
export type OntologyActionLogEntry = typeof ontologyActionLog.$inferSelect;
export type OntologyLinkType = typeof ontologyLinkTypes.$inferSelect;
export type InsertOntologyLinkType = typeof ontologyLinkTypes.$inferInsert;
export type OntologyLink = typeof ontologyLinks.$inferSelect;
export type InsertOntologyLink = typeof ontologyLinks.$inferInsert;

export const ONTOLOGY_LINK_CARDINALITIES = ["one_to_one", "one_to_many", "many_to_many"] as const;
export const ONTOLOGY_LINK_BACKINGS = ["derived", "materialized", "path"] as const;
export type OntologyLinkCardinality = (typeof ONTOLOGY_LINK_CARDINALITIES)[number];
export type OntologyLinkBacking = (typeof ONTOLOGY_LINK_BACKINGS)[number];

// Validation schemas
export const insertOntologyObjectTypeSchema = createInsertSchema(ontologyObjectTypes, {
    name: z.string().min(1, "Name is required").max(200),
    description: z.string().max(1000).optional().nullable(),
    propertiesSchema: z.record(z.any()).optional().default({}),
    backing: z.enum(["materialized", "virtual"]).optional().default("materialized"),
}).omit({ id: true, createdAt: true, updatedAt: true });

export const insertOntologyActionSchema = createInsertSchema(ontologyActions, {
    name: z.string().min(1, "Name is required").max(200),
    parametersSchema: z.record(z.any()).optional().default({}),
    effect: z.enum(["read", "write"]).optional().default("read"),
    handlerKind: z.enum(["builtin", "pipeline", "tool", "sql"]),
    riskLevel: z.enum(["low", "medium", "high"]).optional().default("medium"),
}).omit({ id: true, createdAt: true });

/**
 * A derived link must say which property carries the join key, and a polymorphic
 * one (no fixed targetTypeId) must say which property names the target's type
 * and how to map its values. Neither is expressible as a column constraint, so
 * the invariants are enforced here and mirrored by a CHECK in the migration.
 */
export const insertOntologyLinkTypeSchema = createInsertSchema(ontologyLinkTypes, {
    name: z.string().min(1, "Name is required").max(200),
    inverseName: z.string().min(1, "Inverse name is required").max(200),
    description: z.string().max(1000).optional().nullable(),
    cardinality: z.enum(ONTOLOGY_LINK_CARDINALITIES).optional().default("one_to_many"),
    backing: z.enum(ONTOLOGY_LINK_BACKINGS).optional().default("derived"),
    targetTypeMap: z.record(z.string()).optional().default({}),
})
    .omit({ id: true, createdAt: true, updatedAt: true })
    .superRefine((val, ctx) => {
        if (val.backing === "derived" && !val.sourceProperty) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["sourceProperty"],
                message: "A derived link type must name the source property carrying the join key.",
            });
        }
        if (val.backing === "materialized" && val.sourceProperty) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["sourceProperty"],
                message: "A materialized link type stores edges in ontology_links and must not declare a source property.",
            });
        }
        // No fixed target type => the target type is named by a source property,
        // and its values need a mapping to Object Type names.
        if (val.targetTypeId == null) {
            if (!val.targetTypeProperty) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["targetTypeProperty"],
                    message: "A polymorphic link type must name the property that identifies the target's Object Type.",
                });
            }
            if (!val.targetTypeMap || Object.keys(val.targetTypeMap).length === 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["targetTypeMap"],
                    message: "A polymorphic link type must map its type-property values to Object Type names.",
                });
            }
        }
    });

export const insertOntologyLinkSchema = createInsertSchema(ontologyLinks, {
    properties: z.record(z.any()).optional().default({}),
}).omit({ id: true, createdAt: true });

export type InsertOntologyObjectTypeInput = z.infer<typeof insertOntologyObjectTypeSchema>;
export type InsertOntologyActionInput = z.infer<typeof insertOntologyActionSchema>;
// z.input, not z.infer: the defaulted fields (cardinality, backing, targetTypeMap)
// are optional for a CALLER but required on the parsed output.
export type InsertOntologyLinkTypeInput = z.input<typeof insertOntologyLinkTypeSchema>;
export type InsertOntologyLinkInput = z.input<typeof insertOntologyLinkSchema>;
