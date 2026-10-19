
import "dotenv/config";
import { db } from "../database_service.js";
import { pipelineExecutions, pipelineStepExecutions, missionRuns, missions } from "@shared/schema/index.js";
import { eq, desc, and } from "drizzle-orm";
import { missionService } from "../domain/mission/core/mission.service.js";

const command = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];

async function main() {
    if (!command) {
        console.log("Usage: npx tsx server/scripts/mission-ctl.ts <command> [args]");
        console.log("Commands:");
        console.log("  inspect <executionId>    Dump execution state and context");
        console.log("  resume <missionId> \"<message>\"    Resume mission with user guidance");
        console.log("  fix-links                Scan and fix specific broken pipeline-to-mission links");
        process.exit(1);
    }

    try {
        switch (command) {
            case "inspect":
                await inspectExecution(parseInt(arg1));
                break;
            case "resume":
                await resumeMission(parseInt(arg1), arg2);
                break;
            case "fix-links":
                await fixLinks();
                break;
            default:
                console.error("Unknown command:", command);
        }
    } catch (err: any) {
        console.error("Operation failed:", err);
    } finally {
        process.exit(0);
    }
}

async function inspectExecution(id: number) {
    console.log(`--- Inspecting Execution ${id} ---`);

    // 1. Execution Record
    const [exec] = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, id));
    if (!exec) {
        console.error("Execution not found");
        return;
    }
    console.log("Execution:", JSON.stringify(exec, null, 2));

    // 2. Mission (Anchor)
    if (exec.missionId) {
        const [m] = await db.select().from(missions).where(eq(missions.id, exec.missionId));
        console.log("Mission:", m ? `${m.name} (ID: ${m.id})` : "Not Found");
    } else {
        console.warn("WARNING: No Mission Anchored!");
    }

    // 3. Mission Run Link
    const [run] = await db.select().from(missionRuns).where(eq(missionRuns.pipelineExecutionId, id));
    console.log("Linked Mission Run:", run ? `Run ${run.id} (${run.status})` : "None");

    // 4. Steps
    const steps = await db.select({
        id: pipelineStepExecutions.id,
        jobId: pipelineStepExecutions.jobId,
        status: pipelineStepExecutions.status,
        output: pipelineStepExecutions.output,
        error: pipelineStepExecutions.error
    })
        .from(pipelineStepExecutions)
        .where(eq(pipelineStepExecutions.pipelineExecutionId, id))
        .orderBy(pipelineStepExecutions.stepOrder);

    console.log(`--- Steps (${steps.length}) ---`);
    steps.forEach(s => {
        console.log(`Step ${s.id} [Job ${s.jobId}]: ${s.status}`);
        if (s.status === "failed") console.log(`  Error: ${s.error}`);
    });
}

async function resumeMission(id: number, message: string) {
    if (!message) {
        console.error("Message argument required");
        return;
    }

    const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, id));
    if (!run) throw new Error(`Mission Run ${id} not found`);

    console.log(`Resuming Mission Run ${id} (Mission: ${run.missionId}) with message: "${message}"`);

    if (!run.missionId) {
        console.error("Mission Run has no associated mission");
        return;
    }

    // Use service layer to inject guidance
    await missionService.updateBlackboard(
        run.missionId,
        {
            lastUserGuidance: {
                content: message,
                timestamp: new Date().toISOString()
            }
        },
        "user",
        "user_guidance"
    );

    console.log("Guidance injected. Mission should wake up shortly.");
}

async function fixLinks() {
    console.log("Scanning for missions with missing execution links...");
    // Logic from previous fix-links script would go here
    // For now, implementing a placeholder or specific known fix
    console.log("No automated fix routines defined currently.");
}

main();

