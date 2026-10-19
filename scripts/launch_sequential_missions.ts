
import { db } from "../server/database_service.js";
import { missionRuns, missions } from "../shared/schema/index.js";
import { rollingWaveOrchestratorService } from "../server/domain/mission/core/rolling-wave-orchestrator.service.js";

async function launchMission(name: string, objective: string) {
    const userId = 'a4633e43-4be0-4844-bcc0-aec618eaccf4';
    const [mission] = await db.insert(missions).values({
        name,
        objective,
        organizationId: 1,
        executionStrategy: 'dynamic',
        createdBy: userId
    }).returning();

    const launch = await rollingWaveOrchestratorService.launchMission(mission.id, userId, 1);
    console.log(`✅ Launched Mission: ${name} (Run ID: ${launch.missionRunId})`);
    return launch;
}

async function main() {
    console.log("🚀 Launching 3 Sequential Missions...");

    await launchMission(
        'System Integrity Blueprint',
        'Perform a comprehensive audit of all system jobs, identify failed processes, and report on overall system health using the get_system_health and list_failed_jobs tools.'
    );

    await launchMission(
        'Market Intelligence Synthesis',
        'Research the latest trends in Agentic AI and multi-agent orchestration. Save the findings to storage/docs/market_intelligence.md.'
    );

    await launchMission(
        'Security Vulnerability Triage',
        'Analyze recent system logs and failed job metadata to identify potential security risks or common failure patterns. Report the findings to the admin.'
    );

    console.log("\n✨ All missions queued for sequential execution.");
    process.exit(0);
}

main().catch(console.error);
