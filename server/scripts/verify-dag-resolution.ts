
import "dotenv/config";
import { workstreamProvisioner } from "@domain/pipeline/core/workstream-provisioner.service.js";
import { db } from "../database_service.js";
import { orgs, pipelines, pipelineSteps, missions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function verify() {
    console.log("--- Starting DAG Resolution Verification ---");

    const uniqueId = Math.random().toString(36).substring(7);
    const orgName = `DAG Test Org ${uniqueId}`;

    // 1. Setup mock org
    const [org] = await db.insert(orgs).values({ name: orgName }).returning();

    // 2. Create a Mock Mission
    const [mission] = await db.insert(missions).values({
        name: "Branching Test Mission",
        objective: "Test non-linear branching logic in workstreams.",
        organizationId: org.id,
        createdBy: "system"
    }).returning();

    // 3. Define a Branching Workflow
    const workflow = {
        trigger: { type: "Manual" },
        nodes: [
            { id: "start", type: "agent", role: "Starter", suggestedConfig: { goal: "Start things" } },
            { id: "decide", type: "modifier", modifierType: "Decision Branch", config: { eval: "result >= 10" } },
            { id: "path_a", type: "agent", role: "Path A", suggestedConfig: { goal: "Path A" } },
            { id: "path_b", type: "agent", role: "Path B", suggestedConfig: { goal: "Path B" } }
        ],
        edges: [
            { from: "start", to: "decide" },
            { from: "decide", to: "path_a", condition: "true" },
            { from: "decide", to: "path_b", condition: "false" }
        ]
    };

    // 4. Provision
    console.log("Provisioning branching workstream...");
    const { pipelineId } = await workstreamProvisioner.provisionWorkstream(mission.id, workflow as any, org.id, "system");

    // 5. Verify Branching
    console.log("Verifying branch routing...");
    const steps = await db.select().from(pipelineSteps).where(eq(pipelineSteps.pipelineId, pipelineId));

    const startStep = steps.find(s => s.outputName === 'start');
    const decideStep = steps.find(s => s.outputName === 'decide');
    const pathAStep = steps.find(s => s.outputName === 'path_a');
    const pathBStep = steps.find(s => s.outputName === 'path_b');

    if (startStep?.destinationStepId === decideStep?.id) {
        console.log("SUCCESS: 'start' correctly routes to 'decide'.");
    } else {
        console.error("FAILED: 'start' routing incorrect.");
    }

    // Checking Decide -> Path A/B
    console.log(`'decide' destinationStepId: ${decideStep?.destinationStepId}`);
    console.log(`'decide' config: ${JSON.stringify(decideStep?.decisionNodeConfig, null, 2)}`);

    const config = decideStep?.decisionNodeConfig as any;
    if (config?.routes?.onMatch?.destinationStepId === pathAStep?.id) {
        console.log("SUCCESS: 'decide' onMatch routes to 'path_a'.");
    }
    if (config?.routes?.onMismatch?.destinationStepId === pathBStep?.id) {
        console.log("SUCCESS: 'decide' onMismatch routes to 'path_b'.");
    }

    console.log("\n--- Verification Complete ---");
    process.exit(0);
}

verify().catch(err => {
    console.error("Verification failed:", err);
    process.exit(1);
});

