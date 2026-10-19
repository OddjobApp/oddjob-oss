/**
 * Scribe Versioning Service
 *
 * The Git-like layer over a manuscript: immutable content snapshots, a
 * per-document revision sequence, diffs between any two revisions, and
 * rollback that restores a snapshot as a new revision rather than rewriting
 * history.
 *
 * Why a second table when scribe_authoring_operations already logs every
 * write: the operation log records the *attempt* — who asked, what was
 * proposed, whether the write verified. It does not keep the resulting state,
 * so there is nothing to diff and nothing to restore. This service stores the
 * state. Every mutation path in scribe.service calls record*Revision after
 * the write lands, so the history is the ground truth of what the document
 * looked like — including the metadata columns a prose log would miss.
 */

import { db } from "@server/database_service.js";
import {
    scribeDocuments,
    scribeNodes,
    scribeRevisions,
    scribeReviews,
    type ScribeDocument,
    type ScribeNode,
    type ScribeRevision,
    type ScribeRevisionKind,
    type ScribeReview,
    type ScribeReviewStatus,
    type ScribeNodeSnapshot,
    type ScribeRevisionSnapshot,
} from "@shared/schema/index.js";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { authoringOperationService } from "./authoring-operation.service.js";

const logger = createLogger("ScribeVersioning");

export interface RevisionDiffChange {
    stationKey: string;
    title: string;
    status: "added" | "removed" | "modified" | "unchanged";
    before: string | null;
    after: string | null;
    wordDelta: number;
    /** Line-level diff, present when the content changed on both sides. */
    lines?: Array<{ type: "same" | "added" | "removed"; text: string }>;
}

export interface RevisionDiff {
    from: ScribeRevision;
    to: ScribeRevision;
    changes: RevisionDiffChange[];
}

/** The AI-system registry id and governance document links on a manuscript. */
export interface AiSystemMetadata {
    aiSystemId?: string | null;
    dataLineageGraphId?: number | null;
    biasMitigationStrategyDocumentId?: number | null;
    governancePolicyDocumentId?: number | null;
}

function nodeSnapshot(node: ScribeNode): ScribeNodeSnapshot {
    return {
        nodeId: node.id,
        stationKey: node.stationKey,
        title: node.title,
        sortOrder: node.sortOrder,
        content: node.content ?? "",
        contentRich: node.contentRich ?? null,
        wordCount: node.wordCount ?? 0,
        status: node.status,
    };
}

function wordCountOf(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * LCS line diff. Capped: past ~1,500 lines a side the quadratic cost buys a
 * prettier rendering of something nobody reads line-by-line, so the whole
 * block reports as replaced instead.
 */
export function diffLines(
    before: string,
    after: string,
): Array<{ type: "same" | "added" | "removed"; text: string }> {
    const a = before.split("\n");
    const b = after.split("\n");
    if (a.length * b.length > 2_250_000) {
        return [
            ...a.map((text) => ({ type: "removed" as const, text })),
            ...b.map((text) => ({ type: "added" as const, text })),
        ];
    }
    const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const out: Array<{ type: "same" | "added" | "removed"; text: string }> = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            out.push({ type: "same", text: a[i] });
            i++;
            j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            out.push({ type: "removed", text: a[i] });
            i++;
        } else {
            out.push({ type: "added", text: b[j] });
            j++;
        }
    }
    while (i < a.length) out.push({ type: "removed", text: a[i++] });
    while (j < b.length) out.push({ type: "added", text: b[j++] });
    return out;
}

class ScribeVersioningService {
    /** The next revision number for a document. Unique-indexed, so a caller
     *  racing another writer retries once rather than failing the save. */
    private async nextRevisionNumber(documentId: number): Promise<number> {
        const [row] = await db
            .select({ max: sql<number>`coalesce(max(${scribeRevisions.revisionNumber}), 0)` })
            .from(scribeRevisions)
            .where(eq(scribeRevisions.documentId, documentId));
        return (row?.max ?? 0) + 1;
    }

    private async insertRevision(
        values: Omit<typeof scribeRevisions.$inferInsert, "revisionNumber">,
    ): Promise<ScribeRevision> {
        for (let attempt = 0; attempt < 3; attempt++) {
            const revisionNumber = await this.nextRevisionNumber(values.documentId);
            try {
                const [row] = await db
                    .insert(scribeRevisions)
                    .values({ ...values, revisionNumber })
                    .returning();
                return row;
            } catch (err: any) {
                // Unique violation on (document_id, revision_number): another
                // writer took the number first. Recompute and try again.
                if (err?.code === "23505" && attempt < 2) continue;
                throw err;
            }
        }
        throw new Error("unreachable");
    }

