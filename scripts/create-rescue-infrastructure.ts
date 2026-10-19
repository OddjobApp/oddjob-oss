
import { db } from "../server/db/index.js";
import { hilForms, jobs, pipelines, pipelineSteps, users } from "../shared/schema/index.js";
import { eq, and, isNull } from "drizzle-orm";

async function createRescueInfrastructure() {
    console.log("=== Creating Mission Rescue Infrastructure ===");

    // Use the admin ID we found earlier
    const adminId = "4f7e1c1e-418e-447f-acca-dd2ca0cad03b";

    // 1. Create Mission Rescue Form
    let [rescueForm] = await db.select().from(hilForms).where(eq(hilForms.name, "Mission Rescue & Recovery Form")).limit(1);
    if (!rescueForm) {
        console.log("🚀 Creating Mission Rescue & Recovery Form...");
        [rescueForm] = await db.insert(hilForms).values({
            name: "Mission Rescue & Recovery Form",
            description: "A specialized form for high-stakes mission recovery decisions when an autonomous agent encounters a terminal impediment.",
            schema: {
                fields: [
                    {
                        key: "recovery_strategy",
                        type: "select",
                        label: "Select Recovery Strategy",
                        description: "Choose how the mission should proceed given the current impediment.",
                        options: [
                            { label: "Retry (Immediate)", value: "retry" },
                            { label: "Backoff and Retry (Delayed)", value: "backoff_retry" },
                            { label: "Relax Constraint (Proceed with lower requirements)", value: "relax_constraint" },
                            { label: "Find New Path (Re-evaluate strategy)", value: "new_path" },
                            { label: "Replan & Reprioritize (Change task list)", value: "replan" },
                            { label: "Safe State (Pause and wait for manual commands)", value: "safe_state" },
                            { label: "Terminal Reset (Notify user and stop mission)", value: "reset" }
                        ],
                        required: true
                    },
                    {
                        key: "justification",
                        type: "textarea",
                        label: "Reasoning / Additional Instructions",
                        description: "Provide any extra context for the agent to follow during recovery.",
                        required: false
                    }
                ]
            } as any,
            themeConfig: {
                logoUrl: "",
                companyName: "Oddjob Mission Control",
                primaryColor: "#E11D48" // Rose/Red for rescue
            },
            securityConfig: {
                requireOtp: false,
                tokenExpirationHours: 24
            },
            organizationId: null,
            isArchived: false,
            createdBy: adminId
        }).returning();
    }
    console.log(`✅ Mission Rescue Form ID: ${rescueForm.id}`);

    // 2. Create Mission Rescue Job
    let [rescueJob] = await db.select().from(jobs).where(eq(jobs.name, "Initiate Mission Rescue")).limit(1);
    if (!rescueJob) {
        console.log("🚀 Creating Initiate Mission Rescue Job...");
        [rescueJob] = await db.insert(jobs).values({
            name: "Initiate Mission Rescue",
            description: "Triggers a high-fidelity recovery decision form for the Mission Commander.",
            type: "human_approval",
            config: {
                formId: rescueForm.id,
                policy: "any"
            } as any,
            priority: 3, // High priority
            isActive: true,
            lifecycleStatus: "active",
            createdBy: adminId,
            organizationId: null
        }).returning();
    }
    console.log(`✅ Mission Rescue Job ID: ${rescueJob.id}`);

    // 3. Create Rescue Dispatcher Pipeline
    let [rescuePipeline] = await db.select()
        .from(pipelines)
        .where(and(
            eq(pipelines.name, "Mission Rescue Dispatcher"),
            isNull(pipelines.organizationId)
        ))
        .limit(1);

    if (!rescuePipeline) {
        console.log("🚀 Creating Mission Rescue Dispatcher pipeline...");
        [rescuePipeline] = await db.insert(pipelines).values({
            name: "Mission Rescue Dispatcher",
            description: "Emergency pipeline for triggering mission recovery flows.",
            organizationId: null,
            createdBy: adminId,
            triggerType: "manual",
            isActive: true,
            lifecycleStatus: "active"
        }).returning();
    }
    console.log(`✅ Mission Rescue Dispatcher Pipeline ID: ${rescuePipeline.id}`);

    // 4. Ensure it has the rescue step
    const [existingStep] = await db.select()
        .from(pipelineSteps)
        .where(eq(pipelineSteps.pipelineId, rescuePipeline.id))
        .limit(1);

    if (!existingStep) {
        console.log(`➕ Adding rescue job step to pipeline ${rescuePipeline.id}...`);
        await db.insert(pipelineSteps).values({
            pipelineId: rescuePipeline.id,
            jobId: rescueJob.id,
            order: 0,
        });
    }

    // 5. Update Questionnaire Agent with the new Rescue capability
    const [agent] = await db.select().from(jobs).where(eq(jobs.name, "Questionnaire Agent")).limit(1);
    if (agent) {
        const config = agent.config as any;
        config.systemPrompt += `\n\n### MISSION RESCUE PROTOCOL
If a mission encounters a critical failure or terminal impediment, you can use the 'Mission Rescue Dispatcher' pipeline (ID: ${rescuePipeline.id}) with the 'Initiate Mission Rescue' job (ID: ${rescueJob.id}).
This form presents the user with specific recovery strategies: 
- retry
- backoff_retry
- relax_constraint
- new_path
- replan
- safe_state
- reset

Use this when the autonomous self-correction loop of the Mission Commander has failed or when the cost of incorrect autonomous failure is too high.`;

        await db.update(jobs).set({ config }).where(eq(jobs.id, agent.id));
        console.log("✅ Updated Questionnaire Agent with Rescue Protocol instructions.");
    }

    console.log("\n✨ Mission Rescue Infrastructure Setup Complete!");
    process.exit(0);
}

createRescueInfrastructure().catch(err => {
    console.error(err);
    process.exit(1);
});
