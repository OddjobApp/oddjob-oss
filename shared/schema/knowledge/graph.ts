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
    decimal,
    index,
    boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

import { orgs } from '../auth.js';
import { pipelineExecutions } from '../pipelines/pipeline-execution.js';
import { knowledgeTopics, knowledgeDocuments } from '../knowledge-base.js';
import { missions } from '../missions/core.js';
import { prospectProperties } from '../prospecting.js';
import { apps, appDeployments } from '../apps.js';

// Verification status enum for Knowledge Garden HIL workflow
export const verificationStatusEnum = ["staging", "verified", "rejected"] as const;
export type VerificationStatus = (typeof verificationStatusEnum)[number];

// Standardized Knowledge Graph Relationship Taxonomy
export const knowledgeEdgeRelationEnum = [
    // Hierarchical (Structure)
    "PART_OF",             // Component -> part-of -> System
    "MEMBER_OF",           // User -> member-of -> Team
    "CONTAINED_IN",        // Endpoint -> contained-in -> Service

    // Functional (Flow)
    "RELIES_ON",           // Service A -> relies-on -> Database B
    "PROVIDED_BY",         // Capability -> provided-by -> Service
    "TRIGGERS",            // Event -> triggers -> Pipeline

    // Causal (Logic)
    "CAUSES",              // Change -> causes -> Regression
    "ENABLES",             // Feature -> enables -> Workflow
    "PRECEDED_BY",         // Task B -> preceded-by -> Task A

    // Behavioral coverage (Code/Docs/Test reconciliation)
    "INTRODUCED",          // Version -> introduced -> Behavior
    "IMPLEMENTS",          // Screen/Component -> implements -> Behavior
    "SUPPORTS",            // API/Dependency -> supports -> Behavior
    "DOCUMENTS",           // Documentation -> documents -> Behavior
    "VERIFIES",            // Test -> verifies -> Behavior

    // Association (Context)
    "ABOUT",               // Document -> about -> Topic
    "OWNED_BY",            // Service -> owned-by -> Team
    "ASSIGNED_TO",         // Task -> assigned-to -> Agent
    "MENTIONS",            // Entity -> mentions -> Entity
    "MENTIONS_ISSUE",      // Entity -> mentions-issue -> Issue

    // Semantic (Resolution)
    "SAME_AS",             // Entity A -> same-as -> Entity B
    "IS_A",                // PostgreSQL -> is-a -> Database
    "REPORTS_TO",          // User -> reports-to -> Manager

    // Computational (Hybrid Variable-Operation Model)
    "COMPUTES",            // Calculation -> computes -> Result
    "AGGREGATES",          // Collection -> aggregates -> Summary
    "TRANSFORMS",          // Value -> transforms -> Converted value
    "WEIGHTS_BY",         // Node -> weighted-by -> Factor
    "INPUT_TO",            // Variable -> input-to -> Calculation

    // Legacy/Generic (Fallback)
    "RELATED_TO"
] as const;

export type KnowledgeEdgeRelation = (typeof knowledgeEdgeRelationEnum)[number];

/**
 * Normalizes ad-hoc relationship strings to the standardized taxonomy.
 */
export function normalizeRelation(relation: string): KnowledgeEdgeRelation {
    const r = relation.trim().toUpperCase().replace(/\s+/g, '_');

    const mapping: Record<string, KnowledgeEdgeRelation> = {
        'ADDRESSES': 'ABOUT',
        'WORKS_ON': 'ASSIGNED_TO',
        'BUILT_BY': 'OWNED_BY',
        'VERSION_OF': 'SAME_AS',
        'UPGRADED_TO': 'CAUSES',
        'RESULTS_IN': 'CAUSES',
        'REQUIRES_MODIFICATION_OF': 'RELIES_ON',
        'INTEGRATED_WITH': 'RELIES_ON',
        'USES_DATA_FROM': 'RELIES_ON',
        'BELONGS_TO': 'PART_OF',
        // Computational mappings
        'CALCULATES': 'COMPUTES',
        'PRODUCES': 'COMPUTES',
        'CONVERTS': 'TRANSFORMS',
        'DEPENDS_ON': 'INPUT_TO',
    };

    if (mapping[r]) return mapping[r];

    // Direct check
    if (knowledgeEdgeRelationEnum.includes(r as any)) {
        return r as KnowledgeEdgeRelation;
    }

    return "RELATED_TO";
}

