
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { clearPipelineTables, createTestUser, createTestJob } from './helpers';
import { pipelineService } from '@server/domain/pipeline/core/pipeline.service.js';
import { pipelineExecutor } from '../../server/core/pipeline-executor';
import { db } from '../../server/db';
import { forensicEventLog, users, orgs, errorDiagnoses } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

describe('Distributed Tracing Integration', () => {
    let user: any;
    let job: any;
    let orgId: number;

    beforeEach(async () => {
        process.env.DISABLE_JOB_QUEUE = 'true';
        await clearPipelineTables();

        // A real organization, because executing a pipeline step calls
        // assertOrgId: under a null org the executor's loop threw
        // "Organization context required", no forensic event was ever written,
        // and this test failed on the count rather than on the tracing it is
        // about. createTestJob's own doc comment says as much.
        const [org] = await db.insert(orgs).values({
            name: `Tracing Test Org ${Date.now()}`,
        }).returning();
        orgId = org.id;

        user = await createTestUser();
        job = await createTestJob(user.id, orgId);
    });

    afterAll(async () => {
        await clearPipelineTables();
        if (user?.id) {
            await db.delete(users).where(eq(users.id, user.id));
        }
        if (orgId) {
            // Executing the pipeline writes diagnostics against the org, and
            // error_diagnoses carries a foreign key to it — so the org cannot
            // go first. Deleting them here rather than swallowing the failure
            // keeps the org from accumulating one row per run.
            await db.delete(errorDiagnoses).where(eq(errorDiagnoses.organizationId, orgId));
            await db.delete(forensicEventLog).where(eq(forensicEventLog.organizationId, orgId));
            await db.delete(orgs).where(eq(orgs.id, orgId));
        }
    });

    it('should propagate traceId from pipeline to forensic events', async () => {
        const orgContext = { organizationId: orgId, userId: user.id };

        // 1. Create a simple pipeline
        const pipeline = await pipelineService.create({
            name: "Tracing Test Pipeline",
            description: "Testing trace propagation",
            isActive: true,
            triggerType: "manual",
            steps: [
                {
                    jobId: job.id,
                    order: 0,
                }
            ]
        }, orgContext);

        // 2. Execute Pipeline
        const execution = await pipelineExecutor.executePipeline(pipeline.id, user.id);

        // 3. Get the Trace ID from the execution record
        const execRecord = await pipelineService.getExecutionSystem(execution.executionId);
        const rootTraceId = execRecord?.traceId;

        expect(rootTraceId).toBeDefined();
        expect(rootTraceId).not.toBe('00000000000000000000000000000000');

        // 4. Verify Forensic Logs have the same Trace ID
        const events = await db.select()
            .from(forensicEventLog)
            .where(eq(forensicEventLog.traceId, rootTraceId!))
            .orderBy(desc(forensicEventLog.startTimeNs));

        console.log(`Found ${events.length} forensic events for trace ${rootTraceId}`);

        // At least one event should exist for the step execution
        expect(events.length).toBeGreaterThan(0);

        // Verify all events share the same traceId
        events.forEach(event => {
            expect(event.traceId).toBe(rootTraceId);
        });

    }, 30000);
});
