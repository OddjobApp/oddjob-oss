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
    uniqueIndex,
    index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { orgs } from './auth.js';
import { saasConnectors } from './integrations.js';
import { missions } from './missions/core.js';
import { projects } from './projects.js';
import { governorPolicyRules } from './governor.js';

// Export calculation schema for neuro-symbolic graph mathematical operations
export * from './knowledge/calculations.js';

// ============================================================================
// KNOWLEDGE BASE (Topics & Documents)
// ============================================================================

export const knowledgeTopics = pgTable(
    "knowledge_topics",
    {
        id: serial("id").primaryKey(),
        name: text("name").notNull(),
        description: text("description"),
        parentTopicId: integer("parent_topic_id").references((): any => knowledgeTopics.id, { onDelete: "set null" }),
        organizationId: integer("organization_id").references(() => orgs.id),
        /**
         * Project Space scoping. NULL = org-wide vocabulary shared by every
         * project; set = private to that project. Lets one org hold a distinct
         * "Pricing" concept per property/project without collision.
         */
        projectId: integer("project_id"),
        missionId: integer("mission_id").references(() => missions.id, { onDelete: "set null" }),
        createdBy: text("created_by"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
    },
    (table) => ({
        // Two PARTIAL unique indexes rather than one over (org, project, name).
        // Postgres treats NULLs as distinct, so a single composite index would
        // let org-level rows duplicate freely — the exact case the original
        // constraint existed to prevent.
        orgNameUnique: uniqueIndex("knowledge_topics_org_name_unique")
            .on(table.organizationId, table.name)
            .where(sql`project_id IS NULL`),
        orgProjectNameUnique: uniqueIndex("knowledge_topics_org_project_name_unique")
            .on(table.organizationId, table.projectId, table.name)
            .where(sql`project_id IS NOT NULL`),
    })
);

export type KnowledgeTopic = typeof knowledgeTopics.$inferSelect;
export type InsertKnowledgeTopic = typeof knowledgeTopics.$inferInsert;

export const knowledgeConcepts = pgTable(
    "knowledge_concepts",
    {
        id: serial("id").primaryKey(),
        name: text("name").notNull(),
        description: text("description"),
        organizationId: integer("organization_id").references(() => orgs.id),
        /** Project Space scoping — see knowledgeTopics.projectId. */
        projectId: integer("project_id"),
        createdBy: text("created_by"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
    },
    (table) => ({
        orgNameUnique: uniqueIndex("knowledge_concepts_org_name_unique")
            .on(table.organizationId, table.name)
            .where(sql`project_id IS NULL`),
        orgProjectNameUnique: uniqueIndex("knowledge_concepts_org_project_name_unique")
            .on(table.organizationId, table.projectId, table.name)
            .where(sql`project_id IS NOT NULL`),
    })
);

export type KnowledgeConcept = typeof knowledgeConcepts.$inferSelect;
export type InsertKnowledgeConcept = typeof knowledgeConcepts.$inferInsert;

export const knowledgeTopicConcepts = pgTable(
    "knowledge_topic_concepts",
    {
        topicId: integer("topic_id")
            .notNull()
            .references(() => knowledgeTopics.id, { onDelete: "cascade" }),
        conceptId: integer("concept_id")
            .notNull()
            .references(() => knowledgeConcepts.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.topicId, table.conceptId] }),
    })
);

export type KnowledgeTopicConcept = typeof knowledgeTopicConcepts.$inferSelect;

