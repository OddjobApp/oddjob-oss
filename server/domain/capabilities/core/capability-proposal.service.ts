import { and, desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";

import { db } from "@server/database_service.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import {
    CAPABILITY_ID_PATTERN,
    capabilityProposals,
    safeParseCapabilityManifest,
    type CapabilityManifest,
    type CapabilityProposal,
    type CapabilityProposalClassification,
    type CapabilityProposalEvidence,
    type CapabilitySimilarityStatus,
} from "@shared/schema/capabilities/index.js";
import { capabilityRegistry } from "./capability-registry.service.js";
import { codeToDocsPipeline } from "./code-to-docs.pipeline.js";

const logger = createLogger("CapabilityProposalService");

export interface CreateCapabilityProposalInput {
    proposalKey?: string;
    proposedCapabilityId: string;
    classification: CapabilityProposalClassification;
    title: string;
    rationale: string;
    confidence: number;
    source: string;
    evidence: CapabilityProposalEvidence[];
    proposedManifest?: CapabilityManifest | Record<string, unknown> | null;
    createdBy: string;
}

function stableProposalKey(input: CreateCapabilityProposalInput): string {
    if (input.proposalKey?.trim()) return input.proposalKey.trim();
    return createHash("sha256")
        .update(`${input.source}:${input.classification}:${input.proposedCapabilityId}:${input.rationale}`)
        .digest("hex");
}

function validateInput(input: CreateCapabilityProposalInput): CapabilityManifest | null {
    if (!CAPABILITY_ID_PATTERN.test(input.proposedCapabilityId)) {
        throw new BadRequestError("proposedCapabilityId must match ^[a-z0-9_]+$");
    }
    if (!input.title.trim() || !input.rationale.trim() || !input.source.trim()) {
        throw new BadRequestError("title, rationale, and source are required");
    }
    if (!Number.isInteger(input.confidence) || input.confidence < 0 || input.confidence > 100) {
        throw new BadRequestError("confidence must be an integer from 0 to 100");
    }
    if (!input.proposedManifest) return null;
    const parsed = safeParseCapabilityManifest(input.proposedManifest);
    if (!parsed.success) {
        throw new BadRequestError(`Invalid proposed manifest: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
    }
    if (parsed.data.capability_id !== input.proposedCapabilityId) {
        throw new BadRequestError("proposed manifest capability_id must match proposedCapabilityId");
    }
    return parsed.data;
}

export class CapabilityProposalService {
    async create(organizationId: number, input: CreateCapabilityProposalInput): Promise<CapabilityProposal> {
        const manifest = validateInput(input);
        let similarCapabilities: CapabilityProposal["similarCapabilities"] = [];
        // Fail closed on the RESULT while staying available for the WRITE.
        //
        // Proposal persistence must survive a degraded vector store, but the
        // degradation has to be recorded: an empty `similarCapabilities` written
        // while similarity was unavailable is otherwise indistinguishable from a
        // confirmed "no duplicates", and the prioritizer would award full score
        // to a duplicate exactly when deduplication is broken.
        let similarityStatus: CapabilitySimilarityStatus = "unavailable";
        try {
            const query = `${input.title}. ${input.rationale}`;
            const outcome = await capabilityRegistry.discoverWithStatus(organizationId, query, 5);
            similarityStatus = outcome.status;
            similarCapabilities = outcome.results.map((hit) => ({
                capabilityId: hit.capabilityId,
                score: hit.score,
                displayName: hit.manifest.metadata.display_name,
            }));
        } catch (error) {
            // Search-layer failure (Qdrant unreachable, malformed response).
            // Same rule: persist the proposal, but never as a clean result.
            similarityStatus = "unavailable";
            similarCapabilities = [];
            logger.warn(
                `Similarity check unavailable for proposal '${input.proposedCapabilityId}' (org ${organizationId}); persisting with similarityStatus=unavailable: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }

        const values = {
            organizationId,
            proposalKey: stableProposalKey(input),
            proposedCapabilityId: input.proposedCapabilityId,
            classification: input.classification,
            title: input.title.trim(),
            rationale: input.rationale.trim(),
            confidence: input.confidence,
            source: input.source.trim(),
            evidence: input.evidence ?? [],
            similarCapabilities,
            similarityStatus,
            proposedManifest: manifest,
            createdBy: input.createdBy,
            updatedAt: new Date(),
        } as const;

        const [proposal] = await db
            .insert(capabilityProposals)
            .values(values)
            .onConflictDoUpdate({
                target: [capabilityProposals.organizationId, capabilityProposals.proposalKey],
                set: {
                    title: values.title,
                    rationale: values.rationale,
                    confidence: values.confidence,
                    evidence: values.evidence,
                    similarCapabilities: values.similarCapabilities,
                    similarityStatus: values.similarityStatus,
                    proposedManifest: values.proposedManifest,
                    updatedAt: values.updatedAt,
                },
            })
            .returning();
        return proposal;
    }

    async list(organizationId: number, status?: CapabilityProposal["status"]): Promise<CapabilityProposal[]> {
        const where = status
            ? and(eq(capabilityProposals.organizationId, organizationId), eq(capabilityProposals.status, status))
            : eq(capabilityProposals.organizationId, organizationId);
        return db.select().from(capabilityProposals).where(where).orderBy(desc(capabilityProposals.updatedAt));
    }

    async promote(organizationId: number, proposalId: number, reviewedBy: string, reviewNote?: string): Promise<CapabilityProposal> {
        const proposal = await this.get(organizationId, proposalId);
        if (proposal.status !== "proposed") throw new BadRequestError(`Proposal is already ${proposal.status}`);
        if (!proposal.proposedManifest) throw new BadRequestError("Proposal has no valid manifest to promote");

        const result = await codeToDocsPipeline.run(organizationId, proposal.proposedManifest);
        const [updated] = await db
            .update(capabilityProposals)
            .set({
                status: "promoted",
                reviewedBy,
                reviewNote: reviewNote?.trim() || null,
                reviewedAt: new Date(),
                promotionResult: result as unknown as Record<string, unknown>,
                updatedAt: new Date(),
            })
            .where(and(eq(capabilityProposals.id, proposalId), eq(capabilityProposals.organizationId, organizationId)))
            .returning();
        return updated;
    }

    async reject(organizationId: number, proposalId: number, reviewedBy: string, reviewNote: string): Promise<CapabilityProposal> {
        const proposal = await this.get(organizationId, proposalId);
        if (proposal.status !== "proposed") throw new BadRequestError(`Proposal is already ${proposal.status}`);
        if (!reviewNote?.trim()) throw new BadRequestError("A review note is required when rejecting a proposal");
        const [updated] = await db
            .update(capabilityProposals)
            .set({ status: "rejected", reviewedBy, reviewNote: reviewNote.trim(), reviewedAt: new Date(), updatedAt: new Date() })
            .where(and(eq(capabilityProposals.id, proposalId), eq(capabilityProposals.organizationId, organizationId)))
            .returning();
        return updated;
    }

    private async get(organizationId: number, proposalId: number): Promise<CapabilityProposal> {
        const [proposal] = await db
            .select()
            .from(capabilityProposals)
            .where(and(eq(capabilityProposals.id, proposalId), eq(capabilityProposals.organizationId, organizationId)))
            .limit(1);
        if (!proposal) throw new NotFoundError("Capability proposal not found");
        return proposal;
    }
}

export const capabilityProposalService = new CapabilityProposalService();
