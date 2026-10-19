/**
 * Read-only: show how agents/apps/cycles are (not) tied to a parent blueprint
 * in TECHHEAD7, to ground the per-blueprint scoping fix. No writes.
 *
 * Usage: npx tsx server/scripts/inspect-org-fleet.ts
 */
import { db } from "../database_service.js";
import { orgs, apps, jobs, operationalCycles } from "@shared/schema/index.js";
import { and, eq } from "drizzle-orm";

async function main() {
    const [org] = await db.select().from(orgs).where(eq(orgs.name, "TECHHEAD7")).limit(1);
    if (!org) throw new Error("TECHHEAD7 not found");
    console.log(`🏢 TECHHEAD7 = org #${org.id}\n`);

    const cycles = await db.select().from(operationalCycles).where(eq(operationalCycles.organizationId, org.id));
    console.log(`── operational_cycles (${cycles.length}) ──`);
    for (const c of cycles) console.log(`  #${c.id}  ${c.name}  [${c.status}]`);

    const appRows = await db.select().from(apps).where(eq(apps.organizationId, org.id));
    console.log(`\n── apps (${appRows.length}) — parent link is JSON only (runtimeMetadata.cycleApp.sourceCycleSlug) ──`);
    for (const a of appRows) {
        const rt: any = a.runtimeMetadata ?? {};
        const parent = rt.cycleApp?.sourceCycleSlug ?? "(none)";
        console.log(`  #${a.id}  ${a.slug}  parentCycleSlug=${parent}`);
    }

    const agentRows = await db.select().from(jobs).where(and(eq(jobs.organizationId, org.id), eq(jobs.type, "ai_agent")));
    console.log(`\n── ai_agent jobs (${agentRows.length}) — NO parent column; config.sourceCycleSlug? ──`);
    for (const j of agentRows) {
        const cfg: any = j.config ?? {};
        const parent = cfg.sourceCycleSlug ?? cfg.cycleId ?? "(NONE — org-scoped only)";
        console.log(`  #${j.id}  "${j.name}"  parent=${parent}`);
    }
    process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
