import { beforeAll, describe, expect, it } from "vitest";
import { agentMailThreadSync } from "../core/agentmail-thread-sync.service.js";
import { db } from "@server/database_service.js";
import { crewSessions, crewTurns } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { ensureFixtureOrgs } from "../../../../tests/helpers/fixture-orgs.js";

// Delivery itself (per-organization webhooks, signatures, the retired shared
// endpoint) is covered by org-agentmail-webhook.integration.test.ts.
describe("AgentMail to CREW Bridge", () => {
    // A linked thread is recorded against its organization, which must exist.
    beforeAll(() => ensureFixtureOrgs([[342, "AgentMail CREW bridge"]]));

    it("links thread to CREW session, finds it, and routes an inbound email reply", async () => {
        const testSessionKey = `test-crew-email-${Date.now()}`;
        const testThreadId = `test-thread-${Date.now()}`;

        // 1. Create a dummy crew session
        const [session] = await db
            .insert(crewSessions)
            .values({
                organizationId: 342,
                sessionKey: testSessionKey,
                title: "Test Email Room",
                status: "active",
                mode: "explore",
            })
            .returning();

        expect(session).toBeDefined();

        try {
            // 2. Link thread to CREW session
            await agentMailThreadSync.linkThreadToCrewSession(
                testThreadId,
                testSessionKey,
                "testuser@example.com",
                342
            );

            // 3. Find CREW session by thread ID, in its own organization only
            const link = await agentMailThreadSync.findCrewSessionByThreadId(testThreadId, 342);
            expect(link).not.toBeNull();
            expect(link?.sessionKey).toBe(testSessionKey);
            expect(link?.recipientEmail).toBe("testuser@example.com");
            expect(await agentMailThreadSync.findCrewSessionByThreadId(testThreadId, 343)).toBeNull();

            // 4. Route inbound reply
            const replyResult = await agentMailThreadSync.routeReplyToCrewSession(
                testThreadId,
                "testuser@example.com",
                "Hello! This is an inbound reply test from email.",
                "Re: Welcome",
                342
            );

            expect(replyResult.success).toBe(true);
            expect(replyResult.turnId).toBeDefined();

            // 5. Verify the turn in DB
            const [turn] = await db
                .select()
                .from(crewTurns)
                .where(eq(crewTurns.id, replyResult.turnId!));

            expect(turn).toBeDefined();
            expect(turn.content).toContain("Inbound Email Reply from testuser@example.com");
            expect(turn.content).toContain("Hello! This is an inbound reply test from email.");
            expect(turn.speakerName).toBe("Inbound Email (testuser@example.com)");
        } finally {
            // Cleanup
            await db.delete(crewTurns).where(eq(crewTurns.sessionId, session.id));
            await db.delete(crewSessions).where(eq(crewSessions.id, session.id));
        }
    });
});
