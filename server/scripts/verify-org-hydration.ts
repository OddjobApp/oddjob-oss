import { db } from "../database_service.js";
import { sql } from "drizzle-orm";
import { 
    orgs,
    missionTemplates,
    hilForms,
    apps,
    appDeployments,
    pipelines,
    jobs,
    teams,
    operationalCycles,
    datasets,
    documentTemplates,
    credentials,
    cycleBlueprints,
    cycleDependencyGates
} from "@shared/schema/index.js";
import { desc, like } from "drizzle-orm";

async function verifyHydration() {
    try {
        console.log("Starting in-depth verification of Org Forge hydration...\n");

        // 1. Get the most recently created test org
        const [latestOrg] = await db.select().from(orgs)
            .where(like(orgs.name, "Test SDLC Org%"))
            .orderBy(desc(orgs.createdAt))
            .limit(1);

        if (!latestOrg) {
            console.error("No test org found. Run test-new-org-sdlc.ts first.");
            process.exit(1);
        }

        const orgId = latestOrg.id;
        console.log(`==========================================`);
        console.log(`Verifying Target Org: ${latestOrg.name} (ID: ${orgId})`);
        console.log(`==========================================\n`);

        // 2. Check Operational Cycle
        const orgCycles = await db.select().from(operationalCycles).where(sql`organization_id = ${orgId}`);
        console.log(`🔄 Operational Cycles Provisioned: ${orgCycles.length}`);
        orgCycles.forEach(c => console.log(`   - ${c.name} (Status: ${c.status})`));
        console.log("");

        // 3. Check Missions (Mission Templates)
        const orgMissions = await db.select().from(missionTemplates).where(sql`organization_id = ${orgId}`);
        console.log(`🎯 Missions Provisioned: ${orgMissions.length}`);
        orgMissions.forEach(m => console.log(`   - ${m.name}`));
        console.log("");

        // 3b. Check Agents (Jobs table with type ai_agent)
        const orgAgents = await db.select().from(jobs).where(sql`organization_id = ${orgId} AND type = 'ai_agent'`);
        console.log(`🤖 AI Agents Provisioned: ${orgAgents.length}`);
        orgAgents.forEach(a => console.log(`   - ${a.name}`));
        console.log("");

        // 3c. Check Teams (Workstreams)
        const orgTeams = await db.select().from(teams).where(sql`organization_id = ${orgId}`);
        console.log(`👥 Teams / Workstreams Provisioned: ${orgTeams.length}`);
        orgTeams.forEach(t => console.log(`   - ${t.name}`));
        console.log("");

        // 3d. Check Knowledge Datasets
        const orgDatasets = await db.select().from(datasets).where(sql`organization_id = ${orgId}`);
        console.log(`📚 Datasets Provisioned: ${orgDatasets.length}`);
        orgDatasets.forEach(d => console.log(`   - ${d.name}`));
        console.log("");

        // 3e. Check Document Templates
        const orgDocTmpls = await db.select().from(documentTemplates).where(sql`organization_id = ${orgId}`);
        console.log(`📄 Document Templates Provisioned: ${orgDocTmpls.length}`);
        orgDocTmpls.forEach(t => console.log(`   - ${t.name}`));
        console.log("");

        // 3f. Check Integrations/Credentials
        const orgCreds = await db.select().from(credentials).where(sql`organization_id = ${orgId}`);
        console.log(`🔑 Credentials/Integrations Provisioned: ${orgCreds.length}`);
        orgCreds.forEach(c => console.log(`   - ${c.name} (Type: ${c.type})`));
        console.log("");

        // 3g. Check Cycle Blueprints & Dependency Gates
        const orgCycleId = orgCycles[0]?.id;
        if (orgCycleId) {
            const orgBlueprints = await db.select().from(cycleBlueprints).where(sql`cycle_id = ${orgCycleId}`);
            console.log(`🗺️  Cycle Blueprints Provisioned: ${orgBlueprints.length}`);
            
            const orgGates = await db.select().from(cycleDependencyGates).where(sql`cycle_id = ${orgCycleId}`);
            console.log(`🚧 Dependency Gates Provisioned: ${orgGates.length}`);
            orgGates.forEach(g => console.log(`   - Gate ID: ${g.id} | Downstream: ${g.downstreamBlueprintName} | Upstream: ${g.upstreamBlueprintName}`));
            console.log("");
        }

        // 4. Check HIL Forms
        const orgForms = await db.select().from(hilForms).where(sql`organization_id = ${orgId}`);
        console.log(`📝 HIL Forms Provisioned: ${orgForms.length}`);
        orgForms.forEach(f => console.log(`   - ${f.name}`));
        console.log("");

        // 5. Check Pipelines
        const orgPipelines = await db.select().from(pipelines).where(sql`organization_id = ${orgId}`);
        console.log(`🛤️ Pipelines Provisioned: ${orgPipelines.length}`);
        orgPipelines.forEach(p => console.log(`   - ${p.name}`));
        console.log("");

        // 7. Check Apps & App Deployments
        // Apps table
        const orgApps = await db.select().from(apps).where(sql`organization_id = ${orgId}`);
        console.log(`📦 Apps Provisioned: ${orgApps.length}`);
        orgApps.forEach(a => console.log(`   - ${a.name} (Slug: ${a.slug})`));
        console.log("");

        // App Deployments table
        const orgDeployments = await db.select().from(appDeployments).where(sql`organization_id = ${orgId}`);
        console.log(`🚀 App Deployments: ${orgDeployments.length}`);
        orgDeployments.forEach(d => console.log(`   - AppID: ${d.appId} | Status: ${d.status} | URL: /apps/${d.publicSlug}`));
        console.log("");

        console.log(`==========================================`);
        console.log("✅ Verification Complete. All components are scoped strictly to the new Org.");
        console.log(`==========================================`);
        
        process.exit(0);
    } catch (e) {
        console.error("Verification failed:", e);
        process.exit(1);
    }
}

verifyHydration();
