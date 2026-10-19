
import "dotenv/config";
import { db } from "./database_service.js";
import {
    users, orgs, jobs, pipelines, pipelineSteps, hilForms, credentials
} from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function seedJiraSolver() {
    console.log("🌱 Seeding 'JIRA Solver' pipeline...");

    // 1. Get Admin User & Default Org
    const adminUser = await db.query.users.findFirst({
        where: eq(users.username, "admin"),
    });
    if (!adminUser) throw new Error("Admin user not found. Run main seed first.");

    const defaultOrg = await db.query.orgs.findFirst({
        where: eq(orgs.name, "Acme Corp (Default)"),
    });
    if (!defaultOrg) throw new Error("Default Org not found. Run main seed first.");

    // 2. Encapsulate Mock Data for Tickets
    // In a real scenario, this would come from a JIRA API call
    const mockTickets = [
        {
            key: "KAN-101",
            fields: {
                summary: "Login page crashes on submit",
                description: "Null reference exception in AuthController.ts line 45",
                issuetype: { name: "Bug" }
            }
        },
        {
            key: "KAN-102",
            fields: {
                summary: "Update copyright year in footer",
                description: "Change 2024 to 2025 across all pages",
                issuetype: { name: "Task" }
            }
        },
        {
            key: "KAN-103",
            fields: {
                summary: "Optimize database query for dashboard",
                description: "Slow load times on /dashboard",
                issuetype: { name: "Bug" }
            }
        }
    ];

    // Escape single quotes for shell command
    const jsonString = JSON.stringify(mockTickets).replace(/'/g, "'\\''");

    // 3. Create Jobs

    // Job 1: Fetch Tickets (Simulated)
    const [fetchTicketsJob] = await db.insert(jobs).values({
        name: "JIRA: Fetch Active Issues",
        description: "Fetches tickets from JIRA (Mocked)",
        type: "shell",
        tool: "None",
        organizationId: defaultOrg.id,
        config: {
            executable: "/bin/echo",
            parameters: `'${jsonString}'`
        },
        priority: 2,
        isActive: true,
        createdBy: adminUser.username,
    }).returning();
    console.log(`Created Job: ${fetchTicketsJob.name}`);

    // Job 1.5: Verify OpenAI Credential exists
    let openaiCred = await db.query.credentials.findFirst({
        where: eq(credentials.envVarName, "OPENAI_API_KEY")
    });

    if (!openaiCred) {
        // Create dummy if missing (for dev envs without seeded creds)
        [openaiCred] = await db.insert(credentials).values({
            name: "OpenAI Dev",
            type: "ai_provider",
            envVarName: "OPENAI_API_KEY",
            metadata: { provider: "openai" },
            createdBy: adminUser.username
        }).returning();
    }

    // Job 2 Target: AI Ticket Resolver (The Agent)
    const [aiResolverJob] = await db.insert(jobs).values({
        name: "AI: Ticket Resolver Agent",
        description: "Analyzes JIRA tickets and proposes solutions/updates.",
        type: "ai_agent", // Using ai_agent for reasoning
        tool: "None",
        organizationId: defaultOrg.id,
        config: {
            credentialId: openaiCred!.id,
            model: "gpt-4",
            systemPrompt: `You are an expert DevOps and Software Engineer.
Your goal is to analyze JIRA tickets.
- If the ticket is a BUG: Analyze the description and propose a code fix or investigation steps.
- If the ticket is a TASK: Propose a plan of action.
- Output your response in Markdown format.`,
            userPrompt: `Analyze this JIRA ticket:
Key: {{item.key}}
Type: {{item.fields.issuetype.name}}
Summary: {{item.fields.summary}}
Description: {{item.fields.description}}`,
            maxTokens: 500,
            temperature: 0.2
        },
        priority: 2,
        isActive: true,
        createdBy: adminUser.username,
    }).returning();
    console.log(`Created Job: ${aiResolverJob.name}`);

    // Job 2: Iterator (The looper)
    const [iteratorJob] = await db.insert(jobs).values({
        name: "Control: Process Ticket Batch",
        description: "Iterates through each ticket and runs the AI Resolver.",
        type: "iterator",
        tool: "None",
        organizationId: defaultOrg.id,
        config: {
            inputArray: "{{step.0.output}}", // Output of Fetch Job (Step 0)
            itemVarName: "item",
            targetId: aiResolverJob.id,
            mode: "job",
            aggregateOutputs: true
        },
        priority: 2,
        isActive: true,
        createdBy: adminUser.username,
    }).returning();
    console.log(`Created Job: ${iteratorJob.name}`);

    // Job 3 Helper: HIL Form
    const [hilForm] = await db.insert(hilForms).values({
        name: "JIRA AI Review Form",
        description: "Review AI suggested resolutions for JIRA tickets.",
        organizationId: defaultOrg.id,
        schema: {
            fields: [
                {
                    key: "ai_analysis",
                    type: "markdown",
                    label: "AI Analysis & Proposal",
                    description: "Review the AI's proposed solution below.",
                    defaultValue: "{{context.pipeline_output_step_1}}", // We'll need to make sure we pass the right context
                    readOnly: false, // Allow human to edit the proposal
                    required: true
                },
                {
                    key: "accuracy_rating",
                    type: "rating",
                    label: "AI Accuracy",
                    max: 5,
                    required: true
                },
                {
                    key: "approval_decision",
                    type: "select",
                    label: "Action",
                    options: ["Approve & Update JIRA", "Reject", "Request Changes"],
                    required: true
                }
            ]
        },
        themeConfig: {
            primaryColor: "#0052CC", // JIRA Blue
            companyName: "Oddjob Automation",
        },
        createdBy: adminUser.id.toString(), // casting ID to string as schema defined
    }).returning();
    console.log(`Created Form: ${hilForm.name}`);

    // Job 3: Human Approval
    const [humanReviewJob] = await db.insert(jobs).values({
        name: "Human: Verify Solutions",
        description: "Human review of the AI generated solutions.",
        type: "human_approval",
        tool: "None",
        organizationId: defaultOrg.id,
        config: {
            formId: hilForm.id,
            timeoutHours: 24,
        },
        priority: 1,
        isActive: true,
        createdBy: adminUser.username,
    }).returning();
    console.log(`Created Job: ${humanReviewJob.name}`);

    // Job 4: Capture to Dataset (Simulation)
    const [captureJob] = await db.insert(jobs).values({
        name: "System: Capture Training Data",
        description: "Saves the human-verified solution to the training dataset.",
        type: "shell",
        tool: "None",
        organizationId: defaultOrg.id,
        config: {
            executable: "/bin/echo",
            parameters: "'CAPTURING DATASET EXAMPLE:\nInput: {{step.0.output}}\nVerified Output: {{step.2.output.form_data.ai_analysis}}\nRating: {{step.2.output.form_data.accuracy_rating}}'"
        },
        priority: 1,
        isActive: true,
        createdBy: adminUser.username,
    }).returning();
    console.log(`Created Job: ${captureJob.name}`);

    // 4. Create Pipeline
    const [pipeline] = await db.insert(pipelines).values({
        name: "JIRA Solver V1",
        description: "Auto-triage and solve JIRA tickets using Agentic AI.",
        triggerType: "manual",
        organizationId: defaultOrg.id,
        isActive: true,
        createdBy: adminUser.username,
    }).returning();
    console.log(`Created Pipeline: ${pipeline.name}`);

    // 5. Link Steps
    await db.insert(pipelineSteps).values([
        {
            pipelineId: pipeline.id,
            jobId: fetchTicketsJob.id,
            order: 0,
            outputName: "tickets",
            runOnCondition: "on_success",
        },
        {
            pipelineId: pipeline.id,
            jobId: iteratorJob.id,
            order: 1,
            outputName: "resolutions",
            runOnCondition: "on_success",
        },
        {
            pipelineId: pipeline.id,
            jobId: humanReviewJob.id,
            order: 2,
            outputName: "approval",
            runOnCondition: "on_success",
        },
        {
            pipelineId: pipeline.id,
            jobId: captureJob.id,
            order: 3,
            outputName: "captured",
            runOnCondition: "on_success",
        }
    ]);

    console.log("✅ Seeding 'JIRA Solver' complete!");
    process.exit(0);
}

seedJiraSolver().catch((err) => {
    console.error("❌ Seeding failed:", err);
    process.exit(1);
});

