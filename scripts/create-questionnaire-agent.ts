
import { db } from "../server/db/index.js";
import { jobs } from "../shared/schema/index.js";

async function createQuestionnaireAgent() {
    console.log("=== Creating Questionnaire Agent ===");

    const questionnaireAgentConfig = {
        credentialId: 3, // Using the same credential as the supervisor
        provider: "google",
        model: "gemini-1.5-flash",
        goal: "Clarify mission objectives and gather human feedback via interactive forms.",
        persona: "researcher",
        specialties: ["human-in-the-loop", "form-design", "requirement-gathering"],
        maxIterations: 10,
        allowedTools: [
            "create_job",
            "list_jobs",
            "get_job_details",
            "add_pipeline_step",
            "delegate_task",
            "search_knowledge_base"
        ],
        systemPrompt: `You are the Questionnaire Agent. Your primary role is to bridge the gap between autonomous agents and human users.

When you encounter ambiguity or need feedback:
1. DESIGN a clear set of questions or a form schema.
2. LOOK for an existing 'human_approval' or 'form_agent' job that fits, OR CREATE ONE using 'create_job'.
3. TRIGGER the interaction by using 'delegate_task' to a pipeline that contains that job, or by adding it to the current mission flow.

Your goal is to ensure the human is consulted whenever a high-stakes decision or a vaguely defined requirement is encountered.`,
        supervision: "none", // This agent IS the supervisor's tool for human contact
        notificationChannels: ["copilot", "slack"]
    };

    const [newJob] = await db.insert(jobs).values({
        name: "Questionnaire Agent",
        description: "Specialized agent for human-in-the-loop interactions and feedback collection.",
        type: "ai_agent",
        tool: "None",
        config: questionnaireAgentConfig as any,
        priority: 2,
        isActive: true,
        lifecycleStatus: "active",
        createdBy: "system",
        organizationId: null, // Global
    }).returning();

    console.log(`✅ Questionnaire Agent created with ID: ${newJob.id}`);
    process.exit(0);
}

createQuestionnaireAgent().catch(err => {
    console.error(err);
    process.exit(1);
});
