import { index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { orgs } from "../auth.js";
import type { CapabilityManifest } from "./manifest.js";

export type CapabilityProposalClassification = "missing" | "enhancement" | "composition" | "retirement";
export type CapabilityProposalStatus = "proposed" | "promoted" | "rejected";

export interface CapabilityProposalEvidence {
    source: string;
    summary: string;
    reference?: string;
    observedAt?: string;
    weight?: number;
}

export interface SimilarCapabilityEvidence {
    capabilityId: string;
    score: number;
    displayName?: string;
}

/**
 * Whether `similarCapabilities` is authoritative.
 *
 * An empty `similarCapabilities` array means "no duplicates" ONLY when this is
 * `available`. When it is `unavailable` the similarity search could not run
 * (the embedding provider returns null rather than throwing), and the empty
 * array carries no information — scoring must withhold the duplicate penalty
 * rather than award a clean result.
 */
export type CapabilitySimilarityStatus = "available" | "unavailable";

/** Durable, governed output of Evolution capability discovery. */
export const capabilityProposals = pgTable(
    "capability_proposals",
    {
        id: serial("id").primaryKey(),
        organizationId: integer("organization_id")
            .notNull()
            .references(() => orgs.id, { onDelete: "cascade" }),
        proposalKey: text("proposal_key").notNull(),
        proposedCapabilityId: text("proposed_capability_id").notNull(),
        classification: text("classification").$type<CapabilityProposalClassification>().notNull(),
        title: text("title").notNull(),
        rationale: text("rationale").notNull(),
        status: text("status").$type<CapabilityProposalStatus>().default("proposed").notNull(),
        confidence: integer("confidence").default(0).notNull(),
        source: text("source").notNull(),
        evidence: jsonb("evidence").$type<CapabilityProposalEvidence[]>().default([]).notNull(),
        similarCapabilities: jsonb("similar_capabilities").$type<SimilarCapabilityEvidence[]>().default([]).notNull(),
        // Defaults to "unavailable" so a row written by a code path that does not
        // yet set it cannot be mistaken for a confirmed no-duplicate result.
        similarityStatus: text("similarity_status")
            .$type<CapabilitySimilarityStatus>()
            .default("unavailable")
            .notNull(),
        proposedManifest: jsonb("proposed_manifest").$type<CapabilityManifest>(),
        promotionResult: jsonb("promotion_result").$type<Record<string, unknown>>(),
        createdBy: text("created_by").notNull(),
        reviewedBy: text("reviewed_by"),
        reviewNote: text("review_note"),
        reviewedAt: timestamp("reviewed_at"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull(),
    },
    (table) => [
        uniqueIndex("capability_proposals_org_key_unique").on(table.organizationId, table.proposalKey),
        index("capability_proposals_org_status_idx").on(table.organizationId, table.status),
        index("capability_proposals_capability_idx").on(table.proposedCapabilityId),
    ],
);

export type CapabilityProposal = typeof capabilityProposals.$inferSelect;
export type InsertCapabilityProposal = typeof capabilityProposals.$inferInsert;

