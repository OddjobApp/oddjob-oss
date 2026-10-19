import { governorResolver } from "@domain/governor/core/governor-resolver.js";
import { db } from '../database_service.js';
import { jobs } from '../../shared/schema/jobs/table.js';
import { pipelines } from '../../shared/schema/pipelines/pipeline-core.js';
import { pipelineSteps } from '../../shared/schema/pipelines/pipeline-steps.js';
import { eq, and } from 'drizzle-orm';

async function verifyHierarchy() {
    console.log("--- Starting Selective Governance Verification ---");

    // 1. Create a Pipeline with Governance ON
    const [pipeline] = await db.insert(pipelines).values({
        name: "Governed Pipeline",
        organizationId: 1,
        triggerType: 'manual',
        createdBy: "system_test",
        governorSettings: { enabled: true, mode: 'AUTONOMOUS' }
    }).returning();
    console.log(`[Test 1] Created Governed Pipeline (ID: ${pipeline.id})`);

    // 2. Create a Job with Governance OFF (Override)
    const [jobWithOverride] = await db.insert(jobs).values({
        name: "Opt-Out Job in Governed Pipeline",
        type: "ai_agent",
        config: { goal: "test" },
        organizationId: 1,
        createdBy: "system_test",
        governorSettings: { enabled: false, mode: 'OFF' }
    }).returning();

    // Link job to pipeline
    await db.insert(pipelineSteps).values({
        pipelineId: pipeline.id,
        jobId: jobWithOverride.id,
        order: 0
    });

    // 3. Create a Job with NO settings (Inheritance)
    const [jobInheriting] = await db.insert(jobs).values({
        name: "Inheriting Job",
        type: "ai_agent",
        config: { goal: "test" },
        organizationId: 1,
        createdBy: "system_test"
    }).returning();

    // Link job to pipeline
    await db.insert(pipelineSteps).values({
        pipelineId: pipeline.id,
        jobId: jobInheriting.id,
        order: 1
    });

    // Verification 1: Job Override (Should be OFF)
    const res1 = await governorResolver.resolveGovernance({ jobId: jobWithOverride.id });
    console.log(`[Result 1] Job Override resolved to: ${res1.enabled ? 'ENABLED' : 'DISABLED'} (Expected: DISABLED)`);

    // Verification 2: Pipeline Inheritance (Should be ENABLED)
    const res2 = await governorResolver.resolveGovernance({ jobId: jobInheriting.id });
    console.log(`[Result 2] Pipeline Inheritance resolved to: ${res2.enabled ? 'ENABLED' : 'DISABLED'} (Expected: ENABLED)`);

    // Cleanup
    await db.delete(pipelineSteps).where(eq(pipelineSteps.pipelineId, pipeline.id));
    await db.delete(jobs).where(eq(jobs.id, jobWithOverride.id));
    await db.delete(jobs).where(eq(jobs.id, jobInheriting.id));
    await db.delete(pipelines).where(eq(pipelines.id, pipeline.id));

    console.log("--- Verification Complete ---");
}

verifyHierarchy().catch(console.error);

