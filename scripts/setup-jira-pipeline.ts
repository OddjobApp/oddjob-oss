
import "dotenv/config";
import { db } from "../server/db/index.js";
import { pipelines, jobs, pipelineSteps, orgs } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function setupJiraPipeline() {
    console.log("🚀 Setting up JIRA Ingestion Pipeline...");

    // 1. Get Org
    const org = await db.query.orgs.findFirst();
    if (!org) throw new Error("No organization found");
    const orgId = org.id;

    // 2. Create Pipeline
    const [pipeline] = await db.insert(pipelines).values({
        organizationId: orgId,
        name: "JIRA Ingestion Service",
        description: "Ingests JIRA tickets into Knowledge Graph",
        triggerType: "manual", // Or schedule
        enableKnowledgeGraph: true,
        createdBy: "setup_script"
    }).returning();
    console.log(`✅ Created Pipeline: ${pipeline.id}`);

    // 3. Job 1: Calculate Offsets (Mocking for MVP: 3 pages)
    const [offsetJob] = await db.insert(jobs).values({
        organizationId: orgId,
        name: "Calculate Pagination Offsets",
        type: "node_script",
        description: "Determines pages to fetch",
        config: {
            script: `
// In a real scenario, this might fetch 'total' from JIRA first.
// For now, we return fixed offsets for 3 pages of 50.
return {
    offsets: [0, 50, 100]
};
            `
        },
        createdBy: "setup_script"
    }).returning();
    console.log(`✅ Created Offset Job: ${offsetJob.id}`);

    // 4. Job 2: Repeater (Ingest Pages)
    // Using Credential ID 50 as discovered
    const CREDENTIAL_ID = 50;

    const [repeaterJob] = await db.insert(jobs).values({
        organizationId: orgId,
        name: "Ingest JIRA Pages",
        type: "repeater",
        description: "Iterates through pages and ingests issues",
        config: {
            inputSource: "{{step.1.output.offsets}}",
            itemVariable: "offset",
            nestedJobType: "curl",
            executionMode: "sequential",
            nestedJobConfig: {
                url: "/rest/api/3/search",
                method: "GET",
                credentialId: CREDENTIAL_ID,
                queryParams: {
                    jql: "project = PROJ ORDER BY created DESC",
                    startAt: "{{offset}}",
                    maxResults: "50",
                    fields: "summary,created,assignee,status,priority"
                },
                // CURL specific options if needed, e.g. strict SSL
                // requestType: "json", 
                // responseType: "json"
                // Knowledge Graph Rules Configuration
                // NOTE: In current schema, explicit rules might be stored in 'outputStorage' 
                // or similar JSON fields depending on implementation. 
                // For this script, we'll assume the job runner handles extraction 
                // if we enable knowledge graph on the pipeline level, 
                // but detailed extraction rules usually go into 'config.knowledgeConfig' or similar if supported.
                // Checking previous implementation patterns... 
                // We'll rely on global "Knowledge Engine 2.0" auto-extraction or 
                // if we need explicit rules, we might need a separate configuration step.
                // For this MVP, we'll try to just fetch the data.
            }
        },
        createdBy: "setup_script"
    }).returning();
    console.log(`✅ Created Repeater Job: ${repeaterJob.id}`);

    // 5. Link Steps
    await db.insert(pipelineSteps).values([
        {
            pipelineId: pipeline.id,
            jobId: offsetJob.id,
            order: 1,
        },
        {
            pipelineId: pipeline.id,
            jobId: repeaterJob.id,
            order: 2,
        }
    ]);
    console.log(`✅ Linked Steps`);

    console.log("🎉 Pipeline Setup Complete!");
    process.exit(0);
}

setupJiraPipeline().catch(console.error);
