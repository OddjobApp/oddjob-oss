/**
 * Launch Training Evaluation Runs for TECHHEAD7 SDLC Agents
 *
 * Triggers the "Evaluation Run" mission (mission-eval-1) for each of the 5
 * SDLC agents in the TECHHEAD7 org (ID 291), passing training plan metadata.
 *
 * Target Agents:
 *   - Systems Analyst (job 1059) — TM-01
 *   - Backend Developer (job 1061) — TM-02
 *   - QA Automation Engineer (job 1064) — TM-03
 *   - Scrum Master & Agile Coach (job 1058) — TM-04
 *   - Database Administrator (job 1065) — TM-05
 *
 * Usage: npx tsx server/scripts/launch-training-evals-techhead7.ts
 */
import "dotenv/config";
import { db } from "../database_service.js";
import { missions, users, orgs } from "@shared/schema/index.js";
import { missionExecutionService } from "../domain/mission/core/mission-execution.service.js";
import { jobExecutorRegistry } from "../domain/jobs/core/executors/index.js";
import { eq, and } from "drizzle-orm";

const ORG_ID = 291;
const EVALUATION_MISSION_NAME = "Evaluation Run";

interface TargetAgent {
    name: string;
    jobId: number;
    trainingPlanId: string;
}

const TARGET_AGENTS: TargetAgent[] = [
    { name: "Systems Analyst", jobId: 1059, trainingPlanId: "TM-01" },
    { name: "Backend Developer", jobId: 1061, trainingPlanId: "TM-02" },
    { name: "QA Automation Engineer", jobId: 1064, trainingPlanId: "TM-03" },
    { name: "Scrum Master & Agile Coach", jobId: 1058, trainingPlanId: "TM-04" },
    { name: "Database Administrator", jobId: 1065, trainingPlanId: "TM-05" },
];

async function launchTrainingEvals() {
    console.log("══════════════════════════════════════════════════════════════");
    console.log("🧠 Launching Agent Training Evaluation Runs — TECHHEAD7 (Org 291)");
    console.log("══════════════════════════════════════════════════════════════\n");

    // Initialize the job executor registry
    await jobExecutorRegistry.autoRegister();

    // 1. Get a system user for the launch context
    const [user] = await db.select().from(users).limit(1);
    const userId = user?.id || "system";
    console.log(`Using User ID: ${userId}`);

    // 2. Find org dynamically
    let [org] = await db.select().from(orgs).where(eq(orgs.name, "TECHHEAD7")).limit(1);
    if (!org) [org] = await db.select().from(orgs).limit(1);
    const targetOrgId = org ? org.id : 1;

    // Find the Evaluation Run mission or TM-01
    let [evalMission] = await db
        .select()
        .from(missions)
        .where(
            and(
                eq(missions.organizationId, targetOrgId),
                eq(missions.name, EVALUATION_MISSION_NAME)
            )
        )
        .limit(1);

    if (!evalMission) {
        [evalMission] = await db
            .select()
            .from(missions)
            .where(eq(missions.organizationId, targetOrgId))
            .limit(1);
    }

    if (!evalMission) {
        console.error(`\n❌ No mission found in org ${targetOrgId}.`);
        console.error("   Run: npx tsx server/scripts/seed-training-missions-techhead7.ts\n");
        process.exit(1);
    }

    console.log(`✅ Found mission: "${evalMission.name}" (ID: ${evalMission.id})`);
    console.log(`   Strategy: ${evalMission.executionStrategy}`);
    console.log(`   Status: ${evalMission.status}\n`);

    // 3. Launch the mission for each target agent
    const results: Array<{ agent: string; success: boolean; missionRunId?: number; error?: string }> = [];

    for (const agent of TARGET_AGENTS) {
        console.log(`\n🚀 Launching eval for: ${agent.name} (Job ${agent.jobId}, Plan ${agent.trainingPlanId})`);

        const metadata = {
            targetAgentJobId: agent.jobId,
            targetAgentName: agent.name,
            trainingPlanId: agent.trainingPlanId,
            evaluationType: "agent-training-cycle",
            launchedBy: "launch-training-evals-techhead7",
            launchedAt: new Date().toISOString(),
        };

        try {
            // Find job dynamically for this org
            const { jobs } = await import("@shared/schema/index.js");
            const [job] = await db.select().from(jobs).where(and(eq(jobs.organizationId, targetOrgId), eq(jobs.name, agent.name))).limit(1);
            const actualJobId = job ? job.id : agent.jobId;

            const result = await missionExecutionService.launchMission(
                evalMission.id,
                userId,
                targetOrgId,
                undefined, // existingRunId
                undefined, // parentId
                { ...metadata, targetAgentJobId: actualJobId }
            );

            results.push({
                agent: agent.name,
                success: result.success,
                missionRunId: result.missionRunId,
                error: result.error,
            });

            if (result.success) {
                console.log(`   ✅ Success — Mission Run ID: ${result.missionRunId}, Execution ID: ${result.executionId}`);
            } else {
                console.log(`   ⚠️  Failed — ${result.error}`);
            }
        } catch (err: any) {
            results.push({
                agent: agent.name,
                success: false,
                error: err.message,
            });
            console.error(`   ❌ Error: ${err.message}`);
        }

        // Small delay between launches to avoid overwhelming the system
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // 4. Summary
    console.log("\n══════════════════════════════════════════════════════════════");
    console.log("📊 Launch Summary");
    console.log("══════════════════════════════════════════════════════════════");

    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    console.log(`\n   Total:      ${results.length}`);
    console.log(`   Successful: ${successful.length}`);
    console.log(`   Failed:     ${failed.length}\n`);

    for (const r of results) {
        const icon = r.success ? "✅" : "❌";
        const detail = r.success ? `Run #${r.missionRunId}` : r.error;
        console.log(`   ${icon} ${r.agent.padEnd(30)} ${detail}`);
    }

    console.log("\n══════════════════════════════════════════════════════════════\n");

    if (failed.length > 0) {
        process.exit(1);
    }
    process.exit(0);
}

launchTrainingEvals().catch((e) => {
    console.error("\n❌ Unhandled error:", e);
    process.exit(1);
});
