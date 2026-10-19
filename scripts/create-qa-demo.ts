import "dotenv/config";
import { db } from "../server/db/index.js";
import { orgs, jobs, pipelines, pipelineSteps, pipelineInputParams, agentDeployments } from "@shared/schema/index.js";
import { missionTemplates } from "../shared/schema/missions";
import { AgentDeploymentService } from "../server/domain/agents/agent-deployment.service";
import { eq, and } from "drizzle-orm";

async function createDemo() {
    console.log("🚀 Starting QA Demo Setup...");

    // 1. Ensure Org exists
    const orgName = "Acme";
    console.log(`🔍 Checking for Org: ${orgName}`);
    let [org] = await db.select().from(orgs).where(eq(orgs.name, orgName)).limit(1);

    if (!org) {
        const result = await db.insert(orgs).values({
            name: orgName,
        }).returning();
        org = result[0];
        console.log(`✅ Org Created: ${org.name} (ID: ${org.id})`);
    } else {
        console.log(`✅ Using Org: ${org.name} (ID: ${org.id})`);
    }

    // 2. Ensure Mission Template exists
    const templateName = "On-Demand Service Dispatch";
    console.log(`🔍 Checking for Mission Template: ${templateName}`);
    let [template] = await db.select().from(missionTemplates).where(eq(missionTemplates.name, templateName)).limit(1);

    if (!template) {
        console.log(`✨ Creating Mission Template: ${templateName}`);
        const result = await db.insert(missionTemplates).values({
            name: templateName,
            description: "A template for on-demand field service Dispatch.",
            config: {
                defaultStatus: "REQUESTED",
                autoAssign: false
            },
            organizationId: org.id,
            createdBy: "system"
        }).returning();
        template = result[0];
        console.log(`✅ Mission Template Created (ID: ${template.id})`);
    } else {
        console.log(`✅ Using Mission Template (ID: ${template.id})`);
    }

    // 3. Ensure Dispatcher Job exists
    const dispatcherJobName = "QA Demo: Dispatch Node";
    console.log(`🔍 Checking for Dispatcher Job: ${dispatcherJobName}`);
    let [dispatcherJob] = await db.select().from(jobs).where(and(eq(jobs.name, dispatcherJobName), eq(jobs.organizationId, org.id))).limit(1);

    const dispatcherJobConfig = {
        missionTemplateId: template.id,
        serviceType: "HVACHL",
        userLocationSource: "variable",
        userLocationVar: "{{location}}",
        isDemoMode: true
    };

    if (!dispatcherJob) {
        console.log(`✨ Creating Dispatcher Job: ${dispatcherJobName}`);
        const result = await db.insert(jobs).values({
            name: dispatcherJobName,
            description: "Direct dispatch node for QA testing.",
            type: "dispatcher",
            config: dispatcherJobConfig,
            organizationId: org.id,
            createdBy: "system",
            isActive: true,
            tool: "None"
        }).returning();
        dispatcherJob = result[0];
        console.log(`✅ Dispatcher Job Created (ID: ${dispatcherJob.id})`);
    } else {
        console.log(`🔄 Updating Dispatcher Job Config...`);
        await db.update(jobs).set({ config: dispatcherJobConfig }).where(eq(jobs.id, dispatcherJob.id));
        console.log(`✅ Dispatcher Job Config Updated.`);
    }

    // 4. Ensure Pipeline exists
    const pipelineName = "QA Dispatch Workflow";
    console.log(`🔍 Checking for Pipeline: ${pipelineName}`);
    let [pipeline] = await db.select().from(pipelines).where(and(eq(pipelines.name, pipelineName), eq(pipelines.organizationId, org.id))).limit(1);

    if (!pipeline) {
        console.log(`✨ Creating Pipeline: ${pipelineName}`);
        const result = await db.insert(pipelines).values({
            name: pipelineName,
            description: "A demo pipeline for QA to test service dispatch via chat.",
            organizationId: org.id,
            triggerType: "manual",
            isActive: true,
            createdBy: "system"
        }).returning();
        pipeline = result[0];
        console.log(`✅ Pipeline Created: ${pipeline.name} (ID: ${pipeline.id})`);
    } else {
        console.log(`✅ Using Pipeline: ${pipeline.name} (ID: ${pipeline.id})`);
    }

    // 5. Ensure Pipeline Step exists
    console.log(`🔍 Checking for Pipeline Steps...`);
    let [step] = await db.select().from(pipelineSteps).where(eq(pipelineSteps.pipelineId, pipeline.id)).limit(1);
    if (!step) {
        console.log(`✨ Adding Pipeline Step...`);
        const result = await db.insert(pipelineSteps).values({
            pipelineId: pipeline.id,
            jobId: dispatcherJob.id,
            order: 0,
            outputName: "dispatch_result",
            runOnCondition: "on_success",
        } as any).returning();
        step = result[0];
        console.log(`✅ Pipeline Step Added.`);
    } else {
        console.log(`✅ Pipeline Step already exists.`);
    }

    // 6. Ensure Explicit Input Param exists
    console.log(`🔍 Checking for 'location' parameter...`);
    let [param] = await db.select().from(pipelineInputParams).where(and(eq(pipelineInputParams.pipelineId, pipeline.id), eq(pipelineInputParams.name, "location"))).limit(1);
    if (!param) {
        console.log(`✨ Creating 'location' parameter with type 'location'...`);
        await db.insert(pipelineInputParams).values({
            pipelineId: pipeline.id,
            name: "location",
            label: "Dispatch Location",
            dataType: "location" as any,
            isRequired: true,
            displayOrder: 0
        });
        console.log(`✅ Explicit Location Param Added.`);
    } else {
        console.log(`🔄 Ensuring parameter type is 'location'...`);
        await db.update(pipelineInputParams).set({ dataType: "location" as any }).where(eq(pipelineInputParams.id, param.id));
        console.log(`✅ Location Param type verified/updated.`);
    }

    // 7. Refresh formManifest on the agent deployment so the location type is picked up
    console.log(`🔍 Finding agent deployment for job: ${dispatcherJob.name}...`);
    const [deployment] = await db.select().from(agentDeployments).where(eq(agentDeployments.jobId, dispatcherJob.id)).limit(1);
    if (deployment) {
        console.log(`🔄 Refreshing formManifest for deployment ${deployment.id}...`);
        const newManifest = await AgentDeploymentService.updateManifest(deployment.id);
        for (const [pid, entry] of Object.entries(newManifest)) {
            const e = entry as any;
            console.log(`  Pipeline ${pid} (${e.pipelineName}): fields = ${e.fields.map((f: any) => `${f.name}:${f.type}`).join(', ')}`);
        }
        console.log(`✅ FormManifest refreshed successfully.`);
    } else {
        console.log(`⚠️  No agent deployment found for job ${dispatcherJob.id}. Manifest not refreshed.`);
    }

    console.log("🏁 QA Demo Setup Completed Successfully!");
    process.exit(0);
}

createDemo().catch(err => {
    console.error("❌ Setup Failed:", err);
    process.exit(1);
});
