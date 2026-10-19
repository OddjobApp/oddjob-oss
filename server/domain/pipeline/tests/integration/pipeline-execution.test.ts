process.env.DISABLE_JOB_QUEUE = 'true';
process.env.REDIS_HOST = '127.0.0.1';
process.env.REDIS_PORT = '6379';
process.env.REDIS_URL = 'redis://127.0.0.1:6379';

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { clearPipelineTables, createTestUser, createTestJob, ensurePipelineRuntimeReady } from '../../../../../tests/cross-domain/helpers.js';
import { pipelineService } from '@server/domain/pipeline/core/pipeline.service.js';
import { pipelineExecutor } from '@server/core/pipeline-executor.js';
import { db } from '@server/database_service.js';
import { users } from "@shared/schema/index.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { eq } from "drizzle-orm";

// Org 1 is seeded by `npm run test:db:setup`.
const TEST_ORG_ID = 1;

describe('Pipeline Integration', () => {
    let user: any;
    let job: any;

    beforeEach(async () => {
        // Executors and hooks are registered by the entrypoints, which tests skip.
        await ensurePipelineRuntimeReady();

        await clearPipelineTables();
        user = await createTestUser();
        // Org-scoped: step execution calls assertOrgId and rejects a null org.
        job = await createTestJob(user.id, TEST_ORG_ID);
    });

    afterAll(async () => {
        await clearPipelineTables();
        if (user?.id) {
            await db.delete(users).where(eq(users.id, user.id));
        }
    });

    it('should create and execute a simple pipeline', async () => {
        const orgContext: OrgContext = {
            organizationId: TEST_ORG_ID, 
            userId: user.id,
            isAdmin: false,
            isSuperAdmin: false,
            isOrgAdmin: false
        };

        console.log("Creating pipeline...");
        const pipeline = await pipelineService.create({
            name: "Integration Test Pipeline",
            description: "Testing pipeline flow",
            isActive: true,
            triggerType: "manual",
            steps: [
                {
                    jobId: job.id,
                    order: 0,
                }
            ]
        }, orgContext);

        expect(pipeline).toBeDefined();

        // 2. Execute Pipeline
        console.log("Executing pipeline...");
        await pipelineExecutor.executePipeline(pipeline.id, user.id);

        // 3. Verify Execution History
        const executions = await pipelineService.listExecutionsEnriched(pipeline.id, orgContext);
        console.log("Execution count:", executions.length);

        expect(executions).toHaveLength(1);
        if (executions[0].status !== "completed") {
            console.error("Pipeline failed with error:", executions[0].error);
        }
        expect(executions[0].status).toBe("completed");

        // 4. Verify Step Executions
        const details = await pipelineService.getEnrichedExecutionDetails(executions[0].id, orgContext);
        expect(details.stepExecutions).toHaveLength(1);

        // Note: The real SeleniumJobExecutor returns "success" status for step execution results.
        expect(details.stepExecutions[0].status).toBe("success");

        // Verify output exists
        expect(details.stepExecutions[0].output).toBeDefined();
    }, 60000); // 60s timeout
});
