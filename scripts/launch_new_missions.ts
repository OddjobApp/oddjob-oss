
import { db } from "../server/database_service.js";
import { missions, missionRuns } from "../shared/schema/index.js";
import { rollingWaveOrchestratorService } from "../server/domain/mission/core/rolling-wave-orchestrator.service.js";

async function main() {
    const userId = "admin-user-id"; // Placeholder, will be resolved by orchestrator
    const orgId = 1;

    const missionDefinitions = [
        {
            name: "OSS Sustainability Audit",
            objective: "Perform a deep sustainability audit of the 'drizzle-team/drizzle-orm' GitHub repository. Check for recent activity, issue resolution speed, and community engagement vibe. Use list_github_repos and get_github_repo_details tools.",
            executionStrategy: "rolling_wave",
            members: [
                { role: "OSS Auditor", description: "Specialist in analyzing open source project health." },
                { role: "Dependency Scout", description: "Identify risks in project dependencies." }
            ]
        },
        {
            name: "Video Intelligence Synthesis",
            objective: "Analyze the top 3 YouTube videos about 'Agentic AI Workflows 2026'. Extract transcripts, summarize core architectural patterns, and evaluate the strategic impact. Use search_youtube and get_video_transcript tools.",
            executionStrategy: "rolling_wave",
            members: [
                { role: "AV Researcher", description: "Expert in extracting intelligence from multimedia content." },
                { role: "Narrative Architect", description: "Synthesize complex technical narratives into actionable reports." }
            ]
        },
        {
            name: "Operational Performance Dashboard",
            objective: "Analyze the Oddjob platform's internal operational metrics. Query the analytics database to find the most expensive job types and correlate them with success rates. Use query_analytics_db and list_jobs tools.",
            executionStrategy: "rolling_wave",
            members: [
                { role: "Data Scientist", description: "Specialist in operational analytics and trend detection." },
                { role: "Metric Reporter", description: "Translate raw data into high-level business intelligence." }
            ]
        }
    ];

    for (const def of missionDefinitions) {
        const [mission] = await db.insert(missions).values({
            name: def.name,
            objective: def.objective,
            organizationId: orgId,
            createdBy: userId,
            executionStrategy: def.executionStrategy,
            status: 'active'
        } as any).returning();

        console.log(`Created mission: ${mission.name} (ID: ${mission.id})`);

        const result: any = await rollingWaveOrchestratorService.launchMission(mission.id, userId, orgId);
        if (result.success) {
            console.log(`Launched mission run: ${result.missionRunId}`);
        } else {
            console.error(`Failed to launch mission: ${result.error || 'Unknown error'}`);
        }
    }

    process.exit(0);
}

main().catch(console.error);
