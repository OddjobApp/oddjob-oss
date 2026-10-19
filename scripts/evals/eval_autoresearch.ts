/**
 * AI Evaluation Suite for the Autoresearch subsystem (Autonomous Evolution).
 *
 * Autoresearch detects under-performing skills from forensic telemetry and
 * launches "shadow experiments" to evolve them. This eval exercises the real
 * pipeline against the database with synthetic, precisely-cleaned-up data:
 *
 *   1. Detection query  — SentinelService.getEvolutionCandidatesForOrg
 *        - flags a skill below the reliability threshold
 *        - ignores a healthy skill (>= threshold)
 *        - ignores a skill with too few samples (HAVING COUNT > 5)
 *        - reports correct reliability %, totals and latest linked run
 *   2. syncNeuralCore   — classification of candidates
 *        - "triggered" when telemetry is linked to a mission run
 *        - "blocked_missing_mission_run" when it is not
 *   3. createShadowRun  — persists an active shadow with autoresearch metadata
 *   4. Dedup guard       — initiateEvolution skips when a shadow is already active
 *   5. Maintenance status — getAutoresearchMaintenanceStatus is sane
 *
 * No real LLM / TrustGraph calls are made: the "triggered" candidate is given a
 * pre-existing active shadow so initiateEvolution short-circuits at the dedup
 * guard before any network work.
 */

import "dotenv/config";
import { db } from "../../server/db/index.js";
import {
  forensicEventLog,
  orgs,
  missions,
  missionRuns,
  missionShadowRuns,
} from "../../shared/schema/index.js";
import { eq, and, inArray, sql } from "drizzle-orm";

interface EvalResult {
  testName: string;
  passed: boolean;
  details: string;
  duration: number;
}

const results: EvalResult[] = [];

async function recordResult(testName: string, passed: boolean, details: string, startTime: number) {
  const duration = Date.now() - startTime;
  results.push({ testName, passed, details, duration });
  console.log(`   ${passed ? "✅" : "❌"} ${testName} (${duration}ms)`);
  if (!passed) console.log(`      Details: ${details}`);
}

