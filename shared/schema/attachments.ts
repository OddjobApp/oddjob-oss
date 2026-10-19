import { sql } from "drizzle-orm";
import {
    pgTable,
    text,
    serial,
    integer,
    jsonb,
    timestamp,
    index,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { orgs } from "./auth.js";
import { projects } from "./projects.js";
import { crewSessions } from "./crew.js";

/** Parse and index states, kept explicit so "not yet" never reads as "empty". */
export const PARSE_STATUSES = ["pending", "parsed", "unsupported", "failed"] as const;
export const INDEX_STATUSES = ["pending", "indexed", "skipped", "failed"] as const;
export type ParseStatus = typeof PARSE_STATUSES[number];
export type IndexStatus = typeof INDEX_STATUSES[number];

/**
 * The stored bytes, addressed by content.
 *
 * One blob, many references: the same deck attached in three rooms is parsed
 * once and embedded once. See migration 0082.
 */
export const fileBlobs = pgTable("file_blobs", {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),
    /** sha256 of the bytes; unique per org, not globally. */
    contentHash: text("content_hash").notNull(),
    storagePath: text("storage_path").notNull(),
    byteSize: integer("byte_size").notNull(),
    mimeType: text("mime_type"),
    originalName: text("original_name"),

    parseStatus: text("parse_status").$type<ParseStatus>().default("pending").notNull(),
    /** Mirrors FileParser's discriminator: table | json | text | image | bpmn. */
    parseType: text("parse_type"),
    parsedText: text("parsed_text"),
    parseError: text("parse_error"),
    /** Structured extraction — a BPMN process graph, a CSV's columns. */
    parsedData: jsonb("parsed_data").$type<Record<string, any> | null>(),
    /**
     * Full character count BEFORE chunking. A preview must never be mistaken
     * for the whole document — the old parser truncated at 10k silently.
     */
    textLength: integer("text_length"),

    indexStatus: text("index_status").$type<IndexStatus>().default("pending").notNull(),
    indexError: text("index_error"),
    indexedAt: timestamp("indexed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    orgHashUnq: uniqueIndex("file_blob_org_hash_unq").on(table.orgId, table.contentHash),
    indexStatusIdx: index("file_blob_index_status_idx").on(table.indexStatus),
}));

/**
 * A room's reference to a blob.
 *
 * `projectId` is NOT NULL: an attachment without a project has no scope, and an
 * unscoped document is the leak this design exists to prevent.
 */
export const crewAttachments = pgTable("crew_attachments", {
    id: serial("id").primaryKey(),
    orgId: integer("org_id")
        .notNull()
        .references(() => orgs.id, { onDelete: "cascade" }),
    projectId: integer("project_id")
        .notNull()
        .references(() => projects.id, { onDelete: "cascade" }),
    sessionId: integer("session_id")
        .notNull()
        .references(() => crewSessions.id, { onDelete: "cascade" }),
    blobId: integer("blob_id")
        .notNull()
        .references(() => fileBlobs.id, { onDelete: "cascade" }),
    /** The name as uploaded HERE — one blob may carry different names per room. */
    displayName: text("display_name").notNull(),
    uploadedBy: text("uploaded_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
    sessionBlobUnq: uniqueIndex("crew_attachment_session_blob_unq").on(table.sessionId, table.blobId),
    sessionIdx: index("crew_attachment_session_idx").on(table.sessionId),
    projectIdx: index("crew_attachment_project_idx").on(table.projectId),
}));

export const insertFileBlobSchema = createInsertSchema(fileBlobs);
export const selectFileBlobSchema = createSelectSchema(fileBlobs);
export const insertCrewAttachmentSchema = createInsertSchema(crewAttachments);
export const selectCrewAttachmentSchema = createSelectSchema(crewAttachments);
