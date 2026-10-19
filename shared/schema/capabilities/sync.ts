/**
 * Capability sync state — the reconciler's durable memory.
 *
 * Replaces the Python reference engine's on-disk JSON state file with a
 * transactional, org-scoped table so the code⇄docs reconciliation is safe
 * across the multi-node worker fleet (no split-brain, no lost updates).
 *
 * Two tables:
 *   - `capability_sync_state`  — per-capability drift keys + changelog revision.
 *   - `capability_doc_file_state` — per-Markdown-file hash so Path B (docs→code)
 *     can cheaply skip files it (or the code→docs path) already processed,
 *     which is what breaks the bi-directional update loop.
 */

import { pgTable, serial, text, integer, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { orgs } from "../auth.js";

export const capabilitySyncState = pgTable(
    "capability_sync_state",
    {
        id: serial("id").primaryKey(),
        organizationId: integer("organization_id")
            .notNull()
            .references(() => orgs.id, { onDelete: "cascade" }),
        capabilityId: text("capability_id").notNull(),
        schemaVersion: integer("schema_version").default(1).notNull(),
        capabilityVersion: text("capability_version").default("1.0.0").notNull(),
        /** Hash of the behavioural signature — gates registry/router writes. */
        signatureHash: text("signature_hash").notNull(),
        /** Hash of the full canonical manifest — detects any change at all. */
        contentHash: text("content_hash").notNull(),
        /** Hash of the last compiled/ingested Markdown doc — fast loop break. */
        docHash: text("doc_hash"),
        /** Which side last authored the current state: 'code' | 'docs'. */
        lastSource: text("last_source").notNull(),
        /** Monotonic changelog revision, bumped on every applied drift. */
        revision: integer("revision").default(1).notNull(),
        /** The stored signature object, used to compute field-level diffs. */
        signature: jsonb("signature").notNull(),
        /** Full normalized manifest used to distinguish documentation drift. */
        manifest: jsonb("manifest"),
        /** Cached risk profile so status reports don't re-derive it. */
        riskProfile: text("risk_profile").default("Low").notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
    },
    (t) => [
        uniqueIndex("capability_sync_state_org_cap_idx").on(t.organizationId, t.capabilityId),
        index("capability_sync_state_signature_idx").on(t.signatureHash),
    ],
);

export const capabilityDocFileState = pgTable(
    "capability_doc_file_state",
    {
        id: serial("id").primaryKey(),
        organizationId: integer("organization_id")
            .notNull()
            .references(() => orgs.id, { onDelete: "cascade" }),
        /** Repo-relative path of the Markdown artifact, e.g. docs/capabilities/x.md. */
        docPath: text("doc_path").notNull(),
        fileHash: text("file_hash").notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
    },
    (t) => [uniqueIndex("capability_doc_file_state_org_path_idx").on(t.organizationId, t.docPath)],
);

export const insertCapabilitySyncStateSchema = createInsertSchema(capabilitySyncState).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export const insertCapabilityDocFileStateSchema = createInsertSchema(capabilityDocFileState).omit({
    id: true,
    updatedAt: true,
});

export type CapabilitySyncStateRow = typeof capabilitySyncState.$inferSelect;
export type CapabilityDocFileStateRow = typeof capabilityDocFileState.$inferSelect;
export type SyncSource = "code" | "docs";
