/**
 * BudgetMaster end-to-end install + dispatch verification.
 *
 * 1. Creates a brand-new org.
 * 2. Applies the budgetmaster.cycle.yaml blueprint via orgForgeService.
 * 3. Verifies provisioning (datasets, agents, forms, missions, schedules, apps)
 *    against the real DB — including the schedule -> mission linkage fix.
 * 4. Exercises the runtime fleet: seeds Dead Man's Switches into app_records and
 *    runs the real evaluateSwitches engine, asserting FAULT + recommendation.
 *
 * Usage: npx tsx server/scripts/e2e-budgetmaster-install.ts
 * App launch (npm build) is skipped — this proves the data/logic plane, not the
 * Next build.
 */
import { db } from "../database_service.js";
import {
    orgs, datasets, hilForms, missions, schedules, scheduledJobs, apps, jobs,
} from "@shared/schema/index.js";
import { and, eq } from "drizzle-orm";
import { orgForgeService } from "../domain/org/core/org-forge.service.js";
import { AppRecordsStore } from "../domain/finance/core/app-records-store.js";
import { evaluateSwitches, type DeadMansSwitch } from "../domain/finance/core/dead-mans-switch.service.js";
import { FinanceCollections } from "../domain/finance/core/collections.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXPECT = { datasets: 16, agents: 4, forms: 6, missions: 17, schedules: 16, apps: 2 };

let failures = 0;
function check(name: string, actual: number | boolean, expected: number | boolean, op: ">=" | "===" = "===") {
    const pass = op === ">=" ? (actual as number) >= (expected as number) : actual === expected;
    console.log(`  ${pass ? "✅" : "❌"} ${name}: ${actual}${pass ? "" : ` (expected ${op} ${expected})`}`);
    if (!pass) failures++;
}

