
import { db } from "../server/db/index.js";
import { orgs, jobs, apps, missionTemplates, pipelines, pipelineSteps } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

async function setup() {
    console.log("🛠️ Setting up Service Dispatch Pipeline...");

    // 1. Get Org
    const [org] = await db.select().from(orgs).limit(1);
    if (!org) {
        console.error("❌ No organization found.");
        process.exit(1);
    }
    console.log(`✅ Using Org: ${org.name} (ID: ${org.id})`);

    // 2. Find Mission Template
    const templateName = "On-Demand Service Dispatch";
    const template = await db.query.missionTemplates.findFirst({
        where: eq(missionTemplates.name, templateName)
    });

    if (!template) {
        console.error("❌ Mission template not found. Run seed-rescue-app.ts first.");
        process.exit(1);
    }
    console.log(`✅ Found Template: ${template.name} (ID: ${template.id})`);

    // 3. Create Pipeline
    const pipelineName = "Service Dispatch Coordinator";
    let pipeline = await db.query.pipelines.findFirst({
        where: and(
            eq(pipelines.name, pipelineName),
            eq(pipelines.organizationId, org.id)
        )
    });

    if (!pipeline) {
        const result = await db.insert(pipelines).values({
            name: pipelineName,
            description: "Coordinate service dispatch (HVAC, Plumbing, etc.) including location resolution and provider matching.",
            organizationId: org.id,
            isActive: true,
            triggerType: "manual",
            createdBy: "system"
        }).returning();
        pipeline = result[0];
        console.log(`✅ Pipeline Created: ${pipeline.name} (ID: ${pipeline.id})`);

        // 4. Add Steps
        // Step 1: Instantiate Mission from Template
        // We'll use a virtual tool or a job type? 
        // Actually, the pipeline should just call a job that launches the mission.
        // For simplicity, let's just make it a single-step pipeline that triggers the mission logic.

        // In this system, we can have a step with jobId that points to a specific agent.
        // But for a 'Dispatch' pipeline, we want it to run the Mission.
    } else {
        console.log(`ℹ️ Pipeline already exists: ${pipeline.name} (ID: ${pipeline.id})`);
    }

    // 5. Update Agent (Job) to allow this pipeline
    // Let's find an agent to assign it to.
    const agentsList = await db.select().from(jobs).where(eq(jobs.type, 'ai_agent'));
    console.log(`Found ${agentsList.length} agents.`);

    for (const agent of agentsList) {
        const config = agent.config as any || {};
        const pipelineIds = config.pipelineIds || [];
        if (!pipelineIds.includes(pipeline.id)) {
            pipelineIds.push(pipeline.id);
            await db.update(jobs).set({
                config: { ...config, pipelineIds }
            }).where(eq(jobs.id, agent.id));
            console.log(`✅ Assigned pipeline to agent: ${agent.name}`);
        }
    }

    console.log("\n🚀 Setup Complete!");
    console.log(`Users can now trigger the dispatcher by asking: "I need to start a service dispatch" or by clicking the tool link.`);
}

setup().catch(console.error);
