/**
 * Version history against a real database.
 *
 * The unit suite scripts the query results; here the claims that need a real
 * Postgres get proven: snapshot rows actually land, a rollback restores text
 * as a NEW revision rather than erasing the old ones, the review lifecycle
 * flips the station's status, and every lookup refuses another tenant's ids.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { scribeService } from "../core/scribe.service.js";
import { scribeVersioningService } from "../core/scribe-versioning.service.js";
import { db } from "@server/database_service.js";
import { crewSessions, scribeDocuments, scribeNodes } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Post-write revision recording is fire-and-forget — poll briefly for it. */
async function waitForRevisions(documentId: number, orgId: number, min: number) {
    for (let i = 0; i < 40; i++) {
        const revs = await scribeVersioningService.listRevisions(documentId, orgId);
        if (revs.length >= min) return revs;
        await sleep(50);
    }
    return scribeVersioningService.listRevisions(documentId, orgId);
}

describe("Scribe version history", () => {
    const orgId = 1;
    const otherOrgId = 2;
    let sessionId: number;
    let documentId: number;
    let branchId: number;

    beforeAll(async () => {
        const [session] = await db
            .insert(crewSessions)
            .values({
                organizationId: orgId,
                sessionKey: `test-scribe-versioning-${Date.now()}`,
                title: "Versioning Test Room",
                status: "active",
                mode: "explore",
                createdBy: "test_runner",
            })
            .returning();
        sessionId = session.id;

        const view = await scribeService.createOrGetDocument(sessionId, orgId, "Versioned Manuscript", "freeform");
        documentId = view.document.id;
        branchId = view.activeBranch.id;
    });

    afterAll(async () => {
        if (documentId) {
            await db.delete(scribeDocuments).where(eq(scribeDocuments.id, documentId));
        }
        if (sessionId) {
            await db.delete(crewSessions).where(eq(crewSessions.id, sessionId));
        }
    });

    it("records the initial commit when a document is created", async () => {
        const revs = await waitForRevisions(documentId, orgId, 1);
        expect(revs[0]).toMatchObject({ kind: "commit", scope: "document", revisionNumber: 1 });
        expect(revs[0].snapshot.scope === "document" ? revs[0].snapshot.document.nodes.length : 0).toBeGreaterThan(0);
    });

    it("snapshots a station edit, diffs it, and rolls it back as a new revision", async () => {
        const before = await scribeVersioningService.commitDocument(documentId, orgId, {
            message: "before the edit",
        });

        const [node] = await db
            .select()
            .from(scribeNodes)
            .where(eq(scribeNodes.documentId, documentId))
            .limit(1);

        await scribeService.updateNodeContent(node.id, orgId, "Replaced prose for the diff test.", undefined, undefined);
        const revs = await waitForRevisions(documentId, orgId, 3);
        const edit = revs.find((r) => r.scope === "node" && r.nodeId === node.id);
        expect(edit).toBeDefined();

        const diff = await scribeVersioningService.diffRevisions(documentId, orgId, before.id, edit!.id);
        const change = diff.changes.find((c) => c.stationKey === node.stationKey);
        expect(change?.status).toBe("modified");
        expect(change?.after).toBe("Replaced prose for the diff test.");

        const { revision: rollback } = await scribeVersioningService.rollbackRevision(before.id, orgId, {
            actor: "test_runner",
        });
        expect(rollback.kind).toBe("rollback");

        const [restored] = await db.select().from(scribeNodes).where(eq(scribeNodes.id, node.id));
        expect(restored.content).toBe(change?.before ?? node.content);

        // History is append-only: the earlier revisions are all still there.
        const after = await scribeVersioningService.listRevisions(documentId, orgId);
        expect(after.map((r) => r.id)).toEqual(expect.arrayContaining([before.id, edit!.id, rollback.id]));
        expect(after[0].revisionNumber).toBeGreaterThan(edit!.revisionNumber);
    });

    it("keeps one tenant's history out of another's reach", async () => {
        const revs = await scribeVersioningService.listRevisions(documentId, orgId);
        expect(revs.length).toBeGreaterThan(0);
        await expect(scribeVersioningService.listRevisions(documentId, otherOrgId)).rejects.toMatchObject({ status: 404 });
        await expect(scribeVersioningService.getRevision(revs[0].id, otherOrgId)).rejects.toMatchObject({ status: 404 });
        await expect(
            scribeVersioningService.rollbackRevision(revs[0].id, otherOrgId),
        ).rejects.toMatchObject({ status: 404 });
    });

    it("validates AI-system metadata references against the organization", async () => {
        // A second document in the same org is a legal link target.
        const [secondSession] = await db
            .insert(crewSessions)
            .values({
                organizationId: orgId,
                sessionKey: `test-scribe-versioning-2-${Date.now()}`,
                title: "Linked Doc Room",
                status: "active",
                mode: "explore",
                createdBy: "test_runner",
            })
            .returning();
        const linked = await scribeService.createOrGetDocument(
            secondSession.id,
            orgId,
            "Companion Governance Policy",
            "ai_system_governance",
        );
        expect(linked.document.archetypeMode).toBe("ai_system_governance");

        const updated = await scribeVersioningService.updateAiSystemMetadata(documentId, orgId, {
            aiSystemId: "credit-scorer-v3",
            governancePolicyDocumentId: linked.document.id,
        });
        expect(updated.aiSystemId).toBe("credit-scorer-v3");
        expect(updated.governancePolicyDocumentId).toBe(linked.document.id);

        const revs = await waitForRevisions(documentId, orgId, 1);
        expect(revs.some((r) => r.kind === "metadata")).toBe(true);

        // A document id that does not resolve inside this org is refused.
        await expect(
            scribeVersioningService.updateAiSystemMetadata(documentId, orgId, {
                dataLineageGraphId: 99999999,
            }),
        ).rejects.toMatchObject({ status: 400 });

        await db.delete(scribeDocuments).where(eq(scribeDocuments.id, linked.document.id));
        await db.delete(crewSessions).where(eq(crewSessions.id, secondSession.id));
    });

    it("pins a review to a revision and moves the station with the decision", async () => {
        const [node] = await db
            .select()
            .from(scribeNodes)
            .where(eq(scribeNodes.documentId, documentId))
            .limit(1);

        const review = await scribeVersioningService.requestReview(documentId, orgId, {
            nodeId: node.id,
            requestedBy: "author-1",
            note: "Please check the fairness section.",
        });
        expect(review.status).toBe("pending");
        expect(review.revisionId).not.toBeNull();

        const [inReview] = await db.select().from(scribeNodes).where(eq(scribeNodes.id, node.id));
        expect(inReview.status).toBe("in_review");

        const decided = await scribeVersioningService.decideReview(review.id, orgId, {
            decision: "approved",
            reviewer: "reviewer-1",
            note: "Looks compliant.",
        });
        expect(decided.status).toBe("approved");
        expect(decided.decidedAt).not.toBeNull();

        const [approved] = await db.select().from(scribeNodes).where(eq(scribeNodes.id, node.id));
        expect(approved.status).toBe("approved");

        // A decided review cannot be decided again.
        await expect(
            scribeVersioningService.decideReview(review.id, orgId, { decision: "changes_requested", reviewer: "r2" }),
        ).rejects.toMatchObject({ status: 409 });

        // Reviews list is org-scoped like everything else.
        await expect(scribeVersioningService.listReviews(documentId, otherOrgId)).rejects.toMatchObject({ status: 404 });
    });
});