async function main() {
    const orgName = `BudgetMaster E2E ${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const [org] = await db.insert(orgs).values({ name: orgName } as any).returning();
    console.log(`\n🏢 Created org "${orgName}" (#${org.id})\n`);

    // ── 1. Apply blueprint ───────────────────────────────────────────────────
    const yamlPath = path.resolve(__dirname, "../cycles/budgetmaster.cycle.yaml");
    const yamlContent = await fs.readFile(yamlPath, "utf-8");
    console.log("📦 Installing budgetmaster.cycle.yaml (skipAppLaunch=true)...");
    const result: any = await orgForgeService.installCycleApp(org.id, yamlContent, { skipAppLaunch: true });

    if (!result.success) {
        console.error("❌ Install returned success=false:", JSON.stringify(result));
        process.exit(1);
    }
    console.log("\n── Install summary (reported) ──");
    check("datasetsProvisioned", result.datasetsProvisioned, EXPECT.datasets, ">=");
    check("agentsProvisioned", result.agentsProvisioned, EXPECT.agents, ">=");
    check("formsProvisioned", result.formsProvisioned, EXPECT.forms, ">=");
    check("missionsProvisioned", result.missionsProvisioned, EXPECT.missions, ">=");
    check("appsProvisioned", result.appsProvisioned, EXPECT.apps, ">=");
    if (result.warnings?.length) {
        console.log(`  ⚠️  ${result.warnings.length} warning(s):`);
        result.warnings.slice(0, 10).forEach((w: string) => console.log(`      - ${w}`));
    }

    // ── 2. Verify rows actually in the DB for this org ───────────────────────
    console.log("\n── DB row verification (org-scoped) ──");
    const dsRows = await db.select().from(datasets).where(eq(datasets.organizationId, org.id));
    const formRows = await db.select().from(hilForms).where(eq(hilForms.organizationId, org.id));
    const missionRows = await db.select().from(missions).where(eq(missions.organizationId, org.id));
    const schedRows = await db.select().from(schedules).where(eq(schedules.organizationId, org.id));
    const sjRows = await db.select().from(scheduledJobs).where(eq(scheduledJobs.organizationId, org.id));
    const appRows = await db.select().from(apps).where(eq(apps.organizationId, org.id));
    const agentRows = await db.select().from(jobs).where(and(eq(jobs.organizationId, org.id), eq(jobs.type, "ai_agent")));

    check("datasets in DB", dsRows.length, EXPECT.datasets, ">=");
    check("hil_forms in DB", formRows.length, EXPECT.forms, ">=");
    check("missions in DB", missionRows.length, EXPECT.missions, ">=");
    check("schedules in DB", schedRows.length, EXPECT.schedules, ">=");
    check("ai_agent jobs in DB", agentRows.length, EXPECT.agents, ">=");
    check("apps in DB", appRows.length, EXPECT.apps, ">=");

    // ── 3. Schedule -> mission linkage (the installer fix) ───────────────────
    console.log("\n── Schedule → mission linkage (installer fix) ──");
    const missionIdSet = new Set(missionRows.map((m) => m.id));
    const linked = sjRows.filter((sj) => sj.missionId != null && missionIdSet.has(sj.missionId));
    check("scheduledJobs created", sjRows.length, EXPECT.schedules, ">=");
    check("scheduledJobs linked to a real mission", linked.length, EXPECT.schedules, ">=");
    for (const sj of sjRows) {
        const m = missionRows.find((mm) => mm.id === sj.missionId);
        console.log(`      ${sj.missionId ? "🔗" : "⛓️‍💥"} ${sj.name} -> ${m ? `mission #${m.id} "${m.name}"` : "UNLINKED"}`);
    }

    // ── 4. Runtime fleet dispatch: Dead Man's Switch engine ──────────────────
    console.log("\n── Runtime fleet: Dead Man's Switch evaluation ──");
    const store = await AppRecordsStore.forOrg(org.id);
    const now = new Date();
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();

    const tripped: DeadMansSwitch = {
        switch_id: "dms_payroll", label: "Bi-weekly Payroll", account_id: "acc_checking",
        expected_direction: "INFLOW", amount_floor: 3200, payee_token: "ACME PAYROLL",
        cron_expected_interval: "0 0 */14 * *", grace_period_hours: 24,
        status: "ARMED", expiration_deadline: hoursAgo(48), // 48h past, +24h grace => 24h overdue
    };
    const safe: DeadMansSwitch = {
        switch_id: "dms_rent", label: "Rent Outflow", account_id: "acc_checking",
        expected_direction: "OUTFLOW", amount_floor: 1800, payee_token: "LANDLORD",
        cron_expected_interval: "0 0 1 * *", grace_period_hours: 24,
        status: "ARMED", expiration_deadline: hoursAgo(1), // 1h past, within 24h grace => safe
    };
    await store.upsert(FinanceCollections.deadMansSwitches, tripped.switch_id, tripped);
    await store.upsert(FinanceCollections.deadMansSwitches, safe.switch_id, safe);

    const evaluation = await evaluateSwitches(store, now);
    check("faulted switches", evaluation.faulted.length, 1);
    check("faulted is the overdue payroll", evaluation.faulted.includes("dms_payroll"), true);
    check("safe rent stayed armed", !evaluation.faulted.includes("dms_rent"), true);
    check("shielded amount", evaluation.shieldedAmount, 3200);

    const payroll = await store.get<DeadMansSwitch>(FinanceCollections.deadMansSwitches, "dms_payroll");
    check("payroll switch now FAULT", payroll?.data.status === "FAULT", true);
    const rent = await store.get<DeadMansSwitch>(FinanceCollections.deadMansSwitches, "dms_rent");
    check("rent switch still ARMED", rent?.data.status === "ARMED", true);

    const recs = await store.list(FinanceCollections.recommendations);
    const dmsFaultRecs = recs.filter((r) => (r.data as any).kind === "dms_fault");
    check("dms_fault recommendation written", dmsFaultRecs.length, 1, ">=");
    if (dmsFaultRecs[0]) console.log(`      📋 "${(dmsFaultRecs[0].data as any).title}" [status=${(dmsFaultRecs[0].data as any).status}]`);

    // ── Result ───────────────────────────────────────────────────────────────
    console.log("\n══════════════════════════════════════════");
    console.log(failures === 0 ? `  ✅ E2E PASSED — org #${org.id} fully provisioned + fleet dispatched` : `  ❌ E2E FAILED — ${failures} check(s) failed`);
    console.log(`  Org: "${orgName}" (#${org.id})`);
    console.log("══════════════════════════════════════════\n");
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("❌ E2E threw:", e); process.exit(1); });