// Knowledge Graph Nodes
export const knowledgeNodes = pgTable("knowledge_nodes", {
    id: serial("id").primaryKey(),
    label: text("label").notNull(),     // Primary classification: "User", "Ticket", "Incident", "Infrastructure", "KnowledgeDocument"
    name: text("name").notNull(),       // Human-readable title: "John Doe", "Database Outage"
    externalId: text("external_id"),    // ID in source system: "JIRA-123", "user_55"
    data: jsonb("data").default({}),    // Flexible payload for all metadata (status, priority, email, etc.)
    knowledgeDocumentId: integer("knowledge_document_id")
        .references(() => knowledgeDocuments.id, { onDelete: "set null" }),
    knowledgeTopicId: integer("knowledge_topic_id")
        .references(() => knowledgeTopics.id, { onDelete: "set null" }), 
    pipelineExecutionId: integer("pipeline_execution_id")
        .references(() => pipelineExecutions.id, { onDelete: "set null" }),
    extractionSources: jsonb("extraction_sources").default(sql`'[]'::jsonb`), 
    fingerprint: text("fingerprint"), 
    verificationStatus: text("verification_status").default("staging").notNull(), 
    confidenceScore: decimal("confidence_score", { precision: 3, scale: 2 }), 
    initialConfidenceScore: decimal("initial_confidence_score", { precision: 3, scale: 2 }), 
    verifiedBy: text("verified_by"), 
    verifiedAt: timestamp("verified_at"), 
    lastReaffirmedAt: timestamp("last_reaffirmed_at"), 
    usageCount: integer("usage_count").default(0).notNull(), 
    utilityScore: decimal("utility_score", { precision: 5, scale: 2 }).default("1.00"), 
    missionId: integer("mission_id").references(() => missions.id, { onDelete: "set null" }),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
    prospectPropertyId: integer("prospect_property_id").references(() => prospectProperties.id, { onDelete: "cascade" }), 
    appId: integer("app_id").references(() => apps.id, { onDelete: "set null" }),
    deploymentId: integer("deployment_id").references(() => appDeployments.id, { onDelete: "set null" }),
    
    // Partitioning and Source Tracking
    sourceType: text("source_type").default("system").notNull(), // 'system' | 'confluence' | 'jira' | 'slack' | 'manual'
    fidelityClass: text("fidelity_class").default("operational").notNull(), // 'operational' (DNA) | 'informational' (Docs) | 'relational' (Data)
    
    // Federated Knowledge Logic
    scope: text("scope").default("private").notNull(), // 'private' | 'dept' | 'org'
    ownerId: integer("owner_id"), // ID of the agent (job) that owns this node
    embedding: text("embedding"), // Vector embedding stored as JSON string
    embeddingProvider: text("embedding_provider"),
    embeddingModel: text("embedding_model"),
    embeddingDimensions: integer("embedding_dimensions"),
    embeddingVersion: text("embedding_version"),
    createdBy: text("created_by"),
    sourceCreatedAt: timestamp("source_created_at"), // Creation date from original system (Jira/Confluence/Slack)
    sourceUpdatedAt: timestamp("source_updated_at"), // Last modification date from original system
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
    index("node_label_idx").on(table.label),
    index("node_name_idx").on(table.name),
    index("node_org_idx").on(table.organizationId),
    index("node_prop_idx").on(table.prospectPropertyId),
    index("node_mission_idx").on(table.missionId),
    index("node_topic_idx").on(table.knowledgeTopicId),
    index("node_app_idx").on(table.appId),
    index("node_deployment_idx").on(table.deploymentId),
    index("node_verification_idx").on(table.verificationStatus),
    index("node_temporal_idx").on(table.sourceCreatedAt),
    index("node_updated_temporal_idx").on(table.sourceUpdatedAt),
    index("knowledge_nodes_embedding_contract_idx").on(table.organizationId, table.embeddingProvider, table.embeddingModel, table.embeddingDimensions, table.embeddingVersion),
    uniqueIndex("node_org_label_external_id_unique")
        .on(table.organizationId, table.label, table.externalId)
        .where(sql`external_id IS NOT NULL`),
    uniqueIndex("node_org_fingerprint_unique")
        .on(table.organizationId, table.fingerprint)
        .where(sql`fingerprint IS NOT NULL`),
]);

export type KnowledgeNode = typeof knowledgeNodes.$inferSelect;
export type InsertKnowledgeNode = typeof knowledgeNodes.$inferInsert;

// Specialized property schemas for different labels
export const personPropertiesSchema = z.object({
    email: z.string().email().optional(),
    title: z.string().optional(),
    department: z.string().optional(),
    phone: z.string().optional(),
    linkedin: z.string().url().optional(),
}).passthrough();

export const organizationPropertiesSchema = z.object({
    website: z.string().url().optional(),
    industry: z.string().optional(),
    hq: z.string().optional(),
    employeeCount: z.number().optional(),
}).passthrough();

export const infrastructurePropertiesSchema = z.object({
    status: z.enum(["online", "offline", "maintenance", "degraded"]).optional(),
    environment: z.enum(["prod", "staging", "dev"]).optional(),
    ip: z.string().optional(),
    version: z.string().optional(),
}).passthrough();

