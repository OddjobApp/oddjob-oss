import "dotenv/config";
import { appRegistryService } from "../domain/apps/app-registry.service.js";
import { CycleManagerService } from "../domain/mission/core/cycle-manager.service.js";
import { db } from "../database_service.js";
import {
    operationalCycles, cycleBlueprints, cycleDependencyGates, missions, missionRuns,
    missionTemplates, jobs, pipelines, pipelineSteps, credentials, datasets, documentTemplates,
    hilForms, schedules
} from "@shared/schema/index.js";
import { eq, and, sql, desc, like } from "drizzle-orm";

const ORG = 2; // TechStart Inc
const APP = 73; // hybrid-sdlc

async function main() {
    console.log("─── PHASE 1: Install SDLC blueprint into TechStart Inc ───\n");
    const result = await appRegistryService.installApp(APP, ORG);
    console.log(`  Deployment ID: ${result.deployment?.id}\n`);

    console.log("─── PHASE 2: Verify install ───\n");
    const counts = await Promise.all([
        db.select().from(operationalCycles).where(and(eq(operationalCycles.organizationId, ORG), like(operationalCycles.name, '%Hybrid AI SDLC%'))).orderBy(desc(operationalCycles.id)).limit(1),
        db.select({ n: sql<number>`count(*)::int` }).from(missionTemplates).where(eq(missionTemplates.organizationId, ORG)),
        db.select({ n: sql<number>`count(*)::int` }).from(jobs).where(and(eq(jobs.organizationId, ORG), eq(jobs.type, "ai_agent"))),
        db.select({ n: sql<number>`count(*)::int` }).from(documentTemplates).where(eq(documentTemplates.organizationId, ORG)),
        db.select({ n: sql<number>`count(*)::int` }).from(datasets).where(and(eq(datasets.organizationId, ORG), sql`'cycle_app' = ANY(tags)`)),
        db.select({ n: sql<number>`count(*)::int` }).from(credentials).where(and(eq(credentials.organizationId, ORG), sql`metadata->>'_cycleAppName' = 'Oddjob Enterprise Hybrid AI SDLC'`)),
        db.select({ n: sql<number>`count(*)::int` }).from(hilForms).where(eq(hilForms.organizationId, ORG)),
        db.select({ n: sql<number>`count(*)::int` }).from(schedules).where(eq(schedules.organizationId, ORG)),
        db.select({ n: sql<number>`count(*)::int` }).from(pipelines).where(and(eq(pipelines.organizationId, ORG), sql`labels->>'cycleApp' = 'Oddjob Enterprise Hybrid AI SDLC'`)),
    ]);

    const cycle = counts[0][0];
    if (!cycle) { console.error("[FAIL] No cycle created"); process.exit(1); }
    const blueprints = await db.select().from(cycleBlueprints).where(eq(cycleBlueprints.cycleId, cycle.id));
    const gates = await db.select().from(cycleDependencyGates).where(eq(cycleDependencyGates.cycleId, cycle.id));
    const totalSteps = await db.select({ n: sql<number>`count(*)::int` }).from(pipelineSteps).innerJoin(pipelines, eq(pipelineSteps.pipelineId, pipelines.id)).where(eq(pipelines.organizationId, ORG));

    const checks = [
        ["Cycle (status=pending_approval)", cycle.status === "pending_approval", `id=${cycle.id} status=${cycle.status}`],
        ["Cycle blueprints", blueprints.length === 8, `${blueprints.length}/8`],
        ["Dependency gates from on_success()", gates.length === 2, `${gates.length}/2`],
        ["Mission templates", counts[1][0].n === 8, `${counts[1][0].n}/8`],
        ["AI agent jobs", counts[2][0].n === 9, `${counts[2][0].n}/9`],
        ["Document templates", counts[3][0].n >= 14, `${counts[3][0].n} (>= 14)`],
        ["Knowledge datasets", counts[4][0].n === 5, `${counts[4][0].n}/5`],
        ["Integration credentials", counts[5][0].n === 6, `${counts[5][0].n}/6`],
        ["HIL forms", counts[6][0].n >= 8, `${counts[6][0].n} (>= 8)`],
        ["Schedules", counts[7][0].n === 4, `${counts[7][0].n}/4`],
        ["Pipelines", counts[8][0].n === 8, `${counts[8][0].n}/8`],
        ["Pipeline steps", totalSteps[0].n === 35, `${totalSteps[0].n}/35`],
        ["Cycle metadata sections", !!(cycle.metadata as any)?.techStack && !!(cycle.metadata as any)?.vsmTelemetry, "techStack + vsmTelemetry present"],
        ["Blueprints with dependencies", blueprints.filter((b: any) => Array.isArray(b.dependencies) && b.dependencies.length > 0).length === 2, `${blueprints.filter((b: any) => Array.isArray(b.dependencies) && b.dependencies.length > 0).length}/2`],
    ];
    let installPass = 0;
    checks.forEach(([label, ok, detail]) => {
        const symbol = ok ? "✅" : "❌";
        if (ok) installPass++;
        console.log(`  ${symbol} ${(label as string).padEnd(40)} ${detail}`);
    });
    console.log(`\n  Install verification: ${installPass}/${checks.length} passed\n`);

    console.log("─── PHASE 3: Approve cycle (spawn missions) ───\n");
    const bps = (cycle.metadata as any)?.blueprints ?? [];
    let spawned = 0, spawnFails = 0;
    for (const bp of bps) {
        try {
            const r = await CycleManagerService.spawnMissionForCycle(cycle.id, bp, "system", ORG, 5);
            if (r.success) spawned++; else spawnFails++;
        } catch (e: any) {
            console.log(`  ❌ spawn failed for "${bp.name}": ${e.message}`);
            spawnFails++;
        }
    }
    await db.update(operationalCycles).set({ status: "active", updatedAt: new Date() }).where(eq(operationalCycles.id, cycle.id));
    console.log(`  Spawned: ${spawned}  Failed: ${spawnFails}`);

    console.log("\n─── PHASE 4: Verify post-approval ───\n");
    const post = await Promise.all([
        db.select().from(missions).where(eq(missions.organizationId, ORG)),
        db.select().from(missionRuns).where(eq(missionRuns.cycleId, cycle.id)),
    ]);
    const postChecks = [
        ["Missions created", post[0].length === 8, `${post[0].length}/8`],
        ["All missions active", post[0].every((m: any) => m.status === "active"), `${post[0].filter((m: any) => m.status === "active").length}/${post[0].length} active`],
        ["Mission runs linked to cycle", post[1].length === 8, `${post[1].length}/8`],
        ["Cycle is now active", (await db.select({ s: operationalCycles.status }).from(operationalCycles).where(eq(operationalCycles.id, cycle.id)))[0].s === "active", "✓"],
    ];
    let postPass = 0;
    postChecks.forEach(([label, ok, detail]) => {
        const symbol = ok ? "✅" : "❌";
        if (ok) postPass++;
        console.log(`  ${symbol} ${(label as string).padEnd(40)} ${detail}`);
    });

    console.log(`\n─── SUMMARY ───`);
    console.log(`Install:   ${installPass}/${checks.length}`);
    console.log(`Approval:  ${postPass}/${postChecks.length}`);
    const allPass = installPass === checks.length && postPass === postChecks.length;
    console.log(`Overall:   ${allPass ? "✅ ALL PASS" : "❌ SOME FAILED"}`);
    process.exit(allPass ? 0 : 1);
}
main().catch(e => { console.error("FATAL:", e.message); console.error(e.stack?.split("\n").slice(0, 5).join("\n")); process.exit(1); });
