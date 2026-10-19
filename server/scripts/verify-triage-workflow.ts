
import { pipelineExecutor } from '../core/pipeline-executor.js';
import { db } from '../database_service.js';
import { pipelineExecutions, pipelineStepExecutions, missions, missionMembers } from '@shared/schema/index.js';
import { verifyUtils } from './verify-utils.js';
import { eq, desc, and } from 'drizzle-orm';

async function verifyTriageWorkflow() {
    console.log("🚀 Starting Triage Workflow Verification...");

    // Try to find the Triage pipeline by name for stability
    const triagePipeline = await verifyUtils.findPipelineByName("Production Triage & Investigation");
    const masterPipelineId = triagePipeline?.id || 43;
    const userId = "admin";

    const intent = "The production API is returning 500 errors. I need a full triage: check the logs for stack traces and probe the endpoint health. (Test " + Date.now() + ")";

    console.log(`Triggering Master Pipeline ${masterPipelineId}...`);

    const result = await pipelineExecutor.executePipeline(
        masterPipelineId,
        userId,
        null, // startStepId
        null, // ttl
        { intent }
    );

    verifyUtils.logResult("Master Pipeline Trigger", result.success, result.error);

    // Fetch the plan from the supervisor output
    const [lastStep] = await db.select().from(pipelineStepExecutions)
        .where(eq(pipelineStepExecutions.pipelineExecutionId, result.executionId))
        .orderBy(desc(pipelineStepExecutions.stepOrder))
        .limit(1);

    if (lastStep && lastStep.output) {
        try {
            const plan = JSON.parse(lastStep.output);
            const hasCompletedTasks = plan.tasks.some((t: any) => t.status === 'completed');
            verifyUtils.logResult("Supervisor Delegation", hasCompletedTasks);
        } catch (e) {
            verifyUtils.logResult("Supervisor Output Parsing", false, "Raw Output: " + lastStep.output.substring(0, 100));
        }
    }

    // Verify Mission Creation
    const [wg] = await db.select().from(missions)
        .where(eq(missions.objective, intent))
        .orderBy(desc(missions.createdAt))
        .limit(1);

    if (wg) {
        verifyUtils.logResult("Mission Creation", true, `ID: ${wg.id}`);

        // Verify Members
        const members = await db.select().from(missionMembers).where(eq(missionMembers.missionId, wg.id));
        verifyUtils.logResult("Member Assignment", members.length >= 1, `Members: ${members.length}`);
    } else {
        verifyUtils.logResult("Mission Creation", false, "Mission NOT created for this intent.");
    }

    console.log("\n--- Verification Complete ---");
    process.exit(0);
}

verifyTriageWorkflow().catch(err => {
    console.error("❌ Verification Failed:", err);
    process.exit(1);
});