// Variable node properties for hybrid calculation model
export const variablePropertiesSchema = z.object({
    value: z.number().optional(),
    unit: z.string().optional(),
    dataType: z.enum(["number", "string", "boolean", "date"]).optional(),
    isConstant: z.boolean().default(false),
}).passthrough();

export const nodePropertiesSchema = z.union([
    personPropertiesSchema,
    organizationPropertiesSchema,
    infrastructurePropertiesSchema,
    variablePropertiesSchema,
    z.record(z.any()), // Fallback
]);

// Validation schemas for Knowledge Nodes
export const knowledgeEvolutionEvents = pgTable("knowledge_evolution_events", {
    id: serial("id").primaryKey(),
    type: text("type").notNull(),       // 'PRUNING' | 'SYNTHESIS' | 'INTEGRITY_CHECK'
    status: text("status").notNull(),     // 'SUCCESS' | 'FAILURE'
    details: jsonb("details").default({}), // Nodes affected, mission IDs, gaps identified
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
    index("evolution_org_idx").on(table.organizationId),
    index("evolution_type_idx").on(table.type),
]);

export type KnowledgeEvolutionEvent = typeof knowledgeEvolutionEvents.$inferSelect;
export type InsertKnowledgeEvolutionEvent = typeof knowledgeEvolutionEvents.$inferInsert;

export const createKnowledgeNodeSchema = z.object({
    label: z.string().min(1, "Label is required").max(100, "Label must be 100 characters or less"),
    name: z.string().min(1, "Name is required").max(500, "Name must be 500 characters or less"),
    externalId: z.string().max(255, "External ID must be 255 characters or less").optional().nullable(),
    data: nodePropertiesSchema.optional().default({}),
    knowledgeDocumentId: z.number().int().positive().optional().nullable(),
    knowledgeTopicId: z.number().int().positive().optional().nullable(), // Direct topic link
    pipelineExecutionId: z.number().int().positive().optional().nullable(),
    extractionSources: z.array(z.any()).optional().default([]),
    fingerprint: z.string().max(64).optional().nullable(),
    verificationStatus: z.enum(verificationStatusEnum).optional().default("verified"),
    confidenceScore: z.number().min(0).max(1).optional().nullable(),
    initialConfidenceScore: z.number().min(0).max(1).optional().nullable(),
    missionId: z.number().int().positive().optional().nullable(),
    organizationId: z.number().int().positive().optional().nullable(),
    prospectPropertyId: z.number().int().positive().optional().nullable(),
    scope: z.enum(["private", "dept", "org"]).optional(), // DB default is "private"
    ownerId: z.number().int().positive().optional().nullable(),
    appId: z.number().int().positive().optional().nullable(),
    deploymentId: z.number().int().positive().optional().nullable(),
    sourceType: z.string().optional().default("system"),
    createdBy: z.string().optional().nullable(),
    sourceCreatedAt: z.union([z.date(), z.string().datetime()]).optional().nullable(),
    sourceUpdatedAt: z.union([z.date(), z.string().datetime()]).optional().nullable(),
});

export const updateKnowledgeNodeSchema = createKnowledgeNodeSchema.partial().extend({
    label: z.string().min(1).max(100).optional(),
    name: z.string().min(1).max(500).optional(),
});

// Schema for verification actions (Knowledge Garden)
export const verifyKnowledgeNodeSchema = z.object({
    action: z.enum(["approve", "reject", "correct"]),
    corrections: z.object({
        label: z.string().min(1).max(100).optional(),
        name: z.string().min(1).max(500).optional(),
        data: z.record(z.any()).optional(),
    }).optional(),
});

export type CreateKnowledgeNodeInput = z.infer<typeof createKnowledgeNodeSchema>;
export type UpdateKnowledgeNodeInput = z.infer<typeof updateKnowledgeNodeSchema>;
export type VerifyKnowledgeNodeInput = z.infer<typeof verifyKnowledgeNodeSchema>;

// Knowledge Graph Edges
export const knowledgeEdges = pgTable("knowledge_edges", {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id").references(() => knowledgeNodes.id, { onDelete: 'cascade' }).notNull(),
    targetId: integer("target_id").references(() => knowledgeNodes.id, { onDelete: 'cascade' }).notNull(),
    relation: text("relation").notNull(), 
    weight: integer("weight").default(1), 
    data: jsonb("data").default({}),    
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
    prospectPropertyId: integer("prospect_property_id").references(() => prospectProperties.id, { onDelete: "cascade" }),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
    missionId: integer("mission_id").references(() => missions.id, { onDelete: "set null" }),
    lastUpdatedByRunId: integer("last_updated_by_run_id").references(() => pipelineExecutions.id),
}, (table) => [
    index("edge_source_idx").on(table.sourceId),
    index("edge_target_idx").on(table.targetId),
    index("edge_org_idx").on(table.organizationId),
    index("edge_prop_idx").on(table.prospectPropertyId),
    index("edge_mission_idx").on(table.missionId),
    uniqueIndex("edge_source_target_relation_unique").on(table.sourceId, table.targetId, table.relation),
]);

