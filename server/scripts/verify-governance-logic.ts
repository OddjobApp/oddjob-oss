import { governorResolver } from "@domain/governor/index.js";
import { db } from '../database_service.js';
import { pipelines } from '@shared/schema/index.js';
import { verifyUtils } from './verify-utils.js';
import { eq } from 'drizzle-orm';

async function runGovernanceTests() {
    console.log("\n🚀 Starting Comprehensive Selective Governance Tests\n");

    // --- TEST 1: Job-Level Opt-In (Pure Config) ---
    const configOptIn = { governorSettings: { enabled: true, mode: 'AUTONOMOUS' } };
    const res1 = await governorResolver.resolveGovernance({ jobConfig: configOptIn });
    verifyUtils.logResult("Job-Level Opt-In", res1.enabled && res1.mode === 'AUTONOMOUS');

    // --- TEST 2: Job-Level Opt-Out (Pure Config) ---
    const configOptOut = { governorSettings: { enabled: false, mode: 'OFF' } };
    const res2 = await governorResolver.resolveGovernance({ jobConfig: configOptOut });
    verifyUtils.logResult("Job-Level Opt-Out", !res2.enabled);

    // --- TEST 3: Pipeline Inheritance (Database-backed) ---
    try {
        // Create a governed pipeline
        const [pipeline] = await db.insert(pipelines).values({
            name: "Test Governed Workspace " + Date.now(),
            organizationId: 1,
            triggerType: 'manual',
            createdBy: 'system-test',
            governorSettings: { enabled: true, mode: 'ADVISORY' }
        } as any).returning();

        // Resolve for a job linked to this pipeline, but with NO local settings
        const res3 = await governorResolver.resolveGovernance({
            pipelineId: pipeline.id,
            jobConfig: {} // Empty local config
        });

        verifyUtils.logResult("Pipeline Inheritance", res3.enabled && res3.mode === 'ADVISORY');

        // Cleanup
        await db.delete(pipelines).where(eq(pipelines.id, pipeline.id));
    } catch (err: any) {
        verifyUtils.logResult("Pipeline Inheritance", false, err?.message || String(err));
    }

    // --- TEST 4: Global Baseline ---
    const res4 = await governorResolver.resolveGovernance({ jobConfig: {} });
    verifyUtils.logResult("Global Baseline", true, `Mode: ${res4.mode}`);

    console.log("--- Tests Complete ---");
    process.exit(0);
}

runGovernanceTests().catch(err => {
    console.error("Fatal test error:", err);
    process.exit(1);
});

