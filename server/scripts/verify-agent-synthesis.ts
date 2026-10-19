import "dotenv/config";
import { jobSynthesisService } from "@domain/jobs/job-synthesis.service.js";
import { db } from "@server/database_service.js";
import { jobs, credentials, orgs } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

async function verify() {
    console.log("--- Starting Agent Synthesis Verification ---");

    // 1. Setup mock org and credential
    console.log("Setting up mock organization and credential...");
    const [org] = await db.insert(orgs).values({
        name: `Synthesis Test Org ${Date.now()}`,
    }).returning();

    const [cred] = await db.insert(credentials).values({
        name: "Mock AI Provider",
        type: "ai_provider",
        organizationId: org.id,
        createdBy: "system",
        envVarName: "MOCK_AI_KEY"
    }).returning();

    // 2. Synthesize a job
    console.log("Synthesizing 'Security Researcher' job...");
    const role = "Security Researcher";
    const context = "A mission to find vulnerabilities in a web application.";

    try {
        const job = await jobSynthesisService.synthesizeJob(role, org.id, "system", context);

        console.log("\n--- Synthesized Job Result ---");
        console.log(`ID: ${job.id}`);
        console.log(`Name: ${job.name}`);
        console.log(`Type: ${job.type}`);
        console.log("Config:", JSON.stringify(job.config, null, 2));

        // 3. Assertions
        const config = job.config as any;
        if (job.type === 'ai_agent') {
            if (!config.systemPrompt) console.error("FAILED: Missing systemPrompt");
            else console.log("SUCCESS: systemPrompt is populated");

            if (!config.goal) console.error("FAILED: Missing goal");
            else console.log("SUCCESS: goal is populated");

            if (config.credentialId !== cred.id) console.error(`FAILED: Incorrect credentialId (Expected ${cred.id}, got ${config.credentialId})`);
            else console.log("SUCCESS: credentialId is correctly linked");

            if (!config.model) console.error("FAILED: Missing model");
            else console.log(`SUCCESS: model is set to ${config.model}`);
        } else {
            console.log("Job synthesized as non-AI agent type:", job.type);
        }
    } catch (error) {
        console.error("Synthesis FAILED with error:", error);
    }

    // Cleanup (optional, but good for local dev)
    // await db.delete(jobs).where(eq(jobs.organizationId, org.id));
    // await db.delete(credentials).where(eq(credentials.id, cred.id));
    // await db.delete(orgs).where(eq(orgs.id, org.id));

    console.log("\n--- Verification Complete ---");
    process.exit(0);
}

verify();