export type KnowledgeEdge = typeof knowledgeEdges.$inferSelect;
export type InsertKnowledgeEdge = typeof knowledgeEdges.$inferInsert;

// Validation schemas for Knowledge Edges
export const createKnowledgeEdgeSchema = z.object({
    sourceId: z.number().int().positive("Source ID must be a positive integer"),
    targetId: z.number().int().positive("Target ID must be a positive integer"),
    relation: z.string().min(1, "Relation is required").max(100, "Relation must be 100 characters or less"),
    weight: z.number().int().min(1, "Weight must be at least 1").max(10, "Weight must be at most 10").optional().default(1),
    missionId: z.number().int().positive().optional().nullable(),
    organizationId: z.number().int().positive().optional().nullable(),
    prospectPropertyId: z.number().int().positive().optional().nullable(),
    createdBy: z.string().optional().nullable(),
    lastUpdatedByRunId: z.number().int().positive().optional().nullable(),
}).refine((data) => data.sourceId !== data.targetId, {
    message: "Source and target nodes cannot be the same (self-loops not allowed)",
    path: ["targetId"],
});

export const updateKnowledgeEdgeSchema = z.object({
    relation: z.string().min(1).max(100).optional(),
    weight: z.number().int().min(1).max(10).optional(),
});

export type CreateKnowledgeEdgeInput = z.infer<typeof createKnowledgeEdgeSchema>;
export type UpdateKnowledgeEdgeInput = z.infer<typeof updateKnowledgeEdgeSchema>;

// Graph Schema Definitions (Ontology Rules)
export const graphSchemaDefs = pgTable("graph_schema_defs", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
    missionId: integer("mission_id").references(() => missions.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    mappings: jsonb("mappings").notNull().default(sql`'[]'::jsonb`),
    entityTypes: jsonb("entity_types").notNull().default(sql`'{}'::jsonb`),
    relationshipTypes: jsonb("relationship_types").notNull().default(sql`'{}'::jsonb`),
    isActive: boolean("is_active").default(true).notNull(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
    uniqueIndex("graph_schema_name_org_unique").on(table.organizationId, table.name),
]);

// Validation schema for graph schema mappings
export const graphSchemaMappingSchema = z.object({
    // Structured Mapping Fields (Knowledge Engine 1.0)
    ruleId: z.string().optional().nullable(),
    name: z.string().optional().nullable(),
    sourceRootPath: z.string().optional().nullable(),
    entityType: z.string().optional().nullable(),
    entityNamePath: z.string().optional().nullable(),
    externalIdPath: z.string().optional().nullable(),
    includeFullSourceData: z.boolean().optional().nullable(),
    dataMapping: z.record(z.string()).optional().nullable(),

    // Semantic Enrichment Fields (Knowledge Engine 2.0)
    id: z.string().optional().nullable(),
    source_key: z.string().optional().nullable(),
    is_active: z.boolean().optional().nullable(),
    node_label: z.string().optional().nullable(),
    relationship: z.string().optional().nullable(),
    extraction_type: z.enum(["regex", "ai"]).optional().nullable(),
    config: z.object({
        regex: z.string().optional().nullable(),
        prompt: z.string().optional().nullable(),
    }).optional().nullable(),
});

export const graphSchemaInternalEdgeSchema = z.object({
    sourceRuleId: z.string().min(1),
    relationType: z.string().min(1),
    targetRuleId: z.string().min(1),
    weight: z.number().int().min(1).max(10).optional(),
    sourcePath: z.string().optional(),
    targetPath: z.string().optional(),
});

export const insertGraphSchemaDefSchema = createInsertSchema(graphSchemaDefs, {
    mappings: z.array(graphSchemaMappingSchema).optional().default([]),
    entityTypes: z.record(z.any()).optional().default({}),
    relationshipTypes: z.record(z.any()).optional().default({}),
    name: z.string().min(1, "Schema name is required").max(200, "Schema name must be 200 characters or less"),
    description: z.string().max(1000).optional().nullable(),
}).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export type InsertGraphSchemaDef = z.infer<typeof insertGraphSchemaDefSchema>;
export type GraphSchemaDef = typeof graphSchemaDefs.$inferSelect;

// Search schemas
export const knowledgeGraphSearchSchema = z.object({
    sourceLabel: z.string().optional(),
    sourceFilter: z.string().optional(),
    relation: z.string().optional(),
    targetLabel: z.string().optional(),
    targetFilter: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).default(50),
});

export type KnowledgeGraphSearchInput = z.infer<typeof knowledgeGraphSearchSchema>;



