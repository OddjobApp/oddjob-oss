/**
 * Deploy QR Asset Triage & Service Dispatch Blueprint Agents
 * 
 * Creates public agent deployments for:
 * - ServiceBot (job 1054) — already deployed as "service-bot"
 * - Dispatch Coordinator (job 1055) — needs deployment
 * - QR Provisioner (job 1056) — needs deployment
 * 
 * Usage: npx tsx scripts/adhoc/deploy-asset-triage-agents.ts
 */
import { db } from "@server/database_service.js";
import { jobs, agentDeployments } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

const ORG_ID = 291; // TECHHEAD7

const AGENTS_TO_DEPLOY = [
    {
        jobId: 1055,
        slug: "dispatch-coordinator",
        title: "Dispatch Coordinator",
        description: "AI-powered service dispatch coordinator. Routes service requests to the nearest rated provider based on asset type, location proximity, and provider specialty scores.",
        welcomeMessage: "Hello! I'm the Dispatch Coordinator. I handle service provider routing and dispatch for asset maintenance requests. How can I help?",
        soulArchetype: "Operator",
    },
    {
        jobId: 1056,
        slug: "qr-provisioner",
        title: "QR Asset Provisioner",
        description: "Manages QR code registration and provisioning for physical assets. Links QR codes to asset records so ServiceBot can automatically identify them during triage.",
        welcomeMessage: "Hello! I'm the QR Asset Provisioner. I can help you register new assets and generate QR codes for them. What asset would you like to provision?",
        soulArchetype: "Orchestrator",
    },
];

async function deploy() {
    console.log("\n🚀 Deploying QR Asset Triage & Service Dispatch blueprint agents...\n");

    for (const agentConfig of AGENTS_TO_DEPLOY) {
        const { jobId, slug } = agentConfig;

        // Verify job exists
        const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
        if (!job) {
            console.error(`  ❌ Job ${jobId} not found — skipping`);
            continue;
        }
        if (job.organizationId !== ORG_ID) {
            console.error(`  ❌ Job ${jobId} belongs to org ${job.organizationId}, expected ${ORG_ID} — skipping`);
            continue;
        }

        console.log(`  📋 Processing: ${job.name} (job ${jobId}) → slug "${slug}"`);

        // Check if deployment already exists (by slug or jobId)
        const [existingBySlug] = await db.select().from(agentDeployments).where(eq(agentDeployments.slug, slug));
        const [existingByJob] = await db.select().from(agentDeployments).where(eq(agentDeployments.jobId, jobId));

        if (existingBySlug || existingByJob) {
            const existing = existingBySlug || existingByJob;
            console.log(`     ✅ Already deployed: "${existing!.slug}" (id: ${existing!.id}, isActive: ${existing!.isActive})`);
            if (!existing!.isActive) {
                await db.update(agentDeployments)
                    .set({ isActive: true, updatedAt: new Date() })
                    .where(eq(agentDeployments.id, existing!.id));
                console.log(`     ✅ Activated (was inactive)`);
            }
            console.log(`     🌍 URL: http://localhost:5000/a/${existing!.slug}`);
            continue;
        }

        // Create new deployment
        const [deployment] = await (db.insert(agentDeployments) as any).values({
            jobId: agentConfig.jobId,
            organizationId: ORG_ID,
            slug: agentConfig.slug,
            title: agentConfig.title,
            description: agentConfig.description,
            welcomeMessage: agentConfig.welcomeMessage,
            isActive: true,
            accessPolicy: "public",
            createdBy: "system",
            oceanTraits: { o: 0.6, c: 0.8, e: 0.5, a: 0.7, n: 0.2 },
            soulArchetype: agentConfig.soulArchetype,
            brandingConfig: {},
            embedConfig: {},
        }).returning();

        console.log(`     ✅ Created deployment: "${deployment.slug}" (id: ${deployment.id})`);
        console.log(`     🌍 Public URL:  http://localhost:5000/a/${deployment.slug}`);
        console.log(`     🔌 API Endpoint: http://localhost:5000/api/public/agents/${deployment.slug}`);
    }

    console.log("\n✅ Done!\n");
    console.log("Published agents for QR Asset Triage & Service Dispatch:");
    console.log("  • ServiceBot:          http://localhost:5000/a/service-bot");
    console.log("  • Dispatch Coordinator: http://localhost:5000/a/dispatch-coordinator");
    console.log("  • QR Asset Provisioner: http://localhost:5000/a/qr-provisioner");
    console.log("\nAll agents are public-facing (no authentication required).\n");
    process.exit(0);
}

deploy().catch(err => {
    console.error("Deployment failed:", err);
    process.exit(1);
});
