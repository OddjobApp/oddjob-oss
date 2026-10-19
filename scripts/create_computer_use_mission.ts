import { db } from "../server/database_service.js";
import { missions, jobs, pipelines, pipelineSteps, orgSettings } from "../shared/schema/index.js";
import { executionManager } from "../server/domain/pipeline/core/execution-manager.js";
import { getSystemOrgContext } from "../server/utils/auth-context.js";
import { eq, and } from "drizzle-orm";

async function main() {
    console.log("🚀 Starting Computer Use Mission Creation...");

    // Enable mock mode for Trycua
    process.env.TRYCUA_MOCK = "true";
    console.log("ℹ️ TRYCUA_MOCK set to true");

    const orgId = 1; // Default Org

    try {
        // 1. Ensure Trycua is enabled for Org 1
        console.log("🔍 Checking Org Settings...");
        const [settings] = await db.select().from(orgSettings).where(eq(orgSettings.organizationId, orgId)).limit(1);
        
        if (!settings) {
            console.log("➕ Creating Org Settings...");
            await db.insert(orgSettings).values({
                organizationId: orgId,
                trycuaEnabled: true,
                trycuaDefaultOs: "windows",
                trycuaMaxSessionTime: 60
            });
        } else if (!settings.trycuaEnabled) {
            console.log("Updating Org Settings to enable Trycua...");
            await db.update(orgSettings).set({ trycuaEnabled: true }).where(eq(orgSettings.organizationId, orgId));
        }
        console.log("✅ Trycua enabled for Org 1");

        // 2. Create Mission
        console.log("Creating Mission...");
        const [mission] = await db.insert(missions).values({
            name: "Automated Research via Computer Use",
            description: "A mission to test agent-driven desktop automation using Trycua.",
            type: "supervisor_led",
            organizationId: orgId,
            objective: "Verify that the computer use agent can execute actions in a sandboxed environment.",
            status: "active",
            createdBy: "antigravity",
            executionStrategy: "pre_planned"
        }).returning();
        console.log(`✅ Mission created with ID: ${mission.id}`);

        // 3. Create or Find Job
        console.log("🔍 Checking for existing Job...");
        const [existingJob] = await db.select().from(jobs).where(and(eq(jobs.name, "Search for DeepMind"), eq(jobs.organizationId, orgId))).limit(1);
        
        let jobId;
        if (existingJob) {
            console.log(`✅ Found existing Job with ID: ${existingJob.id}`);
            jobId = existingJob.id;
        } else {
            console.log("Creating Job...");
            const [job] = await db.insert(jobs).values({
                name: "Search for DeepMind",
                type: "computer_use",
                organizationId: orgId,
                createdBy: "antigravity",
                config: {
                    goal: "Open a browser and search for 'DeepMind' on Google. Take a screenshot of the results.",
                    os: "windows",
                    maxIterations: 5
                },
                tool: "None"
            }).returning();
            console.log(`✅ Job created with ID: ${job.id}`);
            jobId = job.id;
        }

        // 4. Create or Find Pipeline
        console.log("🔍 Checking for existing Pipeline...");
        const [existingPipeline] = await db.select().from(pipelines).where(and(eq(pipelines.name, "Computer Use Test Pipeline"), eq(pipelines.organizationId, orgId))).limit(1);
        
        let pipelineId;
        if (existingPipeline) {
            console.log(`✅ Found existing Pipeline with ID: ${existingPipeline.id}`);
            pipelineId = existingPipeline.id;
        } else {
            console.log("Creating Pipeline...");
            const [pipeline] = await db.insert(pipelines).values({
                organizationId: orgId,
                name: "Computer Use Test Pipeline",
                description: "Pipeline for Computer Use Mission",
                triggerType: "manual",
                lifecycleStatus: "active",
                createdBy: "antigravity"
            }).returning();
            console.log(`✅ Pipeline created with ID: ${pipeline.id}`);
            pipelineId = pipeline.id;
            
            // Create step only if we created a new pipeline
            console.log("Creating Pipeline Step...");
            await db.insert(pipelineSteps).values({
                pipelineId: pipelineId,
                jobId: jobId,
                order: 0,
                outputName: "search_results"
            });
            console.log("✅ Pipeline step created");
        }

        // 6. Run Pipeline
        console.log("🏃 Running Pipeline...");
        const orgContext = getSystemOrgContext(orgId);
        const result = await executionManager.run(pipelineId, { missionId: mission.id }, orgContext);
        
        console.log("🎉 Pipeline execution triggered!");
        console.log("Result:", JSON.stringify(result, null, 2));

    } catch (error) {
        console.error("❌ Failed to complete mission flow:", error);
    }
}

main().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