    /** Load a document only if it belongs to the organization, mirroring
     *  scribe.service.requireDocument without importing it (which would be a
     *  circular dependency — the service calls back into this one). */
    private async requireDocument(documentId: number, organizationId: number): Promise<ScribeDocument> {
        const [doc] = await db
            .select()
            .from(scribeDocuments)
            .where(and(eq(scribeDocuments.id, documentId), eq(scribeDocuments.organizationId, organizationId)))
            .limit(1);
        if (!doc) {
            throw Object.assign(new Error(`Scribe document ${documentId} not found`), { status: 404 });
        }
        return doc;
    }

    /**
     * Record a station-level snapshot — the state the node is in now.
     * Called by every mutation path that leaves a node changed, added, or
     * about to be deleted (the snapshot is the last state either way).
     */
    async recordNodeRevision(
        node: ScribeNode,
        organizationId: number,
        opts: { kind: ScribeRevisionKind; actor?: string; message?: string },
    ): Promise<ScribeRevision> {
        const snapshot: ScribeRevisionSnapshot = { scope: "node", node: nodeSnapshot(node) };
        return this.insertRevision({
            organizationId,
            documentId: node.documentId,
            branchId: node.branchId,
            nodeId: node.id,
            scope: "node",
            kind: opts.kind,
            message: opts.message ?? null,
            actor: opts.actor ?? "author",
            snapshot,
        });
    }

    /**
     * Record a document-level snapshot — the document metadata plus every
     * station on the given (or active) branch.
     */
    async recordDocumentRevision(
        doc: ScribeDocument,
        organizationId: number,
        opts: { kind: ScribeRevisionKind; actor?: string; message?: string; branchId?: number },
    ): Promise<ScribeRevision> {
        const branchId = opts.branchId ?? doc.activeBranchId ?? null;
        const nodes = branchId
            ? await db
                  .select()
                  .from(scribeNodes)
                  .where(and(eq(scribeNodes.documentId, doc.id), eq(scribeNodes.branchId, branchId)))
                  .orderBy(asc(scribeNodes.sortOrder))
            : [];

        const snapshot: ScribeRevisionSnapshot = {
            scope: "document",
            document: {
                title: doc.title,
                archetypeMode: doc.archetypeMode,
                aiSystemId: doc.aiSystemId ?? null,
                dataLineageGraphId: doc.dataLineageGraphId ?? null,
                biasMitigationStrategyDocumentId: doc.biasMitigationStrategyDocumentId ?? null,
                governancePolicyDocumentId: doc.governancePolicyDocumentId ?? null,
                nodes: nodes.map(nodeSnapshot),
            },
        };

        return this.insertRevision({
            organizationId,
            documentId: doc.id,
            branchId,
            nodeId: null,
            scope: "document",
            kind: opts.kind,
            message: opts.message ?? null,
            actor: opts.actor ?? "author",
            snapshot,
        });
    }

    /** A named snapshot taken at the author's request — `git commit`. */
    async commitDocument(
        documentId: number,
        organizationId: number,
        opts: { message?: string; actor?: string; branchId?: number },
    ): Promise<ScribeRevision> {
        const doc = await this.requireDocument(documentId, organizationId);
        return this.recordDocumentRevision(doc, organizationId, {
            kind: "commit",
            message: opts.message || "Manual checkpoint",
            actor: opts.actor,
            branchId: opts.branchId,
        });
    }

    /** The revision history for a document, newest first. */
    async listRevisions(
        documentId: number,
        organizationId: number,
        opts: { nodeId?: number; limit?: number } = {},
    ): Promise<ScribeRevision[]> {
        await this.requireDocument(documentId, organizationId);
        const conditions = [
            eq(scribeRevisions.documentId, documentId),
            eq(scribeRevisions.organizationId, organizationId),
        ];
        if (opts.nodeId) conditions.push(eq(scribeRevisions.nodeId, opts.nodeId));
        return db
            .select()
            .from(scribeRevisions)
            .where(and(...conditions))
            .orderBy(desc(scribeRevisions.revisionNumber))
            .limit(Math.min(opts.limit ?? 100, 500));
    }

