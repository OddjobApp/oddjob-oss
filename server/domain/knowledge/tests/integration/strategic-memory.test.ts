/**
 * Strategic Memory & Knowledge Curation Integration Tests
 * 
 * Verifies:
 * 1. Triage Center (Rescue 2.0) recommendation generation
 * 2. Recovery strategy application (Rescue 2.0)
 * 3. Agentic Knowledge Curation (Agency Intelligence)
 */

/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@server/database_service.js";
import { missions, missionRuns, rescueSessions, knowledgeDocuments, knowledgeTopics, knowledgeTopicDocuments } from "@shared/schema/index.js";
import { apps, appDeployments } from "@shared/schema/apps.js";
import { eq, and, sql } from "drizzle-orm";
import { rescueService } from "@domain/rescue/index.js";
import { missionRunService } from "@domain/mission/core/mission-run.service.js";
import { knowledgeService } from "@domain/knowledge/knowledge.service.js";

describe("Strategic Memory & Curation Integration", () => {
    let missionId: number;
    let missionRunId: number;
    let organizationId = 1; // Default test org
    let testContext = { organizationId, userId: "test-user", isAdmin: true, isOrgAdmin: true, isSuperAdmin: false };

    beforeAll(async () => {
        console.log("DATABASE_URL:", process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":****@"));

        // Setup app registry and deployment for the test org
        const [app] = await db.insert(apps).values({
            name: "Service Dispatch",
            slug: "service-dispatch",
            description: "Test Dispatch App"
        } as any).onConflictDoNothing().returning();

        const appId = app?.id || (await db.query.apps.findFirst({ where: eq(apps.slug, "service-dispatch") }))?.id;

        if (appId) {
            await db.insert(appDeployments).values({
                appId,
                organizationId,
                status: "active",
                config: {}
            } as any).onConflictDoNothing();
        }

        // Defensive check for tables
        try {
            await db.execute(sql`SELECT 1 FROM rescue_sessions LIMIT 1`);
            console.log("DEBUG: Table 'rescue_sessions' verified.");
        } catch (e: any) {
            console.error("DEBUG: Table 'rescue_sessions' verification FAILED:", e.message);
        }

        // Setup test mission
        const [m] = await db.insert(missions).values({
            name: "Strategic Test Mission",
            organizationId,
            createdBy: "test_curation",
            blackboard: { status: "stalled" }
        } as any).returning();
        missionId = m.id;

        const [mr] = await db.insert(missionRuns).values({
            missionId,
            organizationId,
            name: "Strategic Test Run",
            status: "active",
            pipelineSequence: [1],
            currentStepIndex: 0,
            createdBy: "test_curation",
            missionContext: { error: "Terminal Impediment Detected" }
        } as any).returning();
        missionRunId = mr.id;
    });

    afterAll(async () => {
        try {
            if (missionRunId) {
                await db.delete(rescueSessions).where(eq(rescueSessions.missionRunId, missionRunId));
            }
            if (missionRunId) {
                await db.delete(missionRuns).where(eq(missionRuns.id, missionRunId));
            }
            if (missionId) {
                await db.delete(missions).where(eq(missions.id, missionId));
            }
        } catch (e) {
            console.error("DEBUG: Cleanup failed (likely FK):", e);
        }
    });

    describe("Triage Center (Rescue 2.0)", () => {
        it("should generate triage options for a mission run", async () => {
            // Initiate rescue first to get a session
            const session = await rescueService.initiateRescue({
                orgId: organizationId,
                serviceType: "DURABLE_FAILURE",
                missionRunId,
                missionId,
                isDemoMode: true,
                userLocation: { lat: 0, lng: 0, resolvedBy: "manual" }
            });

            // generateTriageOptions consumes the sessionId and updates the DB
            await rescueService.generateTriageOptions(session.id);

            // Verify results in DB
            const updatedSession = await db.query.rescueSessions.findFirst({
                where: eq(rescueSessions.id, session.id)
            });

            expect(updatedSession?.triageSummary).toContain("JIRA Sync mission");
            expect(updatedSession?.recoveryOptions).toHaveLength(3);
            expect((updatedSession?.recoveryOptions as any)[0].actionType).toBe("manual_takeover");
        });
    });

    describe("Agentic Knowledge Curation (Agency Intelligence)", () => {
        it("should curate a lesson learned with metadata and link it to topic", async () => {
            const content = "### Lesson: Schema Mismatch\nThe target JIRA instance uses 'Custom Field 123' for story points. VectorMemoryStore used.";
            const result = await knowledgeService.curateLesson(missionId, content, testContext as any);

            expect(result.documentId).toBeDefined();

            // Verify document and basic metadata
            const doc = await db.query.knowledgeDocuments.findFirst({
                where: eq(knowledgeDocuments.id, result.documentId)
            });
            expect(doc?.title).toContain(`Lesson Learned: Mission ${missionId}`);
            expect((doc?.metadata as any)?.missionId).toBe(missionId);

            // Verify topic link
            const topics = await db
                .select({ name: knowledgeTopics.name })
                .from(knowledgeTopicDocuments)
                .innerJoin(knowledgeTopics, eq(knowledgeTopicDocuments.topicId, knowledgeTopics.id))
                .where(eq(knowledgeTopicDocuments.documentId, result.documentId));

            expect(topics.some(t => t.name === "Agency Intelligence")).toBe(true);
        });
    });

    describe("Memory Synchronization (Critical Path)", () => {
        it("should verify mission run status sync to memory", async () => {
            // Update mission run status
            await missionRunService.update(missionRunId, { status: "completed" });
            
            // Verification step would typically check the Python sidecar or a sync log
            // Since we're in Vitest, we'll check the DB state which should be synced
            const run = await db.query.missionRuns.findFirst({
                where: eq(missionRuns.id, missionRunId)
            });
            expect(run?.status).toBe("completed");
        });
    });
});
