/**
 * Recording, and then verifying, every attempt to change a manuscript.
 *
 * The motivating pattern from this codebase, three times over: a write reports
 * success and the document does not change. scribe_update_node returned the
 * string "Error updating Scribe station: Node #1 not found" and the crew harness
 * recorded {ok: true, ms: 3}. The canvas rendered a green "Synced" check before
 * its request had been sent. Export replied 200 and produced no file. In each
 * case the caller's own report was the only evidence, and it was wrong.
 *
 * So this does not ask the writer whether it worked. It reads the row back and
 * compares. `verified` is set from that comparison and from nothing else, which
 * makes it the one field in the system that cannot be satisfied by a function
 * returning normally.
 *
 * The record also keeps commentary and document content in different columns.
 * `request` is what a person or agent asked for; `proposedContent` is what is
 * meant to appear in the manuscript. Collapsing the two is how "I am the Copilot.
 * I defer to the GhostWriter for content generation" was inserted into a document
 * as though it were prose.
 */

import { db } from "@server/database_service.js";
import {
    scribeAuthoringOperations,
    scribeNodes,
    type ScribeAuthoringOperation,
    type ScribeAuthoringOperationStatus,
    type ScribeSourceReference,
} from "@shared/schema/index.js";
import { and, desc, eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ScribeAuthoringOperations");

export interface BeginOperationInput {
    organizationId: number;
    documentId: number;
    nodeId?: number | null;
    branchId?: number | null;
    sessionId?: number | null;
    turnId?: number | null;
    /** Who asked: an agent card name, a user id, or "author". */
    actor: string;
    /** The verb — update_node, configure_stations, add_toc, crystallize. */
    operation: string;
    /** What was asked for, in the asker's words. Never document content. */
    request?: string | null;
    constraints?: Record<string, unknown>;
    /** The prose intended for the manuscript. Never commentary. */
    proposedContent?: string | null;
    targetRevision?: number | null;
    sources?: ScribeSourceReference[];
}

export class AuthoringOperationService {
    /**
     * Open the record before attempting the change.
     *
     * Before, not after, so an operation that throws halfway still leaves a row
     * saying it was attempted. A log written only on success describes a world
     * in which nothing ever fails.
     */
    async begin(input: BeginOperationInput): Promise<ScribeAuthoringOperation> {
        const [row] = await db
            .insert(scribeAuthoringOperations)
            .values({
                organizationId: input.organizationId,
                documentId: input.documentId,
                nodeId: input.nodeId ?? null,
                branchId: input.branchId ?? null,
                sessionId: input.sessionId ?? null,
                turnId: input.turnId ?? null,
                actor: input.actor,
                operation: input.operation,
                request: input.request ?? null,
                constraints: input.constraints ?? {},
                proposedContent: input.proposedContent ?? null,
                targetRevision: input.targetRevision ?? null,
                sources: input.sources ?? [],
                status: "proposed",
            })
            .returning();
        return row;
    }

    /**
     * Close the record by reading the document back.
     *
     * `expectedContent` is compared against what the station actually holds now.
     * Only that comparison sets `verified` — not the absence of an exception,
     * and not the writer's own say-so.
     *
     * Whitespace is normalised on both sides before comparing. A save that
     * round-trips through markdown can legitimately gain or lose a trailing
     * newline, and failing verification over that would teach everyone to
     * ignore the flag, which is worse than not having it.
     */
    async settleApplied(
        operationId: number,
        opts: { nodeId?: number | null; expectedContent?: string | null; appliedRevision?: number | null } = {},
    ): Promise<ScribeAuthoringOperation> {
        let verified = false;

        if (opts.nodeId && opts.expectedContent != null) {
            const [node] = await db
                .select({ content: scribeNodes.content })
                .from(scribeNodes)
                .where(eq(scribeNodes.id, opts.nodeId))
                .limit(1);
            verified = normalize(node?.content) === normalize(opts.expectedContent);

            if (!verified) {
                // Loud on purpose: the write returned without throwing and the
                // document still disagrees, which is the exact failure this
                // table exists to make visible.
                logger.warn(
                    `[AuthoringOperation] #${operationId} reported success but node ${opts.nodeId} does not match the proposed content.`,
                );
            }
        }

        return this.close(operationId, verified ? "applied" : "failed", {
            appliedRevision: opts.appliedRevision ?? null,
            failureReason: verified
                ? null
                : opts.nodeId && opts.expectedContent != null
                  ? "The write returned successfully but the stored content does not match what was proposed."
                  : null,
            verified,
        });
    }

    /** Close a record whose attempt failed, with the reason it failed. */
    async settleFailed(operationId: number, reason: string): Promise<ScribeAuthoringOperation> {
        return this.close(operationId, "failed", { failureReason: reason.slice(0, 2000), verified: false });
    }

    /** Close a record for a proposal a reviewer declined. */
    async settleRejected(operationId: number, reason?: string): Promise<ScribeAuthoringOperation> {
        return this.close(operationId, "rejected", {
            failureReason: reason?.slice(0, 2000) ?? null,
            verified: false,
        });
    }

    private async close(
        operationId: number,
        status: ScribeAuthoringOperationStatus,
        extra: { appliedRevision?: number | null; failureReason?: string | null; verified: boolean },
    ): Promise<ScribeAuthoringOperation> {
        const [row] = await db
            .update(scribeAuthoringOperations)
            .set({
                status,
                verified: extra.verified,
                failureReason: extra.failureReason ?? null,
                appliedRevision: extra.appliedRevision ?? null,
                settledAt: new Date(),
            })
            .where(eq(scribeAuthoringOperations.id, operationId))
            .returning();
        if (!row) throw new Error(`Authoring operation ${operationId} not found`);
        return row;
    }

    /** The operation history for a document, newest first. */
    async listForDocument(
        documentId: number,
        organizationId: number,
        limit = 50,
    ): Promise<ScribeAuthoringOperation[]> {
        return db
            .select()
            .from(scribeAuthoringOperations)
            .where(
                and(
                    eq(scribeAuthoringOperations.documentId, documentId),
                    eq(scribeAuthoringOperations.organizationId, organizationId),
                ),
            )
            .orderBy(desc(scribeAuthoringOperations.createdAt))
            .limit(limit);
    }

    /**
     * Operations that did not end in a verified write.
     *
     * The question this table was built to answer: what was attempted on this
     * document that did not take effect?
     */
    async listUnverified(
        documentId: number,
        organizationId: number,
    ): Promise<ScribeAuthoringOperation[]> {
        const rows = await this.listForDocument(documentId, organizationId, 200);
        return rows.filter((r) => r.status !== "applied" || !r.verified);
    }

    /**
     * Run a mutation inside a record.
     *
     * The wrapper exists so the record cannot drift from the write: there is no
     * path that mutates the document without also settling its operation,
     * including when the mutation throws.
     */
    async record<T>(
        input: BeginOperationInput,
        mutate: () => Promise<T>,
        verify?: (result: T) => { nodeId?: number | null; expectedContent?: string | null; appliedRevision?: number | null },
    ): Promise<T> {
        const op = await this.begin(input);
        try {
            const result = await mutate();
            await this.settleApplied(op.id, verify ? verify(result) : {});
            return result;
        } catch (err: any) {
            await this.settleFailed(op.id, err?.message ?? String(err));
            throw err;
        }
    }
}

/** Trailing whitespace differences are not content differences. */
function normalize(text: string | null | undefined): string {
    return (text ?? "").replace(/\r\n/g, "\n").trim();
}

export const authoringOperationService = new AuthoringOperationService();
