/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@server/database_service.js";
import { missions, missionRuns, approvalRequests, users } from "@shared/schema/index.js";
import { approvalService } from "@domain/integrations/core/approval.service.js";
import { missionRunService } from "@domain/mission/core/mission-run.service.js";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

describe("Approval Resumption Integration", () => {
    let testMissionId: number;
    let testRunId: number;
    let approvalRequestId: number;

    /**
     * Unique per run, because approval_requests.token is uniquely indexed.
     *
     * This was the literal "test-token-123". afterAll does delete the row, but
     * a run interrupted between the insert and the cleanup — Ctrl-C, a crash, a
     * failure in the rest of beforeAll — leaves it behind, and every later run
     * then fails in beforeAll with a duplicate key on a token nothing asserts
     * on. The suite was passing only against a database that had never been
     * interrupted.
     */
    const approvalToken = `test-token-${randomUUID()}`;

    beforeAll(async () => {
        // Ensure user "1" exists for foreign key constraint
        let testUser = (await db.select().from(users).where(eq(users.id, "1")))[0];
        if (!testUser) {
            await db.insert(users).values({
                id: "1",
                username: `test_system_user_${Date.now()}`,
                password: "hashed_password"
            } as any);
        }

        // 1. Setup a test mission
        const [mission] = await db.insert(missions).values({
            name: "Resumption Test Mission",
            objective: "Verify HIL resumption",
            createdBy: "1",
            status: "active"
        }).returning();
        testMissionId = mission!.id;

        // 2. Setup a test mission run
        const [run] = await db.insert(missionRuns).values({
            missionId: testMissionId,
            name: "Resumption Test Run",
            status: "waiting_on_human",
            pipelineSequence: [],
            createdBy: "1", // system user
            missionContext: { phase: "PAUSED" },
            resumeCondition: {
                type: "human_approval",
                approvalRequestIds: [0] // placeholder, will update below
            }
        }).returning();
        testRunId = run!.id;

        // 3. Setup a pending approval with a PREFIXED executionId
        const [approval] = await db.insert(approvalRequests).values({
            executionId: `pipeline:${testRunId}`,
            jobId: 1,
            approverType: "user",
            approverId: "1",
            approverEmail: "test@oddjob.ai",
            status: "pending",
            token: approvalToken,
            modifiedOutput: { strategic_decision: "proceed" }
        }).returning();
        approvalRequestId = approval!.id;

        // Set resume condition on mission run with the REAL ID
        await db.update(missionRuns).set({
            resumeCondition: {
                type: "human_approval",
                approvalRequestIds: [approvalRequestId]
            }
        }).where(eq(missionRuns.id, testRunId));
    });

    afterAll(async () => {
        // Each delete is independent: these ran as one `await` chain, so a
        // failure on the first left the mission and its run behind. Children
        // first, then parents, so a foreign key cannot block the cleanup.
        const cleanups: Array<[string, () => Promise<unknown>]> = [
            ["approval request", async () => {
                if (approvalRequestId) await db.delete(approvalRequests).where(eq(approvalRequests.id, approvalRequestId));
                // Also by token, in case beforeAll inserted but never reported the id.
                await db.delete(approvalRequests).where(eq(approvalRequests.token, approvalToken));
            }],
            ["mission run", async () => {
                if (testRunId) await db.delete(missionRuns).where(eq(missionRuns.id, testRunId));
            }],
            ["mission", async () => {
                if (testMissionId) await db.delete(missions).where(eq(missions.id, testMissionId));
            }],
        ];
        for (const [what, run] of cleanups) {
            await run().catch((err) => {
                console.warn(`[approval-resumption] could not clean up the test ${what}:`, err?.message ?? err);
            });
        }
    });

    it("should correctly find the mission when executionId has a prefix", async () => {
        const [approval] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, approvalRequestId)).limit(1);
        const matchedMissions = await approvalService.getMissionsForApproval(approval);
        
        expect(matchedMissions.length).toBeGreaterThan(0);
        expect(matchedMissions[0].id).toBe(testRunId);
    });

    it("should resume the mission when processing a decision for a prefixed executionId", async () => {
        // Initial state check
        let run = await missionRunService.getById(testRunId);
        expect(run!.status).toBe("waiting_on_human");

        // Process decision
        await approvalService.processDecision(approvalRequestId, {
            decision: "approved",
            modifiedOutput: { decision: "Go ahead" }
        }, "1", "test@oddjob.ai");

        // Verify approval record updated
        const [updatedApproval] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, approvalRequestId)).limit(1);
        expect(updatedApproval.status).toBe("approved");

        // Verify mission run resumed
        run = await missionRunService.getById(testRunId);
        expect(run!.status).toBe("active");
        expect(run!.resumeCondition).toBeNull();
    });
});