export const knowledgePolicyConstraints = pgTable(
    "knowledge_policy_constraints",
    {
        id: serial("id").primaryKey(),
        conceptId: integer("concept_id")
            .notNull()
            .references(() => knowledgeConcepts.id, { onDelete: "cascade" }),
        policyRuleId: integer("policy_rule_id")
            .notNull()
            .references(() => governorPolicyRules.id, { onDelete: "cascade" }),
        severity: text("severity").notNull().default("info"), // "info", "warning", "critical"
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => ({
        conceptRuleUnique: uniqueIndex("knowledge_policy_concept_rule_unique").on(
            table.conceptId,
            table.policyRuleId
        ),
    })
);

export const knowledgeSmes = pgTable(
    "knowledge_smes",
    {
        id: serial("id").primaryKey(),
        conceptId: integer("concept_id")
            .notNull()
            .references(() => knowledgeConcepts.id, { onDelete: "cascade" }),
        userId: text("user_id").notNull(), // External ID or email
        level: text("level").notNull().default("expert"), // "expert", "owner", "contributor"
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => ({
        conceptUserUnique: uniqueIndex("knowledge_smes_concept_user_unique").on(
            table.conceptId,
            table.userId
        ),
    })
);

export const knowledgeDocumentSourceTypes = ["upload", "link", "text", "integration", "instruction"] as const;
export type KnowledgeDocumentSourceType =
    (typeof knowledgeDocumentSourceTypes)[number];

export const knowledgeDocuments = pgTable("knowledge_documents", {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    summary: text("summary"),
    sourceType: text("source_type")
        .notNull()
        .default("upload"),
    contentType: text("content_type"),
    fileSize: integer("file_size"),
    fileData: text("file_data"),
    url: text("url"),
    textContent: text("text_content"),
    metadata: jsonb("metadata"),
    externalId: text("external_id"), // ID in source system (e.g. Jira Issue Key)
    organizationId: integer("organization_id").references(() => orgs.id),
    missionId: integer("mission_id").references(() => missions.id, { onDelete: "set null" }),
    datasetItemId: integer("dataset_item_id"), // Reference to logical primary in dataset_items
    integrationId: integer("integration_id").references(() => saasConnectors.id, { onDelete: "set null" }), // Link to SaaS connector
    workflowExecutionId: integer("workflow_execution_id"), // Links to pipeline_executions table
    workflowStepId: integer("workflow_step_id"), // Links to pipeline_step_executions table
    createdBy: text("created_by"),
    qdrantPointId: text("qdrant_point_id"),
    // Namespacing column — document titles are unique WITHIN a project, so the same
    // titled doc can exist independently in two projects. Also the pre-filter key for
    // project-scoped RAG retrieval. See PROJECT_SPACES_DESIGN §5.2/§6.4.
    projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
    projectTitleUnique: uniqueIndex("knowledge_docs_project_title_unique").on(table.projectId, table.title),
    projectIdx: index("knowledge_docs_project_idx").on(table.projectId),
    integrationExternalUnique: uniqueIndex("knowledge_docs_integration_external_unq").on(
        table.organizationId,
        table.integrationId,
        table.externalId
    ).where(sql`integration_id IS NOT NULL AND external_id IS NOT NULL`),
    // Per person: two people who attended the same meeting each sync their own
    // copy into their own project, never each other's.
    granolaExternalUnique: uniqueIndex("knowledge_docs_granola_external_unq").on(
        table.organizationId,
        table.createdBy,
        table.externalId
    ).where(sql`metadata->>'source' = 'granola' AND external_id IS NOT NULL`),
    datasetItemIdx: index("knowledge_docs_dataset_item_idx").on(table.datasetItemId),
    workflowExecutionIdx: index("knowledge_docs_workflow_execution_idx").on(table.workflowExecutionId),
    workflowStepIdx: index("knowledge_docs_workflow_step_idx").on(table.workflowStepId),
}));

export type KnowledgeDocument = typeof knowledgeDocuments.$inferSelect;
export type InsertKnowledgeDocument = typeof knowledgeDocuments.$inferInsert;

export const knowledgeTopicDocuments = pgTable(
    "knowledge_topic_documents",
    {
        topicId: integer("topic_id")
            .notNull()
            .references(() => knowledgeTopics.id, { onDelete: "cascade" }),
        documentId: integer("document_id")
            .notNull()
            .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => ({
        pk: primaryKey({ columns: [table.topicId, table.documentId] }),
    })
);

export type KnowledgeTopicDocument = typeof knowledgeTopicDocuments.$inferSelect;

/**
 * A user follows a topic: surface new #[tagged] activity across the org's
 * rooms in their activity feed. Cascade with the topic so merging or
 * deleting a vocabulary entry never orphans a subscription.
 */
export const topicSubscriptions = pgTable(
    "topic_subscriptions",
    {
        id: serial("id").primaryKey(),
        topicId: integer("topic_id")
            .notNull()
            .references(() => knowledgeTopics.id, { onDelete: "cascade" }),
        organizationId: integer("organization_id")
            .notNull()
            .references(() => orgs.id, { onDelete: "cascade" }),
        userId: text("user_id").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
    },
    (table) => ({
        userTopicUnique: uniqueIndex("topic_subscriptions_user_topic_unique").on(
            table.organizationId,
            table.userId,
            table.topicId,
        ),
        topicIdx: index("idx_topic_subscriptions_topic").on(table.topicId),
        userIdx: index("idx_topic_subscriptions_user").on(table.organizationId, table.userId),
    })
);

export type TopicSubscription = typeof topicSubscriptions.$inferSelect;



