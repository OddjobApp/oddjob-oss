import { sql } from "drizzle-orm";
import {
    pgTable,
    text,
    serial,
    timestamp,
    integer,
    jsonb,
} from "drizzle-orm/pg-core";

import { orgs } from '../auth.js';
import { jobs } from '../jobs/table.js';
import { pipelineStepExecutions } from '../pipelines/pipeline-execution.js';
import { knowledgeTopics, knowledgeDocuments } from '../knowledge-base.js';

export const ragAssetTypes = [
    "PDF",
    "Text",
    "Embeddings",
    "Datasources",
    "URLs",
    "Knowledge Topic",
    "Knowledge Document",
] as const;
export type RagAssetType = (typeof ragAssetTypes)[number];

export const ragSourceTypes = ["upload", "link"] as const;
export type RagSourceType = (typeof ragSourceTypes)[number];

export const ragSelectionTypes = ["custom", "topic", "document"] as const;
export type RagSelectionType = (typeof ragSelectionTypes)[number];

export const ragAssets = pgTable("rag_asset", {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    assetType: text("asset_type").notNull(),
    sourceType: text("source_type").notNull(),
    contentType: text("content_type"),
    fileSize: integer("file_size"),
    fileData: text("file_data"),
    url: text("url"),
    textContent: text("text_content"),
    qdrantPointId: text("qdrant_point_id"),
    jobId: integer("job_id")
        .references(() => jobs.id, { onDelete: "cascade" }),
    organizationId: integer("organization_id").references(() => orgs.id),
    order: integer("order").notNull().default(0),
    selectionType: text("selection_type").notNull().default("custom"),
    knowledgeTopicId: integer("knowledge_topic_id")
        .references(() => knowledgeTopics.id, { onDelete: "set null" }),
    knowledgeDocumentId: integer("knowledge_document_id")
        .references(() => knowledgeDocuments.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type RagAsset = typeof ragAssets.$inferSelect;
export type InsertRagAsset = typeof ragAssets.$inferInsert;

export const jobOutputKnowledge = pgTable("job_output_knowledge", {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
        .notNull()
        .references(() => jobs.id, { onDelete: "cascade" }),
    pipelineStepExecutionId: integer("pipeline_step_execution_id")
        .references(() => pipelineStepExecutions.id, { onDelete: "cascade" }),
    knowledgeDocumentId: integer("knowledge_document_id")
        .references(() => knowledgeDocuments.id, { onDelete: "set null" }),
    knowledgeTopicId: integer("knowledge_topic_id")
        .references(() => knowledgeTopics.id, { onDelete: "set null" }),
    output: text("output").notNull(),
    tags: text("tags").array().default(sql`ARRAY[]::text[]`),
    executionMetadata: jsonb("execution_metadata"),
    qdrantPointIds: text("qdrant_point_ids").array().default(sql`ARRAY[]::text[]`),
    organizationId: integer("organization_id")
        .references(() => orgs.id, { onDelete: "cascade" }),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type JobOutputKnowledge = typeof jobOutputKnowledge.$inferSelect;
export type InsertJobOutputKnowledge = typeof jobOutputKnowledge.$inferInsert;



