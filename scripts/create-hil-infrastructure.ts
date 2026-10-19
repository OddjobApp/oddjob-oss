
import { db } from "../server/db/index.js";
import { hilForms, jobs, pipelines, pipelineSteps } from "../shared/schema/index.js";
import { eq, and, isNull } from "drizzle-orm";

async function createHILInfrastructure() {
    console.log("=== Creating HIL Infrastructure ===");

    // 1. Create General Feedback Form
    let [feedbackForm] = await db.select().from(hilForms).where(eq(hilForms.name, "General Feedback Form")).limit(1);
    if (!feedbackForm) {
        console.log("🚀 Creating General Feedback Form...");
        [feedbackForm] = await db.insert(hilForms).values({
            name: "General Feedback Form",
            description: "A universal form for gathering open-ended feedback or answering specific questions from agents.",
            schema: {
                fields: [
                    {
                        key: "feedback",
                        type: "textarea",
                        label: "Response",
                        description: "Please provide your answer or feedback below.",
                        required: true
                    }
                ]
            } as any,
            themeConfig: {
                logoUrl: "",
                companyName: "Oddjob Agentic Agency",
                primaryColor: "#4F46E5"
            },
            securityConfig: {
                requireOtp: false,
                tokenExpirationHours: 48
            },
            organizationId: null,
            isArchived: false,
            createdBy: "4f7e1c1e-418e-447f-acca-dd2ca0cad03b"
        }).returning();
    }
    console.log(`✅ General Feedback Form ID: ${feedbackForm.id}`);

    // 2. Create Human Feedback Job
    let [feedbackJob] = await db.select().from(jobs).where(eq(jobs.name, "Standard Human Feedback")).limit(1);
    if (!feedbackJob) {
        console.log("🚀 Creating Standard Human Feedback Job...");
        [feedbackJob] = await db.insert(jobs).values({
            name: "Standard Human Feedback",
            description: "Triggers a HIL form to gather feedback from a human.",
            type: "human_approval",
            config: {
                formId: feedbackForm.id,
                policy: "any"
            } as any,
            priority: 1,
            isActive: true,
            lifecycleStatus: "active",
            createdBy: "4f7e1c1e-418e-447f-acca-dd2ca0cad03b",
            organizationId: null
        }).returning();
    }
    console.log(`✅ Standard Human Feedback Job ID: ${feedbackJob.id}`);

    // 3. Create Human Input Pipeline
    let [inputPipeline] = await db.select()
        .from(pipelines)
        .where(and(
            eq(pipelines.name, "Human Input Dispatcher"),
            isNull(pipelines.organizationId)
        ))
        .limit(1);

    if (!inputPipeline) {
        console.log("🚀 Creating Human Input Dispatcher pipeline...");
        [inputPipeline] = await db.insert(pipelines).values({
            name: "Human Input Dispatcher",
            description: "Generic pipeline for agents to delegate questions to humans.",
            organizationId: null,
            createdBy: "4f7e1c1e-418e-447f-acca-dd2ca0cad03b",
            triggerType: "manual",
            isActive: true,
            lifecycleStatus: "active"
        }).returning();
    }
    console.log(`✅ Human Input Dispatcher Pipeline ID: ${inputPipeline.id}`);

    // 4. Ensure it has the feedback step
    const [existingStep] = await db.select()
        .from(pipelineSteps)
        .where(eq(pipelineSteps.pipelineId, inputPipeline.id))
        .limit(1);

    if (!existingStep) {
        console.log(`➕ Adding feedback job step to pipeline ${inputPipeline.id}...`);
        await db.insert(pipelineSteps).values({
            pipelineId: inputPipeline.id,
            jobId: feedbackJob.id,
            order: 0,
        });
    }

    // 5. Update Questionnaire Agent to know about this pipeline
    const [agent] = await db.select().from(jobs).where(eq(jobs.name, "Questionnaire Agent")).limit(1);
    if (agent) {
        const config = agent.config as any;
        config.systemPrompt += `\n\nWhen ನೀವು use 'delegate_task', the 'Human Input Dispatcher' pipeline (ID: ${inputPipeline.id}) is available for general feedback collection using the 'Standard Human Feedback' job (ID: ${feedbackJob.id}).`;
        await db.update(jobs).set({ config }).where(eq(jobs.id, agent.id));
        console.log("✅ Updated Questionnaire Agent with HIL pipeline info.");
    }

    console.log("\n✨ HIL Infrastructure Setup Complete!");
    process.exit(0);
}

createHILInfrastructure().catch(err => {
    console.error(err);
    process.exit(1);
});
