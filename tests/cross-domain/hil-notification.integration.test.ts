/**
 * HIL Notification System Integration Tests
 * Verifies the "Notification Quad" logic and ensures surgical cleanup of test data.
 */

/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { hilService } from "@domain/pipeline/core/hil.service.js";
import { hilRequests } from "@domain/pipeline/core/hil-requests.service.js";
import { db } from "../../server/db";
import { hilForms, pipelineStepExecutions, pipelineExecutions, pipelineSteps, pipelines, jobs, orgs, users } from "@shared/schema";
import { eq, and } from "drizzle-orm";

describe("HIL Notification Integration", () => {
    let testFormId: number | null = null;
    let testStepExecutionId: number;
    let testExecutionId: number;
    let testPipelineId: number;
    let testPipelineStepId: number;
    let testJobId: number;
    let testOrgId: number;
    const testUserId = "test-user-hil-notification";

    beforeAll(async () => {
        // Surgical setup: create only what this test needs, track all IDs for cleanup

        // hil_forms.created_by is a FK to users.id, so the user has to exist before
        // any form is created — a bare id string fails the constraint.
        await db.insert(users).values({
            id: testUserId,
            username: testUserId,
            password: "test-only-not-a-real-credential",
        }).onConflictDoNothing();

        const [org] = await db.insert(orgs).values({
            name: "HIL Test Org",
            subscriptionStatus: "active",
        }).returning();
        testOrgId = org.id;

        const [pipeline] = await db.insert(pipelines).values({
            name: `hil-test-pipeline-${testOrgId}`,
            organizationId: testOrgId,
            createdBy: testUserId,
            triggerType: "manual",
        }).returning();
        testPipelineId = pipeline.id;

        const [execution] = await db.insert(pipelineExecutions).values({
            pipelineId: testPipelineId,
            status: "running",
            createdBy: testUserId,
        }).returning();
        testExecutionId = execution.id;

        // pipeline_step_executions has FKs to pipeline_steps and jobs. These were
        // hardcoded to id 10, which exists in nobody's database, so every run failed
        // the FK constraint before a single assertion ran. Create the real parents.
        const [job] = await db.insert(jobs).values({
            name: `hil-test-job-${testOrgId}`,
            type: "static_response",
            config: {},
            createdBy: testUserId,
            organizationId: testOrgId,
        }).returning();
        testJobId = job.id;

        const [step] = await db.insert(pipelineSteps).values({
            pipelineId: testPipelineId,
            order: 1,
            jobId: testJobId,
        }).returning();
        testPipelineStepId = step.id;

        const [stepExec] = await db.insert(pipelineStepExecutions).values({
            pipelineExecutionId: testExecutionId,
            pipelineStepId: testPipelineStepId,
            jobId: testJobId,
            status: "pending",
            createdBy: testUserId,
            stepOrder: 1,
        }).returning();
        testStepExecutionId = stepExec.id;
    });

    afterAll(async () => {
        // Surgical cleanup in reverse-FK order — only the rows this test created
        if (testFormId) {
            await db.delete(hilForms).where(eq(hilForms.id, testFormId));
        }
        await db.delete(hilForms).where(eq(hilForms.stepExecutionId, testStepExecutionId));
        await db.delete(pipelineStepExecutions).where(eq(pipelineStepExecutions.id, testStepExecutionId));
        await db.delete(pipelineExecutions).where(eq(pipelineExecutions.id, testExecutionId));
        if (testPipelineStepId) {
            await db.delete(pipelineSteps).where(eq(pipelineSteps.id, testPipelineStepId));
        }
        await db.delete(pipelines).where(eq(pipelines.id, testPipelineId));
        if (testJobId) {
            await db.delete(jobs).where(eq(jobs.id, testJobId));
        }
        await db.delete(users).where(eq(users.id, testUserId));
        await db.delete(orgs).where(eq(orgs.id, testOrgId));
    });

    it("should create a HIL form and initialize with isViewed: false", async () => {
        const request = await hilRequests.create({
            source: "step",
            stepExecutionId: testStepExecutionId,
            createdBy: testUserId,
            organizationId: testOrgId,
            name: "HIL Form",
            schema: { fields: [] },
            announce: false,
        });
        testFormId = request.id;

        const [form] = await db
            .select()
            .from(hilForms)
            .where(eq(hilForms.id, testFormId))
            .limit(1);

        expect(form).toBeDefined();
        expect(form.isViewed).toBe(false);
        expect(form.status).toBe("pending");
    });

    it("should mark a HIL form as viewed", async () => {
        if (!testFormId) throw new Error("testFormId not set");

        await hilService.markAsViewed(testFormId);

        const [form] = await db
            .select()
            .from(hilForms)
            .where(eq(hilForms.id, testFormId))
            .limit(1);

        expect(form.isViewed).toBe(true);
    });

    it("should aggregate HIL forms correctly in the combined pending list", async () => {
        const results = await db
            .select()
            .from(hilForms)
            .where(
                and(
                    eq(hilForms.kind, "request"),
                    eq(hilForms.status, "pending"),
                    eq(hilForms.isArchived, false),
                    eq(hilForms.id, testFormId!)
                )
            );

        // Status is still "pending" until resolved — should appear in pending list
        expect(results.length).toBe(1);
    });
});
