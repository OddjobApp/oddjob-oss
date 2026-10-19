
import { db } from "../server/db/index.js";
import { datasets, pipelines, pipelineSteps, jobs, users, orgs } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

async function setupWorkflow() {
    console.log("Setting up autonomous workflow for Adobe Security Advisories...");

    // 1. Identify Org and Owner
    const [acme] = await db.select().from(orgs).where(eq(orgs.name, "Acme Corp (Default)"));
    if (!acme) throw new Error("Acme Org not found");
    const orgId = acme.id;

    const [admin] = await db.select().from(users).where(eq(users.email, "admin@acme.com"));
    if (!admin) throw new Error("Admin user not found");
    const userId = admin.id;

    // 2. Create Dataset
    console.log("Creating Dataset...");
    const [dataset] = await db.insert(datasets).values({
        name: "Adobe Security Advisories",
        description: "Latest security vulnerabilities from Adobe helpx.",
        organizationId: orgId,
        tags: ["vulnerability", "adobe", "security"],
        validationRules: {
            "cve": [{ type: "regex", params: { pattern: "CVE-\\d{4}-\\d+" }, severity: "error" }]
        }
    }).onConflictDoUpdate({
        target: [datasets.organizationId, datasets.name],
        set: { description: "Latest security vulnerabilities from Adobe helpx." }
    }).returning();

    // 3. Create Selenium Job (Auto-Pilot)
    console.log("Creating Selenium Job...");
    const seleniumConfig = {
        mode: "local",
        driver: "playwright",
        browserType: "chromium",
        headless: false, // Visible for demo purposes
        datasetId: dataset.id,
        steps: [
            {
                action: "navigate",
                value: "https://helpx.adobe.com/security.html",
                optional: false
            },
            {
                action: "extractAI",
                instruction: "Extract the most recent 5 security advisories for Adobe Acrobat. Return a list of objects with 'title', 'cve', 'severity', and 'date'.",
                schema: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            title: { type: "string" },
                            cve: { type: "string" },
                            severity: { type: "string" },
                            date: { type: "string" }
                        }
                    }
                },
                optional: false
            }
        ]
    };

    const [seleniumJob] = await db.insert(jobs).values({
        name: "Adobe Advisory Researcher",
        description: "Autonomous browser agent that extracts Adobe Acrobat security advisories.",
        type: "selenium",
        tool: "Browser",
        config: seleniumConfig,
        organizationId: orgId,
        createdBy: userId,
        isActive: true,
        outputDatasetId: dataset.id
    }).onConflictDoUpdate({
        target: [jobs.organizationId, jobs.name],
        set: { config: seleniumConfig }
    }).returning();

    // 4. Create Web Researcher Pipeline
    console.log("Creating Web Researcher Pipeline...");
    const [pipeline] = await db.insert(pipelines).values({
        name: "Web Researcher",
        description: "Autonomous researcher capable of browsing and extracting data from complex sites.",
        organizationId: orgId,
        createdBy: userId,
        triggerType: "manual",
        labels: { agent_role: "web_researcher" }
    }).onConflictDoUpdate({
        target: [pipelines.organizationId, pipelines.name],
        set: { description: "Autonomous researcher capable of browsing and extracting data from complex sites.", triggerType: "manual" }
    }).returning();

    // Add Step to Pipeline
    const existingSteps = await db.select().from(pipelineSteps).where(eq(pipelineSteps.pipelineId, pipeline.id));
    if (existingSteps.length === 0) {
        await db.insert(pipelineSteps).values({
            pipelineId: pipeline.id,
            jobId: seleniumJob.id,
            order: 0,
            outputName: "advisory_data"
        });
    }

    // 5. Create Supervisor Job
    console.log("Creating Supervisor Job...");
    const supervisorConfig = {
        intent: "Monitor Adobe Acrobat for new security advisories and update our vulnerability dataset. Use the 'Web Researcher' pipeline to extract the latest security advisories.",
        model: "gemini-2.0-flash", // Use the supported Gemini model
        credentialId: 3, // Gemini Production Credential
        maxSteps: 10,
        allowedPipelines: [pipeline.id],
        requirePlanApproval: false // Auto-execute for this automated flow
    };

    const [supervisorJob] = await db.insert(jobs).values({
        name: "Security Advisory Manager",
        description: "Supervisor agent orchestrating the vulnerability scanning workflow.",
        type: "supervisor",
        tool: "Orchestration",
        config: supervisorConfig,
        organizationId: orgId,
        createdBy: userId,
        isActive: true
    }).onConflictDoUpdate({
        target: [jobs.organizationId, jobs.name],
        set: { config: supervisorConfig }
    }).returning();

    console.log("Setup Complete!");
    console.log(`- Dataset ID: ${dataset.id}`);
    console.log(`- Pipeline ID: ${pipeline.id}`);
    console.log(`- Supervisor Job ID: ${supervisorJob.id}`);
    process.exit(0);
}

setupWorkflow().catch(err => {
    console.error(err);
    process.exit(1);
});
