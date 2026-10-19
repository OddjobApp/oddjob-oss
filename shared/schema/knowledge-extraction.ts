import { pgTable, text, integer, timestamp, serial, jsonb, index, boolean } from "drizzle-orm/pg-core";
import { knowledgeDocuments } from './knowledge-base.js';
import { graphSchemaDefs } from './knowledge/graph.js';
import { orgs } from './auth.js';
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { missions } from './missions/core.js';

// ============================================================================
// EXTRACTION JOB STATUS ENUM
// ============================================================================

export const extractionStatusEnum = [
    "queued",
    "processing",
    "completed",
    "failed",
    "cancelled",
    "paused",
] as const;
export type ExtractionStatus = (typeof extractionStatusEnum)[number];

// ============================================================================
// KNOWLEDGE DOCUMENT EXTRACTIONS TABLE
// ============================================================================

export const knowledgeDocumentExtractions = pgTable("knowledge_document_extractions", {
    id: serial("id").primaryKey(),
    documentId: integer("document_id")
        .notNull()
        .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    schemaId: integer("schema_id")
        .notNull()
        .references(() => graphSchemaDefs.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"),

    // Progress tracking
    progress: integer("progress").default(0).notNull(), // 0-100
    progressMessage: text("progress_message"),
    currentStep: text("current_step"), // "parsing", "extracting", "ingesting", "indexing"

    // Timing
    queuedAt: timestamp("queued_at").defaultNow().notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),

    // Results
    nodesExtracted: integer("nodes_extracted").default(0).notNull(),
    edgesExtracted: integer("edges_extracted").default(0).notNull(),

    // Error handling
    error: text("error"),
    errorDetails: jsonb("error_details"),
    retryCount: integer("retry_count").default(0).notNull(),
    maxRetries: integer("max_retries").default(3).notNull(),

    // Queue metadata
    priority: integer("priority").default(0).notNull(), // Higher = more urgent
    bullmqJobId: text("bullmq_job_id"), // For tracking in queue

    // Execution metadata
    metadata: jsonb("metadata").default({}), // Token usage, model used, etc.

    // Organization
    organizationId: integer("organization_id"), // .references(() => orgs.id, { onDelete: "cascade" }),
    missionId: integer("mission_id").references(() => missions.id, { onDelete: "set null" }),
    createdBy: text("created_by"),
}, (table) => ({
    /*
    documentIdx: index("extraction_document_idx").on(table.documentId),
    statusIdx: index("extraction_status_idx").on(table.status),
    orgIdx: index("extraction_org_idx").on(table.organizationId),
    queuedIdx: index("extraction_queued_idx").on(table.queuedAt),
    */
}));

export const insertKnowledgeDocumentExtractionSchema = createInsertSchema(knowledgeDocumentExtractions, {
    priority: z.number().int().min(0).max(10).optional().default(0),
    maxRetries: z.number().int().min(0).max(10).optional().default(3),
}).omit({
    id: true,
    progress: true,
    nodesExtracted: true,
    edgesExtracted: true,
    retryCount: true,
    bullmqJobId: true,
    queuedAt: true,
});

export type KnowledgeDocumentExtraction = typeof knowledgeDocumentExtractions.$inferSelect;
export type InsertKnowledgeDocumentExtraction = typeof knowledgeDocumentExtractions.$inferInsert;

// ============================================================================
// BULK EXTRACTION BATCHES TABLE
// ============================================================================

export const extractionBatches = pgTable("extraction_batches", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    schemaId: integer("schema_id")
        .notNull()
        .references(() => graphSchemaDefs.id, { onDelete: "cascade" }),

    // Status tracking
    status: text("status").notNull().default("pending"), // pending, running, completed, failed, cancelled
    totalDocuments: integer("total_documents").default(0).notNull(),
    processedDocuments: integer("processed_documents").default(0).notNull(),
    successfulDocuments: integer("successful_documents").default(0).notNull(),
    failedDocuments: integer("failed_documents").default(0).notNull(),

    // Progress
    progress: integer("progress").default(0).notNull(), // 0-100
    currentDocumentId: integer("current_document_id"),

    // Configuration
    priority: integer("priority").default(0).notNull(),
    concurrencyLimit: integer("concurrency_limit").default(5).notNull(),

    // Timing
    createdAt: timestamp("created_at").defaultNow().notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),

    // Results
    totalNodesExtracted: integer("total_nodes_extracted").default(0).notNull(),
    totalEdgesExtracted: integer("total_edges_extracted").default(0).notNull(),

    // Error summary
    errorSummary: jsonb("error_summary").default([]),

    // Organization
    organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),
    missionId: integer("mission_id").references(() => missions.id, { onDelete: "set null" }),
    createdBy: text("created_by"),
}, (table) => ({
    statusIdx: index("batch_status_idx").on(table.status),
    orgIdx: index("batch_org_idx").on(table.organizationId),
}));

export type ExtractionBatch = typeof extractionBatches.$inferSelect;
export type InsertExtractionBatch = typeof extractionBatches.$inferInsert;

export const insertExtractionBatchSchema = z.object({
    name: z.string().min(1, "Name is required").max(200),
    description: z.string().max(1000).optional().nullable(),
    schemaId: z.number().int().positive("Schema ID is required"),
    documentIds: z.array(z.number().int().positive()).min(1, "At least one document required"),
    priority: z.number().int().min(0).max(10).optional().default(0),
    concurrencyLimit: z.number().int().min(1).max(20).optional().default(5),
    organizationId: z.number().int().positive().optional().nullable(),
    createdBy: z.string().optional().nullable(),
});

export type CreateExtractionBatchInput = z.infer<typeof insertExtractionBatchSchema>;



