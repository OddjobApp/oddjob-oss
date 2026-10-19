import { db } from "../database_service.js";
import { 
    orgs, 
    operationalCycles, 
    cycleBlueprints, 
    cycleDependencyGates, 
    missionTemplates, 
    jobs, 
    pipelines, 
    pipelineSteps, 
    credentials,
    apps,
    appDeployments,
    appUserUsage
} from "@shared/schema/index.js";
import { eq, and, inArray, sql } from "drizzle-orm";

async function uninstall() {
    try {
        const [org] = await db.select().from(orgs).where(eq(orgs.name, "TECHHEAD7")).limit(1);
        if (!org) throw new Error("TECHHEAD7 not found");

        console.log(`\n🧹 Uninstalling Technical Research app from Org ${org.id} (${org.name})...\n`);

        const cycleAppName = "Technical Research & RFC Synthesis";
        const cycleAppSlug = "technical-research";

        // 1. Delete App Deployment & Usage
        const [appRecord] = await db.select({ id: apps.id })
            .from(apps)
            .where(eq(apps.slug, cycleAppSlug))
            .limit(1);

        if (appRecord) {
            console.log(`🗑️ Deleting app deployments and user usage for App ID ${appRecord.id}...`);
            const deployments = await db.select({ id: appDeployments.id })
                .from(appDeployments)
                .where(and(eq(appDeployments.appId, appRecord.id), eq(appDeployments.organizationId, org.id)));
            const deploymentIds = deployments.map(d => d.id);
            if (deploymentIds.length > 0) {
                console.log(`  Deleting app user usage for ${deploymentIds.length} deployments...`);
                await db.delete(appUserUsage).where(inArray(appUserUsage.deploymentId, deploymentIds));
                console.log(`  Deleting app deployments...`);
                await db.delete(appDeployments).where(inArray(appDeployments.id, deploymentIds));
            }
        }

        // 2. Delete Operational Cycles, Blueprints, and Gates
        const cycles = await db.select({ id: operationalCycles.id })
            .from(operationalCycles)
            .where(and(eq(operationalCycles.organizationId, org.id), eq(operationalCycles.name, cycleAppName)));
        const cycleIds = cycles.map(c => c.id);

        if (cycleIds.length > 0) {
            console.log(`🗑️ Deleting blueprints and dependency gates for ${cycleIds.length} cycles...`);
            await db.delete(cycleDependencyGates).where(inArray(cycleDependencyGates.cycleId, cycleIds));
            await db.delete(cycleBlueprints).where(inArray(cycleBlueprints.cycleId, cycleIds));
            await db.delete(operationalCycles).where(inArray(operationalCycles.id, cycleIds));
        }

        // 3. Delete Pipelines and Steps
        const targetPipelines = await db.select({ id: pipelines.id })
            .from(pipelines)
            .where(and(eq(pipelines.organizationId, org.id), sql`labels->>'cycleApp' = ${cycleAppName}`));
        const pipelineIds = targetPipelines.map(p => p.id);

        if (pipelineIds.length > 0) {
            console.log(`🗑️ Deleting ${pipelineIds.length} pipelines and steps...`);
            await db.delete(pipelineSteps).where(inArray(pipelineSteps.pipelineId, pipelineIds));
            await db.delete(pipelines).where(inArray(pipelines.id, pipelineIds));
        }

        // 4. Delete Mission Templates
        const missionNames = [
            "Academic & Paper Discovery",
            "Technology Triage Sign-off",
            "Codebase Feasibility Audit",
            "Proof of Concept Sign-off",
            "Compile & Publish RFC",
            "Hydrate Engineering Backlog"
        ];
        console.log(`🗑️ Deleting mission templates...`);
        await db.delete(missionTemplates).where(and(
            eq(missionTemplates.organizationId, org.id),
            inArray(missionTemplates.name, missionNames)
        ));

        // 5. Delete Jobs (Agents)
        const agentNames = [
            "Technical Researcher",
            "Technical Writer"
        ];
        console.log(`🗑️ Deleting agent jobs...`);
        await db.delete(jobs).where(and(
            eq(jobs.organizationId, org.id),
            inArray(jobs.name, agentNames)
        ));

        // 6. Delete Credentials
        console.log(`🗑️ Deleting app credentials...`);
        await db.delete(credentials).where(and(
            eq(credentials.organizationId, org.id),
            sql`metadata->>'_cycleAppName' = ${cycleAppName}`
        ));

        console.log("\n==========================================");
        console.log("🧹 Teardown Completed Successfully!");
        console.log("==========================================");
        process.exit(0);
    } catch (e) {
        console.error("❌ Teardown failed:", e);
        process.exit(1);
    }
}

uninstall();
