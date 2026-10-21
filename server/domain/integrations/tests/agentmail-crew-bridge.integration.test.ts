import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import { agentMailThreadSync } from "../core/agentmail-thread-sync.service.js";
import { db } from "@server/database_service.js";
import { crewSessions, crewTurns } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import agentmailRouter from "../routes/agentmail.js";

describe("AgentMail to CREW Bridge", () => {
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

            // 3. Find CREW session by thread ID
            const link = await agentMailThreadSync.findCrewSessionByThreadId(testThreadId);
            expect(link).not.toBeNull();
            expect(link?.sessionKey).toBe(testSessionKey);
            expect(link?.recipientEmail).toBe("testuser@example.com");

            // 4. Route inbound reply
            const replyResult = await agentMailThreadSync.routeReplyToCrewSession(
                testThreadId,
                "testuser@example.com",
                "Hello! This is an inbound reply test from email.",
                "Re: Welcome"
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

    it("rejects unsigned webhook requests without writing to the linked CREW session", async () => {
        const testSessionKey = `test-webhook-crew-${Date.now()}`;
        const testThreadId = `test-webhook-thread-${Date.now()}`;

        const [session] = await db
            .insert(crewSessions)
            .values({
                organizationId: 342,
                sessionKey: testSessionKey,
                title: "Webhook Test Room",
                status: "active",
                mode: "explore",
            })
            .returning();

        const app = express();
        app.use(express.json());
        app.use("/api/integrations/agentmail", agentmailRouter);

        try {
            await agentMailThreadSync.linkThreadToCrewSession(
                testThreadId,
                testSessionKey,
                "owner@example.com",
                342
            );

            const res = await request(app)
                .post("/api/integrations/agentmail/webhook")
                .send({
                    type: "message.received",
                    data: {
                        from: "owner@example.com",
                        subject: "Re: Welcome to Oddjob.app",
                        text: "Hi! Received the welcome email and replying to confirm it works.",
                        thread_id: testThreadId,
                    },
                });

            expect(res.status).toBe(401);
            expect(res.body.error).toBe("Webhook signature required");

            // Verify turn created
            const turns = await db
                .select()
                .from(crewTurns)
                .where(eq(crewTurns.sessionId, session.id));

            expect(turns).toHaveLength(0);
        } finally {
            await db.delete(crewTurns).where(eq(crewTurns.sessionId, session.id));
            await db.delete(crewSessions).where(eq(crewSessions.id, session.id));
        }
    });
});
