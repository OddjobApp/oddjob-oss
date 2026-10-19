import { db } from "../server/database_service.js";
import { missions, jobs, pipelines, pipelineSteps, orgSettings, operationalCycles, missionRuns } from "../shared/schema/index.js";
import { executionManager } from "../server/domain/pipeline/core/execution-manager.js";
import { getSystemOrgContext } from "../server/utils/auth-context.js";
import { eq, and } from "drizzle-orm";

async function main() {
    const orgIdArg = process.argv[2];
    if (!orgIdArg || isNaN(Number(orgIdArg))) {
        console.error("Usage: npx tsx scripts/test_computer_use_cycle.ts <orgId>");
        console.error("  orgId  — required; the organization ID to run the test against (e.g. 1)");
        process.exit(1);
    }
    const orgId = Number(orgIdArg);

    console.log(`Starting Computer Use Mission Creation with Business Cycle for org ${orgId}...`);

    // Using Selenium job type instead of Trycua
    if (process.env.NODE_ENV === "production") {
        console.error("This script must not be run in production.");
        process.exit(1);
    }
    process.env.SKIP_GEMINI_EMBEDDINGS = "true";

    try {
        // 1. Ensure Trycua is enabled for the target org
        console.log("Checking Org Settings...");
        const [settings] = await db.select().from(orgSettings).where(eq(orgSettings.organizationId, orgId)).limit(1);
        
        if (!settings) {
            console.log("Creating default org settings...");
            await db.insert(orgSettings).values({
                organizationId: orgId,
                trycuaEnabled: true
            });
        } else if (!settings.trycuaEnabled) {
            console.log("Updating org settings to enable Trycua...");
            await db.update(orgSettings).set({ trycuaEnabled: true }).where(eq(orgSettings.organizationId, orgId));
        }
        console.log(`Trycua enabled for org ${orgId}`);;

        // 2. Create Business Cycle
        console.log("Creating Business Cycle...");
        const [cycle] = await db.insert(operationalCycles).values({
            name: "Test Computer Use Cycle",
            objective: "Verify computer use job type within a cycle",
            status: "active",
            createdBy: "antigravity",
            organizationId: orgId
        }).returning();
        console.log(`✅ Business Cycle created with ID: ${cycle.id}`);

        // 3. Create Mission
        console.log("Creating Mission...");
        const [mission] = await db.insert(missions).values({
            name: "Test Computer Use Mission",
            objective: "Verify that the Selenium auto-pilot can successfully search for 'DeepMind' on Google and capture results.",
            organizationId: orgId,
            createdBy: "antigravity",
            status: "active"
        }).returning();
        console.log(`✅ Mission created with ID: ${mission.id}`);

        // 4. Create Mission Run
        console.log("Creating Mission Run...");
        const [run] = await db.insert(missionRuns).values({
            missionId: mission.id,
            cycleId: cycle.id,
            organizationId: orgId,
            name: `Run for ${mission.name}`,
            createdBy: "antigravity",
            status: "active"
        }).returning();
        console.log(`✅ Mission Run created with ID: ${run.id}`);

        // 5. Create Job
        console.log("Creating Job...");
        const [job] = await db.insert(jobs).values({
            name: `Search for DeepMind via Cycle ${cycle.id}`,
            type: "selenium",
            organizationId: orgId,
            createdBy: "antigravity",
            config: {
                mode: "auto_pilot",
                startUrl: "https://www.google.com",
                goal: "Search for 'DeepMind' on Google. Take a screenshot of the results.",
                headless: false,
                maxSteps: 5
            },
            tool: "None"
        }).returning();
        console.log(`✅ Job created with ID: ${job.id}`);

        // 6. Create Pipeline
        console.log("Creating Pipeline...");
        const [pipeline] = await db.insert(pipelines).values({
            name: `Computer Use Pipeline via Cycle ${cycle.id}`,
            organizationId: orgId,
            createdBy: "antigravity",
            triggerType: "manual",
            lifecycleStatus: "active"
        }).returning();
        console.log(`✅ Pipeline created with ID: ${pipeline.id}`);

        // 7. Create Step
        console.log("Creating Step...");
        const [step] = await db.insert(pipelineSteps).values({
            pipelineId: pipeline.id,
            jobId: job.id,
            order: 1,
            outputName: "search_results",
            onFailureAction: "Stop Pipeline"
        }).returning();
        console.log(`✅ Step created with ID: ${step.id}`);

        // 8. Run Pipeline
        console.log("🏃 Running Pipeline...");
        const orgContext = getSystemOrgContext(orgId);
        const result = await executionManager.run(pipeline.id, { missionId: mission.id, missionRunId: run.id }, orgContext);

        console.log("✅ Pipeline Execution Started!");
        console.log("Result:", JSON.stringify(result, null, 2));

    } catch (error) {
        console.error("❌ Error creating cycle/mission/job:", error);
    } finally {
        process.exit(0);
    }
}

main();
