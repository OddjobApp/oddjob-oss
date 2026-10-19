
import { db } from '../database_service.js';
import { jobs, pipelines, pipelineSteps } from '@shared/schema/index.js';
import { eq, and } from 'drizzle-orm';

async function seedTriageWorkstream() {
    console.log("🚀 Seeding Multi-Agent Triage Workstream...");

    const organizationId = 1;
    const userId = "admin";
    const credentialId = 3; // Gemini Production

    // --- Cleanup Existing ---
    console.log("Cleaning up existing triage records...");
    const triageJobNames = ["SaaS Log Expert", "Endpoint Health Probe", "System Triage Master"];
    const triagePipelineNames = ["SaaS Log Investigator", "Service Health Check", "System Triage Master"];

    for (const name of triagePipelineNames) {
        await db.delete(pipelines).where(and(eq(pipelines.organizationId, organizationId), eq(pipelines.name, name)));
    }
    for (const name of triageJobNames) {
        await db.delete(jobs).where(and(eq(jobs.organizationId, organizationId), eq(jobs.name, name)));
    }
    console.log("Creating Log Analysis Worker...");
    const [logJob] = await db.insert(jobs).values({
        name: "SaaS Log Expert",
        description: "Specialized in analyzing SaaS application logs to identify errors and stack traces.",
        type: "ai_agent",
        tool: "None",
        organizationId,
        createdBy: userId,
        config: {
            credentialId,
            model: "gemini-2.0-flash",
            persona: "technical_expert",
            goal: "Analyze the provided log snippets and extract the root cause of any errors or exceptions found.",
            specialties: ["log_analysis", "exception_debugging"],
            systemPrompt: "You are a senior DevOps engineer. Focus on pinpointing the exact line of code or service that failed based on log output."
        }
    }).returning();

    const [logPipeline] = await db.insert(pipelines).values({
        name: "SaaS Log Investigator",
        description: "Pipeline for deep log analysis.",
        triggerType: "manual",
        organizationId,
        createdBy: userId,
        labels: { agent_role: "log_analysis" }
    }).returning();

    await db.insert(pipelineSteps).values({
        pipelineId: logPipeline.id,
        jobId: logJob.id,
        order: 0,
        outputName: "analysis_report"
    });

    // --- 2. API Health Checker ---
    console.log("Creating Health Check Worker...");
    const [healthJob] = await db.insert(jobs).values({
        name: "Endpoint Health Probe",
        description: "Checks if critical service endpoints are responding correctly.",
        type: "curl",
        tool: "None",
        organizationId,
        createdBy: userId,
        config: {
            url: "https://httpbin.org/status/200", // Placeholder
            method: "GET",
            headers: { "Accept": "application/json" }
        }
    }).returning();

    const [healthPipeline] = await db.insert(pipelines).values({
        name: "Service Health Check",
        description: "Verifies service availability.",
        triggerType: "manual",
        organizationId,
        createdBy: userId,
        labels: { agent_role: "health_check" }
    }).returning();

    await db.insert(pipelineSteps).values({
        pipelineId: healthPipeline.id,
        jobId: healthJob.id,
        order: 0,
        outputName: "health_status"
    });

    // --- 3. Master Supervisor ---
    console.log("Creating Triage Supervisor...");
    const [supervisorJob] = await db.insert(jobs).values({
        name: "System Triage Master",
        description: "Orchestrates multi-agent triage workstreams.",
        type: "supervisor",
        tool: "None",
        organizationId,
        createdBy: userId,
        config: {
            intent: "{{data.intent}}",
            credentialId,
            model: "gemini-2.0-flash",
            allowedPipelines: [logPipeline.id, healthPipeline.id],
            requirePlanApproval: false,
            maxSteps: 5
        }
    }).returning();

    const [masterPipeline] = await db.insert(pipelines).values({
        name: "System Triage Master",
        description: "Branched triage workstream.",
        triggerType: "manual",
        organizationId,
        createdBy: userId
    }).returning();

    await db.insert(pipelineSteps).values({
        pipelineId: masterPipeline.id,
        jobId: supervisorJob.id,
        order: 0,
        outputName: "triage_summary"
    });

    console.log("\n✅ Triage Workstream Seeded Successfully!");
    console.log(`- Master Pipeline ID: ${masterPipeline.id}`);
    console.log(`- Log Pipeline ID: ${logPipeline.id}`);
    console.log(`- Health Pipeline ID: ${healthPipeline.id}`);
}

seedTriageWorkstream().catch(err => {
    console.error("❌ Seeding Failed:", err);
    process.exit(1);
});

