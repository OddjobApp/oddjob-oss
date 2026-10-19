import { db } from "../server/database_service.js";
import { missions } from "../shared/schema/index.js";
import { rollingWaveOrchestratorService } from "../server/domain/mission/core/rolling-wave-orchestrator.service.js";

async function main() {
    const userId = "admin-user-id";
    const orgId = 1;

    console.log("Creating test prediction mission...");

    const [mission] = await db.insert(missions).values({
        name: "Customer Churn Prediction Test",
        objective: "Predict customer churn risk using the dataset. Identify high risk patterns.",
        organizationId: orgId,
        createdBy: userId,
        executionStrategy: "rolling_wave",
        status: 'active'
    } as any).returning();

    console.log(`Created mission: ${mission.name} (ID: ${mission.id})`);

    console.log("Launching mission in rolling wave mode...");
    const result: any = await rollingWaveOrchestratorService.launchMission(mission.id, userId, orgId);
    
    if (result.success) {
        console.log(`Successfully launched mission run: ${result.missionRunId}`);
        console.log("Check the UI or database to verify that the 'Synthesized Prediction Analyst' worker was created!");
    } else {
        console.error(`Failed to launch mission: ${result.error || 'Unknown error'}`);
    }

    process.exit(0);
}

main().catch(console.error);
