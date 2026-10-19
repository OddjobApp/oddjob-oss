import { missionRunService } from "../server/domain/mission/core/mission-run.service.js";
import { pipelineService } from "../server/domain/pipeline/core/pipeline.service.js";
import { hookRegistry } from "../server/domain/pipeline/hooks/execution-hooks.js";
import { initializeHooks } from "../server/domain/pipeline/hooks/index.js";
import { db } from "../server/db/index.js";
import { missions, missionRuns, pipelineExecutions, pipelines } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function verify() {
    console.log("--- Starting Mission Suspension Verification ---");

    try {
        // IMPORTANT: Initialize hooks so MissionCheckpointHook is registered
        initializeHooks();

        // 1. Setup Mock Data
        const orgId = 1;
        const userId = "test-user";

        // Create a mock pipeline to satisfy foreign key constraints
        const [pipelineObj] = await db.insert(pipelines).values({
            name: "Test Suspension Pipeline " + Date.now(),
            description: "A pipeline for testing suspension logic",
            triggerType: "manual",
            organizationId: orgId,
            createdBy: userId,
            status: "active",
            isActive: true,
            enableKnowledgeGraph: false,
            lifecycleStatus: "active",
            config: {}
        } as any).returning();

        console.log(`Created Mock Pipeline ${pipelineObj.id}`);

        const [mission] = await db.insert(missions).values({
            name: "Test Suspension Mission " + Date.now(),
            type: "supervisor_led",
            organizationId: orgId,
            objective: "Test suspension logic",
            createdBy: userId,
            status: "active"
        } as any).returning();

        const run = await missionRunService.create({
            missionId: mission.id,
            organizationId: orgId,
            name: "Test Run",
            createdBy: userId,
            pipelineSequence: [pipelineObj.id],
            currentPipelineId: pipelineObj.id
        });

        const execution = await pipelineService.createExecution({
            pipelineId: pipelineObj.id,
            status: "running",
            createdBy: userId,
            organizationId: orgId,
            missionId: mission.id
        });

        // Link run to execution
        await missionRunService.update(run.id, { pipelineExecutionId: execution.id });

        console.log(`Created Mission ${mission.id}, Run ${run.id}, Execution ${execution.id}`);

        // 2. Simulate Suspending Step logic in PipelineExecutor
        console.log("Simulating step suspension in PipelineExecutor...");
        
        await pipelineService.updateExecution(execution.id, {
            status: "waiting_external_input"
        });

        // 3. Trigger Hook
        console.log("Triggering onPipelineComplete hook...");
        
        // Refetch execution to get the updated status "waiting_external_input"
        const updatedExecution = await pipelineService.getExecutionSystem(execution.id);

        await hookRegistry.triggerPipelineComplete({
            pipeline: pipelineObj,
            pipelineExecution: updatedExecution,
            stepResults: [],
            orgId,
            userId
        });

        // 4. Verify Mission Run Status
        const [updatedRun] = await db.select().from(missionRuns).where(eq(missionRuns.id, run.id)).limit(1);
        console.log(`Final Mission Run Status: ${updatedRun.status}`);

        if (updatedRun.status === "waiting_on_human") {
            console.log("SUCCESS: Mission Run correctly transitioned to waiting_on_human");
        } else {
            console.error(`FAILURE: Mission Run status is ${updatedRun.status}, expected waiting_on_human`);
            process.exit(1);
        }

        process.exit(0);
    } catch (err) {
        console.error("Verification failed with error:", err);
        process.exit(1);
    }
}

verify();
