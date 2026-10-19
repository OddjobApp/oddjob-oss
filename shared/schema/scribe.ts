/**
 * Scribe Studio Schema
 *
 * Dedicated schema for longform authoring, contract engineering,
 * multi-lens critic annotations, and branching subway trees.
 */

import { sql } from "drizzle-orm";
import {
    pgTable,
    serial,
    integer,
    text,
    timestamp,
    boolean,
    jsonb,
    real,
    index,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { crewSessions } from "./crew.js";
import { agentCards } from "./agent-cards.js";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export const scribeArchetypeModes = [
    "heros_journey",
    "story_circle",
    "save_the_cat",
    "saas_msa",
    "harvard_batna",
    "amazon_prfaq",
    "minto_pyramid",
    "yc_pitch_deck",
    "imrad_paper",
    "freeform",
    // ── Business Document Archetypes ──
    "sow_statement_of_work",
    "business_doc_best_practices",
    "enterprise_sop",
    // ── AI Governance Archetypes ──
    "ai_system_governance",
    "data_lineage_narrative",
    "bias_mitigation_strategy",
] as const;
export type ScribeArchetypeMode = (typeof scribeArchetypeModes)[number];

export const scribeNodeStatuses = [
    "draft",
    "in_review",
    "approved",
    "continuity_conflict",
] as const;
export type ScribeNodeStatus = (typeof scribeNodeStatuses)[number];

export const scribeBranchStatuses = ["active", "merged", "archived"] as const;
export type ScribeBranchStatus = (typeof scribeBranchStatuses)[number];

export const scribeLensTypes = [
    "legal",
    "stylistic",
    "pacing",
    "devils_advocate",
    "fact_check",
    "note",
    "todo",
    "highlight",
] as const;
export type ScribeLensType = (typeof scribeLensTypes)[number];

export const scribeAnnotationSeverities = [
    "info",
    "suggestion",
    "warning",
    "critical_conflict",
] as const;
export type ScribeAnnotationSeverity = (typeof scribeAnnotationSeverities)[number];

export const scribeAnnotationStatuses = ["open", "accepted", "rejected", "resolved"] as const;
export type ScribeAnnotationStatus = (typeof scribeAnnotationStatuses)[number];

// ============================================================================
// TABLES
// ============================================================================

/**
 * Master Scribe Document
 */
export const scribeDocuments = pgTable("scribe_documents", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    sessionId: integer("session_id")
        .notNull()
        .references(() => crewSessions.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    archetypeMode: text("archetype_mode").$type<ScribeArchetypeMode>().notNull().default("freeform"),
    activeBranchId: integer("active_branch_id"),
    currentRevision: integer("current_revision").notNull().default(1),
    targetWordCount: integer("target_word_count"),
    settings: jsonb("settings").$type<{
        autoContinuity?: boolean;
        ghostWriter?: boolean;
        defaultLenses?: ScribeLensType[];
        toneTarget?: {
            formality?: number;
            brevity?: number;
            posture?: number;
        };
        /**
         * Publication history, newest first, capped at 50 by publishDocument.
         *
         * It was written through an `as any` cast and never declared, so the
         * durable record of every publish was invisible to everything that
         * might have shown it — which is why the studio acknowledged a publish
         * for 1600ms and then forgot it had happened.
         */
        publications?: Array<{
            versionTag: string;
            publishedAt: string;
            releaseNotes?: string;
            wordCount?: number;
            attachmentId?: number;
            blobId?: number;
            theme?: string;
        }>;
    }>().notNull().default({
        autoContinuity: true,
        ghostWriter: true,
        defaultLenses: ["legal", "stylistic", "devils_advocate"],
    }),
    /**
     * The manuscript this one is filed under, Confluence's child-page relation.
     *
     * A self-reference rather than a hierarchy table: a Scribe document already
     * is the page, so giving it a parent is the whole of what "child" means, and
     * a join table would only add a way for the two to disagree. Nullable, and
     * the FK is ON DELETE SET NULL — deleting a parent must not destroy every
     * manuscript filed beneath it, so orphans surface at the root instead.
     */
    parentDocumentId: integer("parent_document_id"),
    /**
     * Free-form labels, as Confluence uses them: cross-cutting tags that group
     * documents which sit in different parts of the tree.
     *
     * Defaulted to an empty array rather than null so every read can treat it as
     * an array without coalescing at each call site.
     */
    labels: jsonb("labels").$type<string[]>().notNull().default([]),
    /**
     * The AI system this manuscript documents, in whatever registry or
     * deployment manifest the organization keeps. A plain string rather than a
     * FK: registries live outside this schema, and an id that means nothing
     * here must still be recordable here.
     */
    aiSystemId: text("ai_system_id"),
    /**
     * Cross-document references into the AI-governance document set.
     *
     * Same convention as parentDocumentId — an integer id rather than a
     * declared FK. The target is a Scribe document holding the artifact:
     * the lineage graph (a Mermaid diagram or structured JSON in a
     * data_lineage_narrative document), the bias mitigation strategy, and the
     * governance policy. Validation happens in the service, which enforces
     * same-organization references; the column stays unfettered so deleting a
     * referenced document cannot cascade into this one.
     */
    dataLineageGraphId: integer("data_lineage_graph_id"),
    biasMitigationStrategyDocumentId: integer("bias_mitigation_strategy_document_id"),
    governancePolicyDocumentId: integer("governance_policy_document_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index("scribe_docs_org_idx").on(table.organizationId),
    index("scribe_docs_session_idx").on(table.sessionId),
    index("scribe_documents_org_parent_idx").on(table.organizationId, table.parentDocumentId),
]);

/**
 * Document Branch Lineage (Subway Tracks)
 */
export const scribeBranches = pgTable("scribe_branches", {
    id: serial("id").primaryKey(),
    documentId: integer("document_id")
        .notNull()
        .references(() => scribeDocuments.id, { onDelete: "cascade" }),
    branchKey: text("branch_key").notNull(), // e.g. 'main', 'branch-stealth', 'concession-2x'
    parentBranchId: integer("parent_branch_id"),
    breakoutSessionId: integer("breakout_session_id")
        .references(() => crewSessions.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").$type<ScribeBranchStatus>().notNull().default("active"),
    divergedAtStationKey: text("diverged_at_station_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index("scribe_branches_doc_idx").on(table.documentId),
    uniqueIndex("scribe_branches_doc_key_unique").on(table.documentId, table.branchKey),
]);

/**
 * Document Stations & Content Nodes (Subway Stations)
 */
export const scribeNodes = pgTable("scribe_nodes", {
    id: serial("id").primaryKey(),
    documentId: integer("document_id")
        .notNull()
        .references(() => scribeDocuments.id, { onDelete: "cascade" }),
    branchId: integer("branch_id")
        .notNull()
        .references(() => scribeBranches.id, { onDelete: "cascade" }),
    stationKey: text("station_key").notNull(), // e.g. 'ordinary_world', 'indemnity_clause'
    title: text("title").notNull(),
    sortOrder: integer("sort_order").notNull(),
    targetPercentage: real("target_percentage"), // e.g. 0.12 (12% of manuscript)
    content: text("content").notNull().default(""),
    contentRich: jsonb("content_rich").$type<Record<string, unknown>>(),
    wordCount: integer("word_count").notNull().default(0),
    status: text("status").$type<ScribeNodeStatus>().notNull().default("draft"),
    continuityNotes: jsonb("continuity_notes").$type<Array<{
        type: string;
        message: string;
        suggestedFix?: string;
        sourceStationKey?: string;
    }>>().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index("scribe_nodes_doc_branch_idx").on(table.documentId, table.branchId),
    index("scribe_nodes_sort_idx").on(table.branchId, table.sortOrder),
]);

/**
 * Multi-Lens Annotations & Margin Cards
 */
export const scribeAnnotations = pgTable("scribe_annotations", {
    id: serial("id").primaryKey(),
    documentId: integer("document_id")
        .notNull()
        .references(() => scribeDocuments.id, { onDelete: "cascade" }),
    nodeId: integer("node_id")
        .notNull()
        .references(() => scribeNodes.id, { onDelete: "cascade" }),
    agentCardId: integer("agent_card_id")
        .references(() => agentCards.id, { onDelete: "set null" }),
    lensType: text("lens_type").$type<ScribeLensType>().notNull(),
    paragraphAnchor: text("paragraph_anchor"), // paragraph index or hash anchor
    severity: text("severity").$type<ScribeAnnotationSeverity>().notNull().default("info"),
    title: text("title").notNull(),
    critiqueBody: text("critique_body").notNull(),
    proposedDiff: text("proposed_diff"), // Drop-in text replacement suggestion
    status: text("status").$type<ScribeAnnotationStatus>().notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index("scribe_annot_doc_idx").on(table.documentId),
    index("scribe_annot_node_idx").on(table.nodeId),
]);

/**
 * Living Entity & Definition Ledger
 */
export const scribeEntityLedger = pgTable("scribe_entity_ledger", {
    id: serial("id").primaryKey(),
    documentId: integer("document_id")
        .notNull()
        .references(() => scribeDocuments.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(), // 'defined_term', 'character', 'location', 'data_tether', 'clause_ref'
    termName: text("term_name").notNull(), // e.g. 'Confidential Information', 'Captain Mara', 'Q2 ARR'
    definitionText: text("definition_text"),
    firstDefinedNodeId: integer("first_defined_node_id")
        .references(() => scribeNodes.id, { onDelete: "set null" }),
    dataBinding: jsonb("data_binding").$type<{
        datasetId?: number;
        queryId?: number;
        /** A tether onto a calculation node rather than a dataset column. */
        calculationNodeId?: number;
        field?: string;
        lastValue?: string | number;
        /** Display unit for the tethered figure, when it has one. */
        unit?: string | null;
        lastCheckedAt?: string;
    }>(),
    aliases: jsonb("aliases").$type<string[]>().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index("scribe_ledger_doc_idx").on(table.documentId),
    uniqueIndex("scribe_ledger_doc_term_unique").on(table.documentId, table.termName),
]);

export type ScribeDocument = typeof scribeDocuments.$inferSelect;
export type ScribeDocumentInsert = typeof scribeDocuments.$inferInsert;

export type ScribeBranch = typeof scribeBranches.$inferSelect;
export type ScribeBranchInsert = typeof scribeBranches.$inferInsert;

export type ScribeNode = typeof scribeNodes.$inferSelect;
export type ScribeNodeInsert = typeof scribeNodes.$inferInsert;

export type ScribeAnnotation = typeof scribeAnnotations.$inferSelect;
export type ScribeAnnotationInsert = typeof scribeAnnotations.$inferInsert;

export type ScribeEntityLedgerEntry = typeof scribeEntityLedger.$inferSelect;
export type ScribeEntityLedgerInsert = typeof scribeEntityLedger.$inferInsert;

// ============================================================================
// Authoring Operations — the record of every attempt to change a manuscript
// ============================================================================

export const scribeAuthoringOperationStatuses = ["proposed", "applied", "rejected", "failed"] as const;
export type ScribeAuthoringOperationStatus = (typeof scribeAuthoringOperationStatuses)[number];

/** Where a passage came from, carried through research into the document. */
export interface ScribeSourceReference {
    file?: string;
    attachmentId?: number;
    chunk?: number;
    score?: number;
    url?: string;
    excerpt?: string;
}

/**
 * One attempt to change a manuscript, written before the mutation and closed
 * after it.
 *
 * Content was previously the only evidence an edit had happened, and content
 * cannot say who asked, what was asked, what was proposed, which revision it was
 * computed against, or whether the write actually landed. That last gap is the
 * one that kept biting: a tool returning "Error updating Scribe station" was
 * recorded as ok, an autosave was acknowledged before its request was sent, and
 * export replied 200 while producing no file. None of it left a trace.
 *
 * `request` and `proposedContent` are separate columns deliberately. Conflating
 * them is how "I am the Copilot. I defer to the GhostWriter for content
 * generation" reached a manuscript as though it were prose — commentary and
 * document content are different things and are stored as different things.
 */
export const scribeAuthoringOperations = pgTable("scribe_authoring_operations", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    documentId: integer("document_id")
        .notNull()
        .references(() => scribeDocuments.id, { onDelete: "cascade" }),
    /** Null for an operation over the whole outline rather than one station. */
    nodeId: integer("node_id").references(() => scribeNodes.id, { onDelete: "set null" }),
    branchId: integer("branch_id"),

    sessionId: integer("session_id"),
    turnId: integer("turn_id"),
    actor: text("actor").notNull(),

    /** The verb: update_node, configure_stations, add_toc, crystallize… */
    operation: text("operation").notNull(),
    /** What was asked for, in the asker's words. Never document content. */
    request: text("request"),
    constraints: jsonb("constraints").$type<Record<string, unknown>>().notNull().default({}),

    /** The prose proposed for the document, and the state it was computed against. */
    proposedContent: text("proposed_content"),
    targetRevision: integer("target_revision"),
    appliedRevision: integer("applied_revision"),

    sources: jsonb("sources").$type<ScribeSourceReference[]>().notNull().default([]),

    status: text("status").$type<ScribeAuthoringOperationStatus>().notNull().default("proposed"),
    /** Set only after the stored content was read back and compared. */
    verified: boolean("verified").notNull().default(false),
    failureReason: text("failure_reason"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
}, (table) => [
    index("scribe_authoring_ops_doc_idx").on(table.organizationId, table.documentId),
    index("scribe_authoring_ops_node_idx").on(table.nodeId),
]);

export type ScribeAuthoringOperation = typeof scribeAuthoringOperations.$inferSelect;
export type ScribeAuthoringOperationInsert = typeof scribeAuthoringOperations.$inferInsert;

/**
 * Confidential Orchestration & Redaction Engine (CORE) Vault Records
 * Holds encrypted payloads for masked blocks and tokens, strictly scoped by organization.
 */
export const scribeVaultClassifications = [
    "adult",
    "violence",
    "forensic",
    "pii",
    "ip",
    "confidential",
] as const;
export type ScribeVaultClassification = (typeof scribeVaultClassifications)[number];

export const scribeVaultModes = ["static_reinsert", "generate_local"] as const;
export type ScribeVaultMode = (typeof scribeVaultModes)[number];

export const scribeVaultRecords = pgTable("scribe_vault_records", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    documentId: integer("document_id")
        .notNull()
        .references(() => scribeDocuments.id, { onDelete: "cascade" }),
    nodeId: integer("node_id")
        .references(() => scribeNodes.id, { onDelete: "set null" }),
    tokenId: text("token_id").notNull().unique(),
    slug: text("slug"),
    classification: text("classification")
        .$type<ScribeVaultClassification>()
        .notNull()
        .default("confidential"),
    mode: text("mode")
        .$type<ScribeVaultMode>()
        .notNull()
        .default("static_reinsert"),
    summary: text("summary").notNull(),
    encryptedPayload: text("encrypted_payload").notNull(), // Format: iv.tag.ciphertext (hex)
    localModelHint: text("local_model_hint"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index("scribe_vault_org_doc_idx").on(table.organizationId, table.documentId),
    index("scribe_vault_org_node_idx").on(table.organizationId, table.nodeId),
    index("scribe_vault_token_idx").on(table.tokenId),
]);

export type ScribeVaultRecord = typeof scribeVaultRecords.$inferSelect;
export type ScribeVaultRecordInsert = typeof scribeVaultRecords.$inferInsert;

// ============================================================================
// Content Versioning — a Git-like commit log over the manuscript
// ============================================================================

export const scribeRevisionScopes = ["node", "document"] as const;
export type ScribeRevisionScope = (typeof scribeRevisionScopes)[number];

export const scribeRevisionKinds = [
    /** A station's content, title or status changed. */
    "edit",
    /** A station was added to a branch. */
    "add",
    /** A station was deleted; the snapshot is its last state. */
    "delete",
    /** A station was renamed. */
    "rename",
    /** The outline changed: reorder, reconfigure, or archetype re-frame. */
    "outline",
    /** A named snapshot taken at the author's request. */
    "commit",
    /** A branch was merged into another. */
    "merge",
    /** A branch was forked; the snapshot is the forked state. */
    "fork",
    /** The manuscript was published as a deliverable. */
    "publish",
    /** The document was reset; the snapshot is the pre-reset state. */
    "reset",
    /** A previous revision was restored; the snapshot is the restored state. */
    "rollback",
    /** AI-system metadata (registry id or document links) changed. */
    "metadata",
    /** A review was requested; the snapshot pins the content under review. */
    "review_request",
] as const;
export type ScribeRevisionKind = (typeof scribeRevisionKinds)[number];

/** One station frozen into a revision. */
export interface ScribeNodeSnapshot {
    nodeId: number;
    stationKey: string;
    title: string;
    sortOrder: number;
    content: string;
    contentRich: Record<string, unknown> | null;
    wordCount: number;
    status: string;
}

/** The whole document frozen into a revision, metadata included. */
export interface ScribeDocumentSnapshot {
    title: string;
    archetypeMode: string;
    aiSystemId: string | null;
    dataLineageGraphId: number | null;
    biasMitigationStrategyDocumentId: number | null;
    governancePolicyDocumentId: number | null;
    nodes: ScribeNodeSnapshot[];
}

export type ScribeRevisionSnapshot =
    | { scope: "node"; node: ScribeNodeSnapshot }
    | { scope: "document"; document: ScribeDocumentSnapshot };

/**
 * An immutable snapshot of a station or a whole document — the commit object in
 * the manuscript's version history.
 *
 * scribe_authoring_operations already records that an edit was attempted and
 * verified; it does not keep what the document looked like, because it stores
 * the proposed content rather than the resulting state. Those are different
 * answers: the operation log can say "this write landed" and still leave
 * nothing to diff against and nothing to roll back to. This table stores the
 * state itself.
 *
 * `nodeId` and `branchId` are SET NULL rather than CASCADE. resetDocument
 * deletes every station on the document; if revisions cascaded with them, the
 * one operation that most needs a restore point would erase its own history
 * at the moment it ran.
 */
export const scribeRevisions = pgTable("scribe_revisions", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    documentId: integer("document_id")
        .notNull()
        .references(() => scribeDocuments.id, { onDelete: "cascade" }),
    branchId: integer("branch_id")
        .references(() => scribeBranches.id, { onDelete: "set null" }),
    nodeId: integer("node_id")
        .references(() => scribeNodes.id, { onDelete: "set null" }),
    /** Monotonic per document — the human-facing "r14" of the history. */
    revisionNumber: integer("revision_number").notNull(),
    scope: text("scope").$type<ScribeRevisionScope>().notNull(),
    kind: text("kind").$type<ScribeRevisionKind>().notNull(),
    /** The commit message — why this snapshot exists. */
    message: text("message"),
    actor: text("actor").notNull().default("author"),
    snapshot: jsonb("snapshot").$type<ScribeRevisionSnapshot>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
    index("scribe_revisions_doc_idx").on(table.organizationId, table.documentId),
    index("scribe_revisions_node_idx").on(table.documentId, table.nodeId),
    uniqueIndex("scribe_revisions_doc_rev_unique").on(table.documentId, table.revisionNumber),
]);

export type ScribeRevision = typeof scribeRevisions.$inferSelect;
export type ScribeRevisionInsert = typeof scribeRevisions.$inferInsert;

// ============================================================================
// Review & Approval — who signed off on which state of the text
// ============================================================================

export const scribeReviewStatuses = ["pending", "approved", "changes_requested"] as const;
export type ScribeReviewStatus = (typeof scribeReviewStatuses)[number];

/**
 * A review request over a station or a whole document, pinned to the revision
 * that was actually read.
 *
 * Node status ("in_review" → "approved") already exists, but a status alone
 * cannot say who was asked, who decided, against which version of the text,
 * or why. A reviewer approving today's wording must not appear to have
 * approved tomorrow's rewrite, so the request stores the revision it was
 * raised against.
 */
export const scribeReviews = pgTable("scribe_reviews", {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    documentId: integer("document_id")
        .notNull()
        .references(() => scribeDocuments.id, { onDelete: "cascade" }),
    /** Null for a review of the whole document. */
    nodeId: integer("node_id")
        .references(() => scribeNodes.id, { onDelete: "cascade" }),
    /** The revision the reviewer was asked to read. */
    revisionId: integer("revision_id")
        .references(() => scribeRevisions.id, { onDelete: "set null" }),
    requestedBy: text("requested_by").notNull(),
    reviewer: text("reviewer"),
    status: text("status").$type<ScribeReviewStatus>().notNull().default("pending"),
    requestNote: text("request_note"),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
}, (table) => [
    index("scribe_reviews_doc_idx").on(table.organizationId, table.documentId),
    index("scribe_reviews_node_idx").on(table.documentId, table.nodeId),
]);

export type ScribeReview = typeof scribeReviews.$inferSelect;
export type ScribeReviewInsert = typeof scribeReviews.$inferInsert;

