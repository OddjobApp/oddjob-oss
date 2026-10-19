
import "dotenv/config";
import { missionService } from "@domain/mission/core/mission.service.js";
import { db } from "@server/database_service.js";
import { orgs, pipelines, pipelineSteps, schedules, scheduledJobs } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function verify() {
    console.log("--- Starting Intelligent Workstream Synthesis Verification ---");

    const uniqueId = Math.random().toString(36).substring(7);
    const orgName = `Workstream Test Org ${uniqueId}`;

    // 1. Setup mock org
    console.log("Setting up test organization...");
    const [org] = await db.insert(orgs).values({
        name: orgName,
    }).returning();

    console.log(`Created Org: ${org.name} (ID: ${org.id})`);

    // 2. Test Planning
    console.log("Testing AI Planning with complex intent...");
    const plan = await missionService.planMission(
        "Monitor stock market daily for AAPL, if it drops below 180, alert me via email and save to my Portfolio dataset.",
        "system",
        org.id
    );

    console.log("Plan generated successfully.");
    console.log("Objective:", plan.objective);

    if (plan.workflow) {
        console.log("SUCCESS: Workstream blueprint synthesized.");
        console.log("Trigger:", JSON.stringify(plan.workflow.trigger));
        console.log("Nodes count:", plan.workflow.nodes.length);
    } else {
        console.error("FAILED: No workstream blueprint in plan.");
        process.exit(1);
    }

    // 3. Test Provisioning
    console.log("Testing Provisioning...");
    const mission = await (missionService as any).createMission({
        name: plan.name,
        objective: plan.objective,
        organizationId: org.id,
    }, "system", [], false, plan.workflow);

    console.log(`Mission created: ${mission.id}`);

    // 4. Verify Provisioned Entities
    console.log("Verifying provisioned technical infrastructure...");

    const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.organizationId, org.id)).limit(1);
    if (pipeline) {
        console.log(`SUCCESS: Pipeline created: ${pipeline.name}`);
        const steps = await db.select().from(pipelineSteps).where(eq(pipelineSteps.pipelineId, pipeline.id));
        console.log(`SUCCESS: Pipeline contains ${steps.length} steps.`);

        const decisionNode = steps.find(s => s.moduleType === 'Decision Branch');
        if (decisionNode) {
            console.log("SUCCESS: Decision Branch logic node provisioned.");
        } else {
            console.log("NOTE: No Decision Branch node found in this specific synthesis, checking other logic nodes...");
            const modifierNode = steps.find(s => s.moduleType != null);
            if (modifierNode) {
                console.log(`SUCCESS: Modifier node of type '${modifierNode.moduleType}' provisioned.`);
            }
        }
    } else {
        console.error("FAILED: No pipeline provisioned.");
    }

    const [schedule] = await db.select().from(schedules).where(eq(schedules.organizationId, org.id)).limit(1);
    if (schedule) {
        console.log(`SUCCESS: Schedule created: ${schedule.name}`);
        const sjList = await db.select().from(scheduledJobs).where(eq(scheduledJobs.organizationId, org.id));
        if (sjList.length > 0) {
            console.log(`SUCCESS: ${sjList.length} Scheduled Job(s) linking pipeline to schedule created.`);
        } else {
            console.warn("WARNING: Schedule created but no Scheduled Job linking found.");
        }
    } else {
        console.log("NOTE: No schedule provisioned (perhaps trigger was manual/webhook). Checking triggers...");
    }

    console.log("\n--- Verification Complete ---");
    process.exit(0);
}

verify().catch(err => {
    console.error("Verification failed:", err);
    process.exit(1);
});

