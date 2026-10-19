import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { scribeService } from "../core/scribe.service.js";
import { authoringOperationService } from "../core/authoring-operation.service.js";
import { db } from "@server/database_service.js";
import { crewSessions, scribeAuthoringOperations, scribeNodes } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

/**
 * The record of what was attempted, and whether it took effect.
 *
 * Every silent-success bug in this codebase had the same shape: the caller's own
 * report was the only evidence, and it was wrong. scribe_update_node returned
 * "Error updating Scribe station" and the harness recorded {ok:true, ms:3}; the
 * canvas painted "Synced" before its request was sent; export replied 200 and
 * produced no file.
 *
 * So `verified` is set by reading the row back and comparing, and these tests
 * exist mainly to prove that it cannot be satisfied any other way.
 */
describe("authoring operations", () => {
    const testOrgId = 1;
    let sessionId: number;
    let documentId: number;
    let nodeId: number;

    beforeAll(async () => {
        const [session] = await db
            .insert(crewSessions)
            .values({
                organizationId: testOrgId,
                sessionKey: `test-authoring-${Date.now()}`,
                title: "Authoring operations room",
                status: "active",
                mode: "explore",
                createdBy: "test_runner",
            })
            .returning();
        sessionId = session.id;

        const view = await scribeService.createOrGetDocument(sessionId, testOrgId, "Operations Doc");
        documentId = view.document.id;
        nodeId = view.nodes[0].id;
    });

    afterAll(async () => {
        if (sessionId) await db.delete(crewSessions).where(eq(crewSessions.id, sessionId));
    });

    it("records a successful edit and marks it verified", async () => {
        await scribeService.updateNodeContent(
            nodeId,
            testOrgId,
            "The scope covers two date types.",
            undefined,
            undefined,
            undefined,
            undefined,
            { actor: "GhostWriter", request: "Tighten the scope paragraph" },
        );

        const ops = await authoringOperationService.listForDocument(documentId, testOrgId);
        const op = ops[0];

        expect(op.operation).toBe("update_node");
        expect(op.actor).toBe("GhostWriter");
        expect(op.status).toBe("applied");
        expect(op.verified).toBe(true);
        expect(op.settledAt).not.toBeNull();
        expect(op.proposedContent).toBe("The scope covers two date types.");
    });

    it("keeps the request apart from the prose that goes in the document", async () => {
        // Collapsing these is how "I defer to the GhostWriter for content
        // generation" reached a manuscript as though it were prose.
        const ops = await authoringOperationService.listForDocument(documentId, testOrgId);
        const op = ops[0];

        expect(op.request).toBe("Tighten the scope paragraph");
        expect(op.proposedContent).not.toContain("Tighten the scope paragraph");
    });

    it("records a failed edit rather than leaving no trace", async () => {
        await expect(
            scribeService.updateNodeContent(
                nodeId,
                testOrgId,
                undefined,
                undefined,
                undefined,
                "a phrase that is not in the station",
                "replacement",
                { actor: "Critic", request: "Swap the clause" },
            ),
        ).rejects.toThrow(/Target excerpt not found/i);

        const ops = await authoringOperationService.listForDocument(documentId, testOrgId);
        const failed = ops.find((o) => o.status === "failed");

        // The attempt is on the record even though the write never happened.
        expect(failed).toBeDefined();
        expect(failed!.verified).toBe(false);
        expect(failed!.failureReason).toMatch(/Target excerpt not found/i);
        expect(failed!.actor).toBe("Critic");
    });

    it("carries research provenance through to the record", async () => {
        // The tool layer already returns file/chunk/score; until now nothing
        // persisted it, so it was discarded at the turn boundary.
        await scribeService.updateNodeContent(
            nodeId,
            testOrgId,
            "Shelfie tracks use-by and purchase dates.",
            undefined,
            undefined,
            undefined,
            undefined,
            {
                actor: "Analyst",
                request: "Summarise the requirements",
                sources: [{ file: "App Concept ShelfLife.txt", attachmentId: 2, chunk: 3, score: 0.82 }],
            },
        );

        const ops = await authoringOperationService.listForDocument(documentId, testOrgId);
        const op = ops[0];

        expect(op.sources).toHaveLength(1);
        expect(op.sources[0].file).toBe("App Concept ShelfLife.txt");
        expect(op.sources[0].chunk).toBe(3);
    });

    it("refuses to call an edit verified when the document disagrees", async () => {
        // The case the whole table exists for: the write returns without
        // throwing and the stored content is not what was proposed.
        const op = await authoringOperationService.begin({
            organizationId: testOrgId,
            documentId,
            nodeId,
            actor: "test",
            operation: "update_node",
            proposedContent: "Content that was never written.",
        });

        const settled = await authoringOperationService.settleApplied(op.id, {
            nodeId,
            expectedContent: "Content that was never written.",
        });

        expect(settled.verified).toBe(false);
        expect(settled.status).toBe("failed");
        expect(settled.failureReason).toMatch(/does not match/i);
    });

    it("does not fail verification over trailing whitespace", async () => {
        // A save that round-trips through markdown can gain or lose a newline.
        // Failing on that would teach everyone to ignore the flag.
        const [node] = await db.select().from(scribeNodes).where(eq(scribeNodes.id, nodeId)).limit(1);
        const op = await authoringOperationService.begin({
            organizationId: testOrgId,
            documentId,
            nodeId,
            actor: "test",
            operation: "update_node",
        });

        const settled = await authoringOperationService.settleApplied(op.id, {
            nodeId,
            expectedContent: `${node.content}\n`,
        });

        expect(settled.verified).toBe(true);
    });

    it("lists what was attempted and did not take effect", async () => {
        const unverified = await authoringOperationService.listUnverified(documentId, testOrgId);

        // The question the table was built to answer.
        expect(unverified.length).toBeGreaterThan(0);
        expect(unverified.every((o) => o.status !== "applied" || !o.verified)).toBe(true);
    });

    it("settles the record even when the mutation throws inside record()", async () => {
        await expect(
            authoringOperationService.record(
                {
                    organizationId: testOrgId,
                    documentId,
                    nodeId,
                    actor: "test",
                    operation: "crystallize",
                },
                async () => {
                    throw new Error("model unavailable");
                },
            ),
        ).rejects.toThrow(/model unavailable/);

        const ops = await authoringOperationService.listForDocument(documentId, testOrgId);
        const op = ops.find((o) => o.operation === "crystallize");

        expect(op?.status).toBe("failed");
        expect(op?.failureReason).toMatch(/model unavailable/);
    });

    it("scopes every read to the organization", async () => {
        const otherOrg = await authoringOperationService.listForDocument(documentId, 99999);
        expect(otherOrg).toHaveLength(0);
    });

    afterAll(async () => {
        await db
            .delete(scribeAuthoringOperations)
            .where(eq(scribeAuthoringOperations.documentId, documentId));
    });
});