    /** A single revision, org-checked through its document. */
    async getRevision(revisionId: number, organizationId: number): Promise<ScribeRevision> {
        const [row] = await db
            .select({ revision: scribeRevisions })
            .from(scribeRevisions)
            .innerJoin(scribeDocuments, eq(scribeRevisions.documentId, scribeDocuments.id))
            .where(
                and(
                    eq(scribeRevisions.id, revisionId),
                    eq(scribeDocuments.organizationId, organizationId),
                ),
            )
            .limit(1);
        if (!row) {
            throw Object.assign(new Error(`Revision ${revisionId} not found`), { status: 404 });
        }
        return row.revision;
    }

    /** Snapshot → station map, regardless of scope. */
    private stationMap(revision: ScribeRevision): Map<string, ScribeNodeSnapshot> {
        const map = new Map<string, ScribeNodeSnapshot>();
        if (revision.snapshot.scope === "node") {
            map.set(revision.snapshot.node.stationKey, revision.snapshot.node);
        } else {
            for (const n of revision.snapshot.document.nodes) map.set(n.stationKey, n);
        }
        return map;
    }

    /**
     * Compare two revisions of the same document — `git diff`.
     *
     * Works across scopes: a station revision diffs as a one-entry change
     * list, a document revision diffs station-by-station over the union of
     * keys, so a branch snapshot can be compared to a single-station edit.
     */
    async diffRevisions(
        documentId: number,
        organizationId: number,
        fromRevisionId: number,
        toRevisionId: number,
    ): Promise<RevisionDiff> {
        await this.requireDocument(documentId, organizationId);
        const from = await this.getRevision(fromRevisionId, organizationId);
        const to = await this.getRevision(toRevisionId, organizationId);
        if (from.documentId !== documentId || to.documentId !== documentId) {
            throw Object.assign(new Error("Revisions belong to different documents"), { status: 400 });
        }

        const fromMap = this.stationMap(from);
        const toMap = this.stationMap(to);
        const keys = new Set([...fromMap.keys(), ...toMap.keys()]);
        const changes: RevisionDiffChange[] = [];

        for (const key of keys) {
            const before = fromMap.get(key);
            const after = toMap.get(key);
            const beforeText = before?.content ?? null;
            const afterText = after?.content ?? null;

            if (beforeText === afterText) {
                changes.push({
                    stationKey: key,
                    title: after?.title ?? before?.title ?? key,
                    status: "unchanged",
                    before: beforeText,
                    after: afterText,
                    wordDelta: 0,
                });
                continue;
            }

            const status = beforeText === null ? "added" : afterText === null ? "removed" : "modified";
            changes.push({
                stationKey: key,
                title: after?.title ?? before?.title ?? key,
                status,
                before: beforeText,
                after: afterText,
                wordDelta: wordCountOf(afterText ?? "") - wordCountOf(beforeText ?? ""),
                lines: status === "modified" ? diffLines(beforeText!, afterText!) : undefined,
            });
        }

        // Keep the manuscript's reading order where the snapshots have one.
        const orderOf = (key: string) =>
            toMap.get(key)?.sortOrder ?? fromMap.get(key)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
        changes.sort((a, b) => orderOf(a.stationKey) - orderOf(b.stationKey));

        return { from, to, changes };
    }

