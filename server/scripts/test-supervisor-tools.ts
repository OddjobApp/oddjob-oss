
import "dotenv/config";
import { supervisorService } from "@domain/integrations/core/supervisor.service.js";
import { missionService } from "@domain/mission/core/mission.service.js";
import { SupervisorPlan } from "@shared/schema/supervisor";
import { db } from "@server/database_service.js";
import { pipelineExecutions } from "@shared/schema/index.js";
import { AGENT_TOOLS } from "@domain/tools/v1/tool-registry.service.js";
import { desc } from "drizzle-orm";

// Mock Mission Service to avoid Graph interactions/Qdrant errors
(missionService as any).ensureSupervisorMission = async () => ({ id: 99999 } as any);
(missionService as any).syncFromPlan = async (_m: number, _p: any) => null;

async function main() {
    console.log("Starting Supervisor Tool Execution Test...");

    // Fetch a valid parent execution ID
    const [latestExecution] = await db.select().from(pipelineExecutions).orderBy(desc(pipelineExecutions.id)).limit(1);

    // Fallback if no execution exists (create one? or just warn)
    const parentExecutionId = latestExecution ? latestExecution.id : 0;
    console.log(`Using Parent Execution ID: ${parentExecutionId} (exists: ${!!latestExecution})`);

    // Create a mock plan with a tool task
    const mockPlan: any = {
        version: 1,
        intent: "Test Tool Execution",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        estimatedCostUSD: 0.10,
        tasks: [
            {
                id: "test-task-1",
                type: "tool",
                name: "Calculate Cost",
                description: "Calculate 5 + 3",
                status: "pending",
                toolName: "calculator",
                arguments: { operation: "add", a: 5, b: 3 },
                dependencies: [],
                estimatedCostUSD: 0,
                retryCount: 0,
                isCritical: true
            }
        ],
        history: [],
        replanCount: 0
    };

    try {
        console.log("Executing Plan...");
        const result = await supervisorService.executePlan(
            mockPlan as any,
            parentExecutionId,
            "test-user-id",
            undefined, // orgId
            [], // allowedPipelineIds
            undefined // supervisorJobId
        );

        console.log("Execution Result:", JSON.stringify(result, null, 2));

        // Verify output
        const task = result.plan.tasks[0];
        if (task.status === 'completed' && task.output) {
            console.log("SUCCESS: Tool executed successfully.");
            console.log("Task Output:", task.output);
        } else {
            console.error("FAILURE: Task did not complete successfully.");
            console.log("Task Status:", task.status);
            console.log("Task Status Details:", task.output || task.assignedAgentFeedback);
        }

    } catch (error) {
        console.error("Execution Failed:", error);
    }
}

main().catch(console.error);

