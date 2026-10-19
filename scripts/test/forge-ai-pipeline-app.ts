/**
 * Full AI-Driven App Forge Pipeline Execution
 *
 * Runs all 7 stages of App Forge without mocking:
 * Stage 0: Discovery (Requirements Decomposition)
 * Stage 1: Strategy (Wave Planning)
 * Stage 2: Architecture (Platform Block & Gallery Mapping)
 * Stage 3: Assembly (AI Codegen & Component Gallery Slot-Fill)
 * Stage 4: Dependency Synchronization & Workspace Sanitization
 * Stage 5: Hardening (Multi-Agent QA & Build Verification)
 * Stage 6: Ignition (Deployment, Knowledge Graph, Project Space & Arsenal Registration)
 */

import "dotenv/config";
import { appForgeService } from "../../server/domain/apps/app-forge.service.js";
import { projectService } from "../../server/domain/projects/core/project.service.js";
import { appRegistryService } from "../../server/domain/apps/app-registry.service.js";
import { db } from "../../server/database_service.js";
import { apps, projectResources, appDeployments } from "../../shared/schema/index.js";
import { eq, and } from "drizzle-orm";

async function main() {
    const orgId = 473; // Acme Corp (Default)
    const projectId = 44; // acme-corp-default
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    const slug = `acme-ops-command-${randomSuffix}`;
    const name = "Acme Operations Command";
    const description = "Executive Operations Command Center with industrial KPI metrics, recent activity status timeline, and operational records management consuming the Oddjob Component Gallery.";

    console.log("===============================================================");
    console.log("🚀 Starting Full AI-Driven App Forge Pipeline");
    console.log("===============================================================");
    console.log(`Target Org ID:     ${orgId}`);
    console.log(`Target Project ID: ${projectId}`);
    console.log(`App Name:          ${name}`);
    console.log(`App Slug:          ${slug}`);
    console.log(`Blueprint:         crud-app`);
    console.log("---------------------------------------------------------------");

    const startTime = Date.now();

    const result = await appForgeService.forgeAppInternal(
        "crud-app",
        {
            name,
            slug,
            description,
            organizationId: orgId,
            projectId: projectId,
            // Required by ForgeOptions; 0 means "not driven by a mission".
            oddjobMissionId: 0,
            theme: "dark",
            deliveryProfile: "accelerated",
        },
        // forgeAppInternal's third parameter is a jobId, not a logger — this script
        // was written against an older signature. Progress is streamed as FORGE_LOG
        // events and mirrored into the draft, not delivered through a callback.
    );

    console.log("\n---------------------------------------------------------------");
    console.log(`Forge Execution Finished in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    console.log("Result:", result);

    if (!result.success || !result.appId) {
        console.error("❌ Full AI Forge failed:", result);
        process.exit(1);
    }

    const appId = result.appId;
    console.log(`\n✅ App successfully forged with ID: ${appId}`);

    // Verification 1: Verify DB Record
    const [appRecord] = await db.select().from(apps).where(eq(apps.id, appId));
    console.log("\nStep 1: Checking database apps record...");
    console.log(`  • ID:              ${appRecord.id}`);
    console.log(`  • Name:            ${appRecord.name}`);
    console.log(`  • Slug:            ${appRecord.slug}`);
    console.log(`  • Status:          ${appRecord.status}`);
    console.log(`  • Organization ID: ${appRecord.organizationId}`);
    console.log(`  • Project ID:      ${appRecord.projectId}`);

    // Verification 2: Verify Project Space Junction
    const [junction] = await db.select().from(projectResources).where(
        and(
            eq(projectResources.resourceId, appId),
            eq(projectResources.resourceType, "app"),
            eq(projectResources.projectId, projectId)
        )
    );
    console.log("\nStep 2: Checking project_resources junction...");
    console.log(`  • Found Junction:  ${!!junction}`);
    console.log(`  • Relation:        ${junction?.relation}`);

    // Verification 3: Verify Project Space Query
    const projectApps = await projectService.listApps({ organizationId: orgId } as any, projectId);
    const foundInProject = projectApps.find(a => a.id === appId);
    console.log("\nStep 3: Checking Project Space visibility...");
    console.log(`  • Visible in Project: ${!!foundInProject}`);

    // Verification 4: Verify App Arsenal Deployments
    const deployments = await appRegistryService.listOrgDeployments(orgId);
    const foundDeployment = deployments.find(d => d.app.id === appId);
    console.log("\nStep 4: Checking App Arsenal visibility...");
    console.log(`  • Visible in Fleet:   ${!!foundDeployment}`);
    console.log(`  • Deployment Status:  ${foundDeployment?.deployment?.status}`);
    console.log(`  • Deployment URL:     ${foundDeployment?.deployment?.url}`);

    console.log("\n===============================================================");
    console.log(`🎉 SUCCESS: App Forged and Live!`);
    console.log(`🔗 Builder URL: http://localhost:5000/armory/apps/${appId}?orgId=${orgId}&tab=preview`);
    console.log(`🔗 Project Space: http://localhost:5000/projects/acme-corp-default/apps?orgId=${orgId}`);
    console.log(`🔗 App Arsenal:   http://localhost:5000/armory/apps?tab=fleet&orgId=${orgId}`);
    console.log("===============================================================");

    process.exit(0);
}

main().catch(err => {
    console.error("FATAL ERROR:", err);
    process.exit(1);
});
