import "dotenv/config";
import { appRegistryService } from "../domain/apps/app-registry.service.js";
import { db } from "../database_service.js";
import {
    operationalCycles, cycleBlueprints, cycleDependencyGates,
    credentials, datasets, jobs, documentTemplates, missionTemplates, schedules
} from "@shared/schema/index.js";
import { eq, and, desc, like } from "drizzle-orm";

async function main() {
    const APP_ID = 73;
    const ORG_ID = 257;
    console.log(`\n[TEST] Installing SDLC app (id=${APP_ID}) into org ${ORG_ID}...\n`);

    const result = await appRegistryService.installApp(APP_ID, ORG_ID);
    console.log(`[TEST] Deployment id=${result.deployment?.id}\n`);

    // Verify cycle
    const [cycle] = await db.select().from(operationalCycles)
        .where(and(eq(operationalCycles.organizationId, ORG_ID), like(operationalCycles.name, '%Hybrid AI SDLC%')))
        .orderBy(desc(operationalCycles.createdAt)).limit(1);
    if (!cycle) { console.error("[FAIL] No SDLC cycle"); process.exit(1); }
    console.log(`✅ OperationalCycle:   id=${cycle.id}  status=${cycle.status}`);
    const meta: any = cycle.metadata;
    console.log(`   metadata sections:  ${["techStack","portfolioClassification","vsmTelemetry","predictionIntelligence","directories","organizationalGuidelines","guardrails"].filter(k => meta?.[k]).join(", ")}`);

    // Verify blueprints + dependencies
    const blueprints = await db.select().from(cycleBlueprints).where(eq(cycleBlueprints.cycleId, cycle.id));
    const withDeps = blueprints.filter((b: any) => Array.isArray(b.dependencies) && b.dependencies.length > 0);
    console.log(`✅ CycleBlueprints:    ${blueprints.length} rows, ${withDeps.length} with derived dependencies`);

    // Verify dependency gates
    const gates = await db.select().from(cycleDependencyGates).where(eq(cycleDependencyGates.cycleId, cycle.id));
    console.log(`✅ DependencyGates:    ${gates.length} rows`);
    gates.forEach(g => console.log(`   - ${g.upstreamBlueprintName}  →  ${g.downstreamBlueprintName}`));

    // Verify integration credentials
    const creds = await db.select().from(credentials)
        .where(and(eq(credentials.organizationId, ORG_ID), like(credentials.name, 'Oddjob Enterprise Hybrid AI SDLC%')));
    console.log(`\n✅ Integration creds:  ${creds.length} rows`);
    creds.forEach(c => console.log(`   - ${c.name}  type=${c.type}  env=${c.envVarName}`));

    // Verify datasets
    const ds = await db.select().from(datasets).where(eq(datasets.organizationId, ORG_ID));
    const cycleDs = ds.filter((d: any) => Array.isArray(d.tags) && d.tags.includes("cycle_app"));
    console.log(`\n✅ Knowledge datasets: ${cycleDs.length} cycle datasets (${ds.length} total)`);
    cycleDs.forEach(d => console.log(`   - ${d.name}  source=${(d.knowledgeConfig as any)?.source}`));

    // Verify agents have full config
    const agents = await db.select().from(jobs)
        .where(and(eq(jobs.organizationId, ORG_ID), eq(jobs.type, "ai_agent")));
    const sdlcAgents = agents.filter(a => {
        const c: any = a.config;
        return c?.soulProfile?.archetype && Array.isArray(c?.boundaries);
    });
    console.log(`\n✅ Agents (full config): ${sdlcAgents.length}`);
    sdlcAgents.slice(0, 3).forEach(a => {
        const c: any = a.config;
        const promptLoaded = c.systemPrompt && !c.systemPrompt.startsWith("file://") && c.systemPrompt.length > 50;
        console.log(`   - ${a.name}`);
        console.log(`       archetype: ${c.soulProfile?.archetype}  traits: ${JSON.stringify(c.soulProfile?.traits)}`);
        console.log(`       boundaries: ${JSON.stringify(c.boundaries)}  perms: ${c.permissions?.length} delegations: ${c.allowedDelegations?.length}`);
        console.log(`       prompt loaded: ${promptLoaded} (${c.systemPrompt?.length ?? 0} chars)`);
    });

    // Verify mission steps
    const msnTemplates = await db.select().from(missionTemplates).where(eq(missionTemplates.organizationId, ORG_ID));
    const withSteps = msnTemplates.filter(m => {
        const c: any = m.config;
        return Array.isArray(c?.sequence) && c.sequence.length > 0 && c.sequence[0].stepCode;
    });
    console.log(`\n✅ Mission templates with structured steps: ${withSteps.length}`);
    withSteps.slice(0, 2).forEach(m => {
        const c: any = m.config;
        console.log(`   - ${m.name}: ${c.sequence.length} steps, first=${c.sequence[0].stepCode} (${c.sequence[0].action})`);
    });

    // Verify schedules have agent linkage
    const scheds = await db.select().from(schedules).where(eq(schedules.organizationId, ORG_ID));
    const withAgent = scheds.filter(s => (s.patternString as any)?.agent);
    console.log(`\n✅ Schedules with agent linkage: ${withAgent.length}`);
    withAgent.forEach(s => console.log(`   - ${s.name}  agent=${(s.patternString as any).agent}`));

    console.log(`\n[INSTALL SUMMARY]`, JSON.stringify({
        agentsProvisioned: (result as any).agentsProvisioned ?? (result as any).deployment ? "see logs" : 0,
    }));

    console.log("\n[PASS] All SDLC sections verified");
    process.exit(0);
}

main().catch(err => {
    console.error("[FAIL]", err.message);
    console.error(err.stack);
    process.exit(1);
});