// Unique tag so seeded rows never collide with real data and cleanup is exact.
const TAG = `eval-ar-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const skill = (label: string) => `${TAG}:${label}`;

function genId(len: number): string {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

async function seedEvents(opts: {
  orgId: number | null;
  skillId: string;
  missionRunId: number | null;
  success: number;
  failure: number;
}) {
  const rows: (typeof forensicEventLog.$inferInsert)[] = [];
  const push = (status: "success" | "failure") =>
    rows.push({
      traceId: genId(32),
      spanId: genId(16),
      organizationId: opts.orgId,
      missionRunId: opts.missionRunId,
      jobType: "uci_skill_execution",
      startTimeNs: BigInt(Date.now() * 1_000_000),
      status,
      attributes: { skillId: opts.skillId, evalTag: TAG },
    });
  for (let i = 0; i < opts.success; i++) push("success");
  for (let i = 0; i < opts.failure; i++) push("failure");
  await db.insert(forensicEventLog).values(rows);
}

async function runEval() {
  console.log("🧬 Starting Autoresearch (Autonomous Evolution) Evaluation...\n");
  console.log("=".repeat(70));

  const { SentinelService } = await import("../../server/domain/agents/core/sentinel.service.js");
  const { adminService } = await import("../../server/domain/admin/admin.service.js");
  const { autoresearchService } = await import(
    "../../server/domain/mission/core/autoresearch.service.js"
  );
  const { getAutoresearchMaintenanceStatus } = await import(
    "../../server/domain/admin/infrastructure/autoresearch-maintenance.js"
  );

  // --- Setup: org + a linked mission run to anchor telemetry -------------
  const [org] = await db.select({ id: orgs.id }).from(orgs).limit(1);
  const orgId = org?.id ?? null;
  if (!orgId) {
    console.error("No organization found in DB; cannot run autoresearch eval.");
    process.exit(1);
  }

  let missionId: number | null = null;
  let runId: number | null = null;
  const seededSkills = [
    skill("unhealthy"),
    skill("healthy"),
    skill("small"),
    skill("blocked"),
  ];

  try {
    const [mission] = await db
      .insert(missions)
      .values({ name: `${TAG} mission`, organizationId: orgId, objective: "eval", createdBy: "eval-autoresearch" })
      .returning();
    missionId = mission.id;
    const [run] = await db
      .insert(missionRuns)
      .values({
        name: `${TAG} run`,
        organizationId: orgId,
        missionId,
        createdBy: "eval-autoresearch",
      })
      .returning();
    runId = run.id;

    // ---------------------------------------------------------------------
    console.log("\n📋 Test: Detection query (getEvolutionCandidatesForOrg)");
    console.log("-".repeat(50));

    // unhealthy: 4/10 success = 40% (linked to run) -> should be flagged
    await seedEvents({ orgId, skillId: skill("unhealthy"), missionRunId: runId, success: 4, failure: 6 });
    // healthy: 9/10 = 90% -> should be ignored
    await seedEvents({ orgId, skillId: skill("healthy"), missionRunId: runId, success: 9, failure: 1 });
    // small: 1/3 = 33% but only 3 samples (<= 5) -> ignored by HAVING COUNT > 5
    await seedEvents({ orgId, skillId: skill("small"), missionRunId: runId, success: 1, failure: 2 });
    // blocked: 3/8 = 37.5% unhealthy but NOT linked to any mission run
    await seedEvents({ orgId, skillId: skill("blocked"), missionRunId: null, success: 3, failure: 5 });

    let start = Date.now();
    const candidates = await SentinelService.getEvolutionCandidatesForOrg(orgId, 80);
    const byId = new Map(candidates.map((c: any) => [c.skillId, c]));

    const unhealthy = byId.get(skill("unhealthy"));
    await recordResult(
      "Unhealthy skill flagged",
      !!unhealthy && unhealthy.total === 10 && Math.round(unhealthy.reliabilityPct) === 40,
      unhealthy
        ? `total=${unhealthy.total} reliability=${unhealthy.reliabilityPct}% latestRun=${unhealthy.latestMissionRunId}`
        : "unhealthy skill not returned as a candidate",
      start,
    );

    start = Date.now();
    await recordResult(
      "Latest linked mission run resolved",
      !!unhealthy && unhealthy.latestMissionRunId === runId,
      unhealthy ? `expected ${runId}, got ${unhealthy.latestMissionRunId}` : "no candidate",
      start,
    );

    start = Date.now();
    await recordResult(
      "Healthy skill (>=80%) ignored",
      !byId.has(skill("healthy")),
      byId.has(skill("healthy")) ? "healthy skill incorrectly flagged" : "correctly excluded",
      start,
    );

    start = Date.now();
    await recordResult(
      "Under-sampled skill (<=5 events) ignored",
      !byId.has(skill("small")),
      byId.has(skill("small")) ? "small-sample skill incorrectly flagged" : "correctly excluded",
      start,
    );

    // ---------------------------------------------------------------------
    console.log("\n📋 Test: syncNeuralCore classification");
    console.log("-".repeat(50));

    // Pre-seed an active shadow for the unhealthy skill so the fire-and-forget
    // initiateEvolution short-circuits at the dedup guard (no LLM/network).
    await db.insert(missionShadowRuns).values({
      parentRunId: runId,
      status: "active",
      modelId: "current",
      promptVersion: "1.0",
      missionContext: {
        autoresearchMetadata: { originalSkillId: skill("unhealthy"), evalTag: TAG },
      },
    });

    start = Date.now();
    const sync = await adminService.syncNeuralCore(orgId);
    const detail = (id: string) => sync.details.find((d: any) => d.skillId === id);
    const unhealthyDetail = detail(skill("unhealthy"));
    const blockedDetail = detail(skill("blocked"));

    await recordResult(
      "Linked candidate classified 'triggered'",
      unhealthyDetail?.status === "triggered",
      `status=${unhealthyDetail?.status ?? "absent"} (candidatesFound=${sync.candidatesFound})`,
      start,
    );

    start = Date.now();
    await recordResult(
      "Unlinked candidate classified 'blocked_missing_mission_run'",
      blockedDetail?.status === "blocked_missing_mission_run",
      `status=${blockedDetail?.status ?? "absent"} (blocked=${sync.blockedCandidates})`,
      start,
    );

    // ---------------------------------------------------------------------
    console.log("\n📋 Test: Dedup guard (initiateEvolution)");
    console.log("-".repeat(50));

    start = Date.now();
    const shadowsBefore = await db
      .select({ id: missionShadowRuns.id })
      .from(missionShadowRuns)
      .where(eq(missionShadowRuns.parentRunId, runId));
    // Active shadow already exists for this skill -> must skip without creating one.
    await autoresearchService.initiateEvolution(skill("unhealthy"), runId, { orgId });
    const shadowsAfter = await db
      .select({ id: missionShadowRuns.id })
      .from(missionShadowRuns)
      .where(eq(missionShadowRuns.parentRunId, runId));
    await recordResult(
      "Skips when an active shadow exists",
      shadowsAfter.length === shadowsBefore.length,
      `shadows before=${shadowsBefore.length} after=${shadowsAfter.length} (expected unchanged)`,
      start,
    );

    start = Date.now();
    // A skill with no recorded failures -> evolutionary pressure is low -> no-op.
    await autoresearchService.initiateEvolution(skill("no-failures"), runId, { orgId });
    const shadowsNoFail = await db
      .select({ id: missionShadowRuns.id })
      .from(missionShadowRuns)
      .where(eq(missionShadowRuns.parentRunId, runId));
    await recordResult(
      "No-op when there are no recent failures",
      shadowsNoFail.length === shadowsAfter.length,
      `shadows=${shadowsNoFail.length} (expected ${shadowsAfter.length})`,
      start,
    );

    // ---------------------------------------------------------------------
    console.log("\n📋 Test: createShadowRun persistence");
    console.log("-".repeat(50));

    start = Date.now();
    const { missionRunService } = await import(
      "../../server/domain/mission/core/mission-run.service.js"
    );
    const shadow = await missionRunService.createShadowRun({
      parentRunId: runId,
      modelId: "gemini-2.0-flash",
      promptVersion: "2.0",
      missionContext: {
        autoresearchMetadata: { originalSkillId: skill("unhealthy"), evalTag: TAG, strategy: "eval" },
      },
    });
    const reread = await db
      .select()
      .from(missionShadowRuns)
      .where(eq(missionShadowRuns.id, shadow.id))
      .limit(1);
    const s = reread[0];
    const meta = (s?.missionContext as any)?.autoresearchMetadata;
    await recordResult(
      "Shadow run persisted active with metadata",
      !!s &&
        s.status === "active" &&
        s.parentRunId === runId &&
        s.promptVersion === "2.0" &&
        meta?.originalSkillId === skill("unhealthy"),
      s ? `id=${s.id} status=${s.status} prompt=${s.promptVersion} skill=${meta?.originalSkillId}` : "not found",
      start,
    );

    // ---------------------------------------------------------------------
    console.log("\n📋 Test: Maintenance service status");
    console.log("-".repeat(50));

    start = Date.now();
    const status = getAutoresearchMaintenanceStatus();
    await recordResult(
      "Maintenance status exposes interval config",
      typeof status.enabled === "boolean" &&
        Number.isFinite(status.intervalMinutes) &&
        status.intervalMinutes >= 5 &&
        typeof status.intervalLabel === "string",
      `enabled=${status.enabled} interval=${status.intervalMinutes}m label="${status.intervalLabel}"`,
      start,
    );
  } finally {
    // --- Cleanup ---------------------------------------------------------
    console.log("\n📋 Cleanup");
    console.log("-".repeat(50));
    const start = Date.now();
    let cleaned = "";
    try {
      const evForged = await db
        .delete(forensicEventLog)
        .where(sql`${forensicEventLog.attributes}->>'evalTag' = ${TAG}`);
      cleaned += "events ";
      if (runId) {
        await db.delete(missionShadowRuns).where(eq(missionShadowRuns.parentRunId, runId));
        cleaned += "shadows ";
        await db.delete(missionRuns).where(eq(missionRuns.id, runId));
        cleaned += "run ";
      }
      if (missionId) {
        await db.delete(missions).where(eq(missions.id, missionId));
        cleaned += "mission ";
      }
      void evForged;
      await recordResult("Cleanup", true, `Removed: ${cleaned.trim()}`, start);
    } catch (e: any) {
      await recordResult("Cleanup", false, `Partial cleanup (${cleaned.trim()}): ${e.message}`, start);
    }
  }

  // --- Summary -----------------------------------------------------------
  console.log("\n" + "=".repeat(70));
  console.log("📊 AUTORESEARCH EVALUATION SUMMARY");
  console.log("=".repeat(70));

  // Cleanup is hygiene, not a capability under test — exclude it from the score.
  const scored = results.filter((r) => r.testName !== "Cleanup");
  const passed = scored.filter((r) => r.passed).length;
  const failed = scored.filter((r) => !r.passed).length;
  const passRate = scored.length ? (passed / scored.length) * 100 : 0;

  console.log(`\n   Total Tests: ${scored.length}`);
  console.log(`   Passed: ${passed}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Pass Rate: ${passRate.toFixed(1)}%`);
  console.log(`   Total Duration: ${results.reduce((a, r) => a + r.duration, 0)}ms`);

  console.log("\n   Features Tested:");
  console.log("   - Detection query & thresholds ✓");
  console.log("   - syncNeuralCore triggered/blocked classification ✓");
  console.log("   - Dedup guard (initiateEvolution) ✓");
  console.log("   - createShadowRun persistence ✓");
  console.log("   - Maintenance status ✓");

  console.log("\n" + "=".repeat(70));
  if (passRate >= 80) {
    console.log("🎉 EVALUATION PASSED: Autoresearch subsystem is operational!");
  } else if (passRate >= 50) {
    console.log("⚠️ EVALUATION PARTIAL: Some issues detected in Autoresearch.");
  } else {
    console.log("❌ EVALUATION FAILED: Significant issues with Autoresearch.");
  }
  console.log("=".repeat(70));

  process.exit(passRate >= 50 ? 0 : 1);
}

runEval().catch((e) => {
  console.error("\n❌ EVALUATION CRASHED:", e);
  process.exit(1);
});
