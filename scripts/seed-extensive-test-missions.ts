import "dotenv/config";
import { db } from "../server/db/index.js";
import { 
    missions, 
    missionMembers, 
    missionRuns, 
    orgs, 
    pipelines, 
    jobs, 
    pipelineSteps,
    credentials,
    agentDeployments
} from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function seedExtensiveTestMissions() {
    console.log("🚀 Starting Extensive Mission Seeding...");

    // 1. Get Org (Acme)
    let [org] = await db.select().from(orgs).where(eq(orgs.name, "Acme")).limit(1);
    if (!org) {
        [org] = await db.select().from(orgs).limit(1);
    }
    if (!org) {
        console.error("❌ No organization found.");
        process.exit(1);
    }

    // 2. Get Credentials
    const [pgCred] = await db.select().from(credentials).where(eq(credentials.type, "postgres")).limit(1);
    const [githubCred] = await db.select().from(credentials).where(eq(credentials.type, "github")).limit(1);

    // 3. Create Tools (Jobs)
    console.log("🛠️ Creating new tools...");

    const toolDefinitions = [
        { name: "CURL Data Fetcher", type: "curl", config: { url: "https://jsonplaceholder.typicode.com/posts/1", method: "GET" } },
        { name: "Database Intelligence Vault", type: "sql_query", config: { credentialId: pgCred?.id || 1, query: "SELECT 1 as confirmed", outputMode: "single" } },
        { name: "FS System Scanner", type: "shell", config: { executable: process.platform === 'win32' ? 'dir' : 'ls', parameters: process.platform === 'win32' ? '' : '-la', workingDirectory: "." } },
        { name: "Metric JSON Writer", type: "file_writer", config: { path: "data/audit_log.json", content: "{{input}}", format: "json", destination: "local", onConflict: "overwrite" } },
        { name: "Mock News Harvester", type: "api", config: { url: "https://jsonplaceholder.typicode.com/posts/2", method: "GET" } },
        { name: "Standard Schema Transformer", type: "transformer", config: { rules: [{ id: "r1", sourcePath: "title", targetPath: "headline", type: "direct" }] } },
        { name: "Python Stats Engine", type: "python", config: { scriptContent: "import json\nprint(json.dumps({'status': 'processed', 'score': 0.95}))" } },
        { name: "Staff Engineer AI", type: "ai_agent", config: { modelId: "gpt-4", systemPrompt: "You are a Staff Engineer auditing code quality." } },
        { name: "Market Analyst AI", type: "ai_agent", config: { modelId: "gpt-4", systemPrompt: "You are a Market Analyst summarizing crypto trends." } },
        { name: "Synthesis Critic AI", type: "ai_agent", config: { modelId: "gpt-4", systemPrompt: "You are a Critic reviewing news signals." } }
    ];

    const createdJobs = [];
    for (const def of toolDefinitions) {
        const [job] = await db.insert(jobs).values({
            name: def.name,
            type: def.type as any,
            config: def.config,
            organizationId: org.id,
            createdBy: "system",
            isActive: true
        }).onConflictDoNothing().returning();
        
        const finalJob = job || (await db.select().from(jobs).where(eq(jobs.name, def.name)).limit(1))[0];
        createdJobs.push(finalJob);
    }
    console.log(`✅ Created/Ensured ${createdJobs.length} tools.`);

    const jobMap = Object.fromEntries(createdJobs.map(j => [j.name, j.id]));

    // 4. Create Pipelines
    console.log("🔗 Creating pipelines...");

    const pipelineDefs = [
        {
            name: "Market Intelligence Flow",
            description: "Crypto data extraction and analysis pipeline.",
            steps: [
                { jobName: "CURL Data Fetcher", order: 0 },
                { jobName: "Python Stats Engine", order: 1 },
                { jobName: "Database Intelligence Vault", order: 2 },
                { jobName: "Market Analyst AI", order: 3 }
            ]
        },
        {
            name: "DevOps Health Audit",
            description: "Codebase complexity and documentation audit.",
            steps: [
                { jobName: "FS System Scanner", order: 0 },
                { jobName: "Python Stats Engine", order: 1 },
                { jobName: "Metric JSON Writer", order: 2 },
                { jobName: "Staff Engineer AI", order: 3 }
            ]
        },
        {
            name: "Enterprise Synthesis Flow",
            description: "News ingestion and critical summary flow.",
            steps: [
                { jobName: "Mock News Harvester", order: 0 },
                { jobName: "Standard Schema Transformer", order: 1 },
                { jobName: "Metric JSON Writer", order: 2 },
                { jobName: "Synthesis Critic AI", order: 3 }
            ]
        }
    ];

    for (const pDef of pipelineDefs) {
        const [pipeline] = await db.insert(pipelines).values({
            name: pDef.name,
            description: pDef.description,
            triggerType: "manual",
            organizationId: org.id,
            createdBy: "system"
        }).onConflictDoNothing().returning();

        const finalPipeline = pipeline || (await db.select().from(pipelines).where(eq(pipelines.name, pDef.name)).limit(1))[0];
        
        // Clear existing steps for this pipeline to avoid duplicates
        await db.delete(pipelineSteps).where(eq(pipelineSteps.pipelineId, finalPipeline.id));
        
        // Add steps
        for (const sDef of pDef.steps) {
            await db.insert(pipelineSteps).values({
                pipelineId: finalPipeline.id,
                jobId: jobMap[sDef.jobName],
                order: sDef.order,
                runOnCondition: "on_success",
                onFailureAction: "Stop Pipeline"
            }).onConflictDoNothing();
        }
        
        // 5. Create Mission for each pipeline
        console.log(`✨ Creating mission for ${pDef.name}...`);
        const [mission] = await db.insert(missions).values({
            name: `Mission: ${pDef.name}`,
            description: `Verify the ${pDef.name} pipeline capability.`,
            type: "supervisor_led",
            organizationId: org.id,
            objective: pDef.description,
            createdBy: "system",
            executionStrategy: "pre_planned"
        }).onConflictDoNothing().returning();
        
        const finalMission = mission || (await db.select().from(missions).where(eq(missions.name, `Mission: ${pDef.name}`)).limit(1))[0];

        // Link pipeline as a member (Role: primary_strategist)
        await db.insert(missionMembers).values({
            missionId: finalMission.id,
            entityType: "pipeline",
            entityId: finalPipeline.id,
            role: "primary_strategist"
        }).onConflictDoNothing();

        // 6. Create Agent Deployments for AI Jobs to test Soul Layer
        const aiJobs = createdJobs.filter(j => j.type === "ai_agent");
        for (const aiJob of aiJobs) {
            console.log(`🧠 Creating soul deployment for agent: ${aiJob.name}...`);
            await db.insert(agentDeployments).values({
                jobId: aiJob.id,
                organizationId: org.id!,
                slug: aiJob.name.toLowerCase().replace(/\s+/g, '-'),
                title: aiJob.name,
                description: `Soul deployment for ${aiJob.name}`,
                oceanTraits: {
                    openness: 0.8 + (Math.random() * 0.2),
                    conscientiousness: 0.7 + (Math.random() * 0.3),
                    extraversion: 0.4 + (Math.random() * 0.4),
                    agreeableness: 0.6 + (Math.random() * 0.4),
                    neuroticism: 0.1 + (Math.random() * 0.2)
                },
                soulArchetype: "Scholar",
                isActive: true,
                createdBy: "system"
            }).onConflictDoNothing();
        }
    }

    console.log("🏁 Extensive test missions seeded successfully!");
    process.exit(0);
}

seedExtensiveTestMissions().catch(err => {
    console.error("❌ Seeding Failed:", err);
    process.exit(1);
});
