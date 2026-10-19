/**
 * Sales Opportunity Pipeline end-to-end install + dispatch verification.
 *
 * 1. Creates a brand-new org.
 * 2. Applies sales-opportunity-pipeline.cycle.yaml via orgForgeService.
 * 3. Verifies provisioning (datasets, agents, forms, missions, schedules, apps)
 *    against the real DB, including schedule -> mission linkage.
 * 4. Exercises the runtime decay engine through the DB-backed sales store:
 *    opens three windows, runs the real evaluateWindows sweep, and asserts the
 *    step-down / re-arm / auto-LOST trichotomy plus win reconciliation.
 *
 * Usage: npx tsx server/scripts/e2e-sales-pipeline-install.ts
 * App launch (npm build) is skipped — this proves the data/logic plane.
 */
import { db } from "../database_service.js";
import { orgs, datasets, hilForms, missions, schedules, scheduledJobs, apps, jobs } from "@shared/schema/index.js";
import { and, eq } from "drizzle-orm";
import { orgForgeService } from "../domain/org/core/org-forge.service.js";
import { salesStoreForOrg } from "../domain/sales/core/sales-records-store.js";
import { SalesCollections } from "../domain/sales/core/collections.js";
import {
    openWindow,
    evaluateWindows,
    reconcileWonLoss,
    currentWeightedPipeline,
    type OpportunityWindow,
    type WindowSnapshot,
} from "../domain/sales/core/opportunity-window.service.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXPECT = { datasets: 10, agents: 3, forms: 3, missions: 6, schedules: 3, apps: 1 };

const DAY = 86_400_000;
const T0 = new Date("2026-01-01T00:00:00.000Z");
const at = (days: number) => new Date(T0.getTime() + days * DAY);

let failures = 0;
function check(name: string, actual: number | boolean, expected: number | boolean, op: ">=" | "===" = "===") {
    const pass = op === ">=" ? (actual as number) >= (expected as number) : actual === expected;
    console.log(`  ${pass ? "✅" : "❌"} ${name}: ${actual}${pass ? "" : ` (expected ${op} ${expected})`}`);
    if (!pass) failures++;
}

async function main() {
    const orgName = `Sales Pipeline E2E ${new Date().toISOString().replace(/[:.]/g, "-")}`;
    const [org] = await db.insert(orgs).values({ name: orgName } as any).returning();
    console.log(`\n🏢 Created org "${orgName}" (#${org.id})\n`);

    // ── 1. Apply blueprint ───────────────────────────────────────────────────
    const yamlPath = path.resolve(__dirname, "../cycles/sales-opportunity-pipeline.cycle.yaml");
    const yamlContent = await fs.readFile(yamlPath, "utf-8");
    console.log("📦 Installing sales-opportunity-pipeline.cycle.yaml (skipAppLaunch=true)...");
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

    // ── 3. Schedule -> mission linkage ───────────────────────────────────────
    console.log("\n── Schedule → mission linkage ──");
    const missionIdSet = new Set(missionRows.map((m) => m.id));
    const linked = sjRows.filter((sj) => sj.missionId != null && missionIdSet.has(sj.missionId));
    check("scheduledJobs created", sjRows.length, EXPECT.schedules, ">=");
    check("scheduledJobs linked to a real mission", linked.length, EXPECT.schedules, ">=");
    for (const sj of sjRows) {
        const m = missionRows.find((mm) => mm.id === sj.missionId);
        console.log(`      ${sj.missionId ? "🔗" : "⛓️‍💥"} ${sj.name} -> ${m ? `mission #${m.id} "${m.name}"` : "UNLINKED"}`);
    }

    // ── 4. Runtime decay engine through the DB-backed store ──────────────────
    console.log("\n── Runtime fleet: window decay sweep ──");
    const store = await salesStoreForOrg(org.id);

    // Three windows that, on a single sweep at T0+11d, exercise every branch:
    //  • win_step  (30-day cycle, silent)      → steps one rung 90 → 60
    //  • win_hold  (30-day cycle, REPLY @ T0+9) → re-armed, holds at 90
    //  • win_lost  (3-day cycle, silent)        → catches up through 60/30/0 → LOST
    const winStep = await openWindow(store, { opportunity_id: "opp_step", amount: 10_000, cycle_length_days: 30, now: T0 });
    const winHold = await openWindow(store, { opportunity_id: "opp_hold", amount: 20_000, cycle_length_days: 30, now: T0 });
    const winLost = await openWindow(store, { opportunity_id: "opp_lost", amount: 5_000, cycle_length_days: 3, now: T0 });

    await store.upsert(SalesCollections.activities, "act_reply", {
        activity_id: "act_reply",
        opportunity_id: "opp_hold",
        type: "REPLY",
        occurred_at: at(9).toISOString(),
    });

    check("opened at top rung (90%)", winStep.current_ceiling, 90);
    check("live pipeline before sweep = Σ amount×0.9", await currentWeightedPipeline(store), 31_500);

    const ev = await evaluateWindows(store, at(11));
    check("win_step stepped a rung", ev.stepped.includes(winStep.window_id), true);
    check("win_hold re-armed (held)", ev.rearmed.includes(winHold.window_id), true);
    check("win_lost auto-closed LOST", ev.lost.includes(winLost.window_id), true);

    const stepAfter = (await store.get<OpportunityWindow>(SalesCollections.opportunityWindows, winStep.window_id))!.data;
    const holdAfter = (await store.get<OpportunityWindow>(SalesCollections.opportunityWindows, winHold.window_id))!.data;
    const lostAfter = (await store.get<OpportunityWindow>(SalesCollections.opportunityWindows, winLost.window_id))!.data;
    check("win_step now 60% DECAYING", stepAfter.current_ceiling === 60 && stepAfter.status === "DECAYING", true);
    check("win_hold still 90% ARMED", holdAfter.current_ceiling === 90 && holdAfter.status === "ARMED", true);
    check("win_lost LOST @ 0%", lostAfter.current_ceiling === 0 && lostAfter.status === "LOST", true);
    // 6000 (step) + 18000 (hold) + 0 (lost) = 24000
    check("weighted pipeline after sweep", ev.weightedPipeline, 24_000);

    // ── 5. Win reconciliation + snapshot backfill ────────────────────────────
    console.log("\n── Runtime fleet: win/loss reconciliation ──");
    await store.upsert(SalesCollections.opportunities, "opp_step", { opportunity_id: "opp_step", stage: "CLOSED_WON" });
    const rec = await reconcileWonLoss(store, at(12));
    check("win_step reconciled WON", rec.won.includes(winStep.window_id), true);
    check("snapshots backfilled", rec.backfilled, 1, ">=");

    const stepSnaps = (await store.list<WindowSnapshot>(SalesCollections.windowSnapshots))
        .map((r) => r.data)
        .filter((s) => s.window_id === winStep.window_id);
    check("all win_step snapshots realized_outcome=100", stepSnaps.every((s) => s.realized_outcome === 100), true);
    // Only win_hold remains live (90%); win_step WON and win_lost LOST are excluded.
    check("live pipeline after reconcile = win_hold only", await currentWeightedPipeline(store), 18_000);

    // ── Result ───────────────────────────────────────────────────────────────
    console.log("\n══════════════════════════════════════════");
    console.log(failures === 0 ? `  ✅ E2E PASSED — org #${org.id} provisioned + decay engine dispatched` : `  ❌ E2E FAILED — ${failures} check(s) failed`);
    console.log(`  Org: "${orgName}" (#${org.id})`);
    console.log("══════════════════════════════════════════\n");
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("❌ E2E threw:", e); process.exit(1); });