    /**
     * Restore a revision — `git revert`, not `git reset`.
     *
     * The snapshot's content is written back as a new change, and the restore
     * is itself recorded as a revision, so history stays append-only and the
     * rollback is visible in it. For a document snapshot, stations are matched
     * by stationKey: matching stations get the snapshotted text, stations the
     * snapshot knows but the branch does not (deleted since, or a reset that
     * wiped them) are recreated — which is what makes "undo the reset" work.
     * Stations the snapshot does not know are left alone.
     */
    async rollbackRevision(
        revisionId: number,
        organizationId: number,
        opts: { actor?: string } = {},
    ): Promise<{ restored: number; revision: ScribeRevision; documentId: number }> {
        const revision = await this.getRevision(revisionId, organizationId);
        const doc = await this.requireDocument(revision.documentId, organizationId);
        const actor = opts.actor ?? "author";

        if (revision.snapshot.scope === "node") {
            const snap = revision.snapshot.node;
            const targetBranchId = revision.branchId ?? doc.activeBranchId;
            if (!targetBranchId) {
                throw Object.assign(new Error("Document has no branch to restore into"), { status: 409 });
            }

            // Resolve the node to restore: the same row if it still exists,
            // else the station on the target branch, else recreate it.
            let [target] = await db
                .select()
                .from(scribeNodes)
                .where(and(eq(scribeNodes.id, snap.nodeId), eq(scribeNodes.documentId, doc.id)))
                .limit(1);
            if (!target) {
                [target] = await db
                    .select()
                    .from(scribeNodes)
                    .where(
                        and(
                            eq(scribeNodes.documentId, doc.id),
                            eq(scribeNodes.branchId, targetBranchId),
                            eq(scribeNodes.stationKey, snap.stationKey),
                        ),
                    )
                    .limit(1);
            }
            if (!target) {
                const [maxOrder] = await db
                    .select({ max: sql<number>`coalesce(max(${scribeNodes.sortOrder}), 0)` })
                    .from(scribeNodes)
                    .where(and(eq(scribeNodes.documentId, doc.id), eq(scribeNodes.branchId, targetBranchId)));
                [target] = await db
                    .insert(scribeNodes)
                    .values({
                        documentId: doc.id,
                        branchId: targetBranchId,
                        stationKey: snap.stationKey,
                        title: snap.title,
                        sortOrder: snap.sortOrder || (maxOrder?.max ?? 0) + 1,
                        content: "",
                        status: "draft",
                        continuityNotes: [],
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .returning();
            }

            const restored = await authoringOperationService.record(
                {
                    organizationId,
                    documentId: doc.id,
                    nodeId: target.id,
                    branchId: targetBranchId,
                    actor,
                    operation: "rollback",
                    request: `Restore station from revision r${revision.revisionNumber}`,
                    proposedContent: snap.content,
                },
                async () => {
                    const [updated] = await db
                        .update(scribeNodes)
                        .set({
                            content: snap.content,
                            contentRich: snap.contentRich ?? undefined,
                            title: snap.title,
                            status: (snap.status as ScribeNode["status"]) || "draft",
                            wordCount: wordCountOf(snap.content),
                            updatedAt: new Date(),
                        })
                        .where(eq(scribeNodes.id, target.id))
                        .returning();
                    return updated;
                },
                (updated) => ({ nodeId: target.id, expectedContent: updated?.content ?? null }),
            );

            const newRevision = await this.recordNodeRevision(restored, organizationId, {
                kind: "rollback",
                actor,
                message: `Restored "${snap.title}" from revision r${revision.revisionNumber}`,
            });
            return { restored: 1, revision: newRevision, documentId: doc.id };
        }

        // Document-scope rollback: restore every station the snapshot knows.
        const snapDoc = revision.snapshot.document;
        const targetBranchId = revision.branchId ?? doc.activeBranchId;
        if (!targetBranchId) {
            throw Object.assign(new Error("Document has no branch to restore into"), { status: 409 });
        }

        const current = await db
            .select()
            .from(scribeNodes)
            .where(and(eq(scribeNodes.documentId, doc.id), eq(scribeNodes.branchId, targetBranchId)));

        const byKey = new Map(current.map((n) => [n.stationKey, n]));
        let restored = 0;
        const maxOrder = current.reduce((m, n) => Math.max(m, n.sortOrder), 0);
        let appendOrder = maxOrder;

        for (const snap of snapDoc.nodes) {
            const existing = byKey.get(snap.stationKey);
            if (existing) {
                if (existing.content !== snap.content || existing.title !== snap.title || existing.status !== snap.status) {
                    await db
                        .update(scribeNodes)
                        .set({
                            content: snap.content,
                            contentRich: snap.contentRich ?? undefined,
                            title: snap.title,
                            sortOrder: snap.sortOrder || existing.sortOrder,
                            status: (snap.status as ScribeNode["status"]) || "draft",
                            wordCount: wordCountOf(snap.content),
                            updatedAt: new Date(),
                        })
                        .where(eq(scribeNodes.id, existing.id));
                    restored++;
                }
            } else {
                await db.insert(scribeNodes).values({
                    documentId: doc.id,
                    branchId: targetBranchId,
                    stationKey: snap.stationKey,
                    title: snap.title,
                    sortOrder: snap.sortOrder || ++appendOrder,
                    content: snap.content,
                    contentRich: snap.contentRich,
                    wordCount: wordCountOf(snap.content),
                    status: (snap.status as ScribeNode["status"]) || "draft",
                    continuityNotes: [],
                    createdAt: new Date(),
                    updatedAt: new Date(),
                });
                restored++;
            }
        }

        // The metadata is part of the snapshot too: restore the title and the
        // AI-system linkage, not just the prose.
        await db
            .update(scribeDocuments)
            .set({
                title: snapDoc.title,
                aiSystemId: snapDoc.aiSystemId,
                dataLineageGraphId: snapDoc.dataLineageGraphId,
                biasMitigationStrategyDocumentId: snapDoc.biasMitigationStrategyDocumentId,
                governancePolicyDocumentId: snapDoc.governancePolicyDocumentId,
                updatedAt: new Date(),
            })
            .where(eq(scribeDocuments.id, doc.id));

        const [freshDoc] = await db
            .select()
            .from(scribeDocuments)
            .where(eq(scribeDocuments.id, doc.id))
            .limit(1);

        const newRevision = await this.recordDocumentRevision(freshDoc, organizationId, {
            kind: "rollback",
            actor,
            message: `Restored document from revision r${revision.revisionNumber} (${restored} stations)`,
            branchId: targetBranchId,
        });
        return { restored, revision: newRevision, documentId: doc.id };
    }

    /**
     * Update the AI-system registry id and governance document links.
     *
     * The three document references are validated to be manuscripts in the
     * same organization — a link into another tenant's documents is a broken
     * reference at best and an information disclosure at worst. The change is
     * recorded as a metadata revision, because the audit requirement covers
     * these fields changing, not only the prose.
     */
    async updateAiSystemMetadata(
        documentId: number,
        organizationId: number,
        patch: AiSystemMetadata,
        opts: { actor?: string } = {},
    ): Promise<ScribeDocument> {
        const doc = await this.requireDocument(documentId, organizationId);

        const refFields = [
            "dataLineageGraphId",
            "biasMitigationStrategyDocumentId",
            "governancePolicyDocumentId",
        ] as const;
        for (const field of refFields) {
            const ref = patch[field];
            if (ref !== undefined && ref !== null) {
                const [target] = await db
                    .select({ id: scribeDocuments.id })
                    .from(scribeDocuments)
                    .where(and(eq(scribeDocuments.id, ref), eq(scribeDocuments.organizationId, organizationId)))
                    .limit(1);
                if (!target) {
                    throw Object.assign(
                        new Error(`Referenced document #${ref} not found in this organization`),
                        { status: 400 },
                    );
                }
            }
        }

        const changed = refFields.filter((f) => patch[f] !== undefined && patch[f] !== doc[f]);
        const aiChanged = patch.aiSystemId !== undefined && patch.aiSystemId !== doc.aiSystemId;
        if (!aiChanged && changed.length === 0) return doc;

        const [updated] = await db
            .update(scribeDocuments)
            .set({
                ...(patch.aiSystemId !== undefined ? { aiSystemId: patch.aiSystemId } : {}),
                ...(patch.dataLineageGraphId !== undefined
                    ? { dataLineageGraphId: patch.dataLineageGraphId }
                    : {}),
                ...(patch.biasMitigationStrategyDocumentId !== undefined
                    ? { biasMitigationStrategyDocumentId: patch.biasMitigationStrategyDocumentId }
                    : {}),
                ...(patch.governancePolicyDocumentId !== undefined
                    ? { governancePolicyDocumentId: patch.governancePolicyDocumentId }
                    : {}),
                updatedAt: new Date(),
            })
            .where(eq(scribeDocuments.id, documentId))
            .returning();

        await this.recordDocumentRevision(updated, organizationId, {
            kind: "metadata",
            actor: opts.actor,
            message: `AI-system metadata updated${aiChanged ? ` (ai_system_id → ${patch.aiSystemId ?? "none"})` : ""}`,
        });

        return updated;
    }

    // ── Review & Approval ────────────────────────────────────────────────────

    /**
     * Open a review over a station or the whole document.
     *
     * The review pins the revision the reviewer is being asked to read, so an
     * approval speaks for the text as it was then — not whatever the station
     * says by the time anyone reads the decision. For a station the latest
     * revision is reused if one exists; if the node has never been snapshotted
     * one is taken now.
     */
    async requestReview(
        documentId: number,
        organizationId: number,
        opts: { nodeId?: number; requestedBy: string; note?: string },
    ): Promise<ScribeReview> {
        await this.requireDocument(documentId, organizationId);

        let node: ScribeNode | undefined;
        if (opts.nodeId) {
            const [row] = await db
                .select()
                .from(scribeNodes)
                .where(and(eq(scribeNodes.id, opts.nodeId), eq(scribeNodes.documentId, documentId)))
                .limit(1);
            if (!row) {
                throw Object.assign(new Error(`Node #${opts.nodeId} not found on document ${documentId}`), { status: 404 });
            }
            node = row;
        }

        let pinned: ScribeRevision;
        if (node) {
            const [latest] = await db
                .select()
                .from(scribeRevisions)
                .where(
                    and(
                        eq(scribeRevisions.documentId, documentId),
                        eq(scribeRevisions.nodeId, node.id),
                        eq(scribeRevisions.scope, "node"),
                    ),
                )
                .orderBy(desc(scribeRevisions.revisionNumber))
                .limit(1);
            pinned =
                latest ??
                (await this.recordNodeRevision(node, organizationId, {
                    kind: "review_request",
                    actor: opts.requestedBy,
                    message: "Pinned for review",
                }));
        } else {
            const doc = await this.requireDocument(documentId, organizationId);
            pinned = await this.recordDocumentRevision(doc, organizationId, {
                kind: "review_request",
                actor: opts.requestedBy,
                message: "Document pinned for review",
            });
        }

        const [review] = await db
            .insert(scribeReviews)
            .values({
                organizationId,
                documentId,
                nodeId: node?.id ?? null,
                revisionId: pinned.id,
                requestedBy: opts.requestedBy,
                requestNote: opts.note ?? null,
                status: "pending",
                createdAt: new Date(),
            })
            .returning();

        if (node) {
            await db
                .update(scribeNodes)
                .set({ status: "in_review", updatedAt: new Date() })
                .where(eq(scribeNodes.id, node.id));
        }

        return review;
    }

    /**
     * Decide a pending review. Approval moves the station (or every station on
     * the active branch, for a document-level review) to "approved"; a request
     * for changes sends it back to "draft".
     */
    async decideReview(
        reviewId: number,
        organizationId: number,
        opts: { decision: "approved" | "changes_requested"; reviewer: string; note?: string },
    ): Promise<ScribeReview> {
        const [row] = await db
            .select({ review: scribeReviews })
            .from(scribeReviews)
            .innerJoin(scribeDocuments, eq(scribeReviews.documentId, scribeDocuments.id))
            .where(and(eq(scribeReviews.id, reviewId), eq(scribeDocuments.organizationId, organizationId)))
            .limit(1);
        if (!row) {
            throw Object.assign(new Error(`Review ${reviewId} not found`), { status: 404 });
        }
        if (row.review.status !== "pending") {
            throw Object.assign(new Error(`Review ${reviewId} is already ${row.review.status}`), { status: 409 });
        }

        const [review] = await db
            .update(scribeReviews)
            .set({
                status: opts.decision,
                reviewer: opts.reviewer,
                decisionNote: opts.note ?? null,
                decidedAt: new Date(),
            })
            .where(eq(scribeReviews.id, reviewId))
            .returning();

        const nextStatus: ScribeNode["status"] = opts.decision === "approved" ? "approved" : "draft";
        if (review.nodeId) {
            await db
                .update(scribeNodes)
                .set({ status: nextStatus, updatedAt: new Date() })
                .where(eq(scribeNodes.id, review.nodeId));
        } else {
            const [doc] = await db
                .select({ activeBranchId: scribeDocuments.activeBranchId })
                .from(scribeDocuments)
                .where(eq(scribeDocuments.id, review.documentId))
                .limit(1);
            if (doc?.activeBranchId) {
                await db
                    .update(scribeNodes)
                    .set({ status: nextStatus, updatedAt: new Date() })
                    .where(
                        and(
                            eq(scribeNodes.documentId, review.documentId),
                            eq(scribeNodes.branchId, doc.activeBranchId),
                        ),
                    );
            }
        }

        return review;
    }

    /** Reviews for a document, newest first. */
    async listReviews(
        documentId: number,
        organizationId: number,
        opts: { status?: ScribeReviewStatus } = {},
    ): Promise<ScribeReview[]> {
        await this.requireDocument(documentId, organizationId);
        const conditions = [
            eq(scribeReviews.documentId, documentId),
            eq(scribeReviews.organizationId, organizationId),
        ];
        if (opts.status) conditions.push(eq(scribeReviews.status, opts.status));
        return db
            .select()
            .from(scribeReviews)
            .where(and(...conditions))
            .orderBy(desc(scribeReviews.createdAt))
            .limit(200);
    }
}

export const scribeVersioningService = new ScribeVersioningService();
