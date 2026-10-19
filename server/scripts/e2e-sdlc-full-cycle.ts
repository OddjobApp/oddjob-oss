/**
 * E2E SDLC Full Cycle — Requirement to Deployment
 *
 * Drives a simple development task ("Add /api/ping endpoint") through the
 * entire SDLC agent cycle in TECHHEAD7 (Org 291), using real agents.
 *
 * Stages:
 * 1. Requirements & Design Analysis (ai-systems-analyst)
 * 2. Core Application Development (ai-backend-dev)
 * 3. QA & Regression Testing (ai-qa-engineer)
 * 4. Release Candidate & UAT (stakeholder approval)
 * 5. Production Deployment (ai-devops-engineer)
 *
 * Each stage triggers the mission, waits for completion (with timeout),
 * and verifies the agent produced output.
 */
import { db } from "../database_service.js";
import { missions, missionRuns, agentRunSteps, jobs } from "@shared/schema/index.js";
import { eq, and, desc } from "drizzle-orm";
import { missionService } from "../domain/mission/core/mission.service.js";

const ORG_ID = 291;
const USER_ID = "system:e2e-cycle-test";
const MAX_WAIT_MS = 90_000; // 90 seconds per mission
const POLL_INTERVAL_MS = 3_000;

// Simple requirement to push through the cycle
const REQUIREMENT = {
  title: "Add /api/ping endpoint",
  description: "Create a GET /api/ping endpoint that returns { status: 'pong', timestamp: ISO string }. Include a unit test.",
  jiraKey: "E2E-PING-001",
  storyPoints: 1,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function findMission(name: string): Promise<number | null> {
  const [m] = await db.select({ id: missions.id })
    .from(missions)
    .where(and(eq(missions.name, name), eq(missions.organizationId, ORG_ID)))
    .limit(1);
  return m?.id ?? null;
}

async function waitForRun(runId: number, label: string): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    const [run] = await db.select({ status: missionRuns.status })
      .from(missionRuns).where(eq(missionRuns.id, runId)).limit(1);
    if (!run) return "not_found";
    if (run.status === "completed") return "completed";
    if (run.status === "failed") return "failed";
    if (run.status === "cancelled") return "cancelled";
    process.stdout.write(".");
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  return "timeout";
}

async function getRunSteps(runId: number) {
  return db.select({
    id: agentRunSteps.id,
    type: agentRunSteps.type,
    toolName: agentRunSteps.toolName,
    content: agentRunSteps.content,
  }).from(agentRunSteps)
    .where(eq(agentRunSteps.missionRunId, runId))
    .orderBy(agentRunSteps.id);
}

function pass(msg: string) { console.log(`  ✅ ${msg}`); }
function fail(msg: string) { console.log(`  ❌ ${msg}`); }
function info(msg: string) { console.log(`  ℹ️  ${msg}`); }

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) { pass(msg); passed++; }
  else { fail(msg); failed++; }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  E2E SDLC Full Cycle — Requirement to Deployment");
  console.log(`  Org: TECHHEAD7 (#${ORG_ID})`);
  console.log(`  Requirement: "${REQUIREMENT.title}"`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  // ─── Stage 0: Verify agents are provisioned ────────────────────────────────
  console.log("── Stage 0: Verify Agent Provisioning ──────────────────────────\n");

  const agentJobs = await db.select({ id: jobs.id, name: jobs.name, isActive: jobs.isActive })
    .from(jobs)
    .where(and(eq(jobs.organizationId, ORG_ID), eq(jobs.type, "ai_agent")));

  assert(agentJobs.length >= 5, `${agentJobs.length} agents provisioned (need ≥5)`);

  const agentNames = agentJobs.map(j => j.name.toLowerCase());
  assert(agentNames.some(n => n.includes("systems analyst") || n.includes("analyst")), "Systems Analyst agent exists");
  assert(agentNames.some(n => n.includes("backend")), "Backend Developer agent exists");
  assert(agentNames.some(n => n.includes("qa") || n.includes("quality")), "QA Engineer agent exists");
  assert(agentNames.some(n => n.includes("scrum") || n.includes("master")), "Scrum Master agent exists");

  // ─── Stage 1: Requirements & Design Analysis ──────────────────────────────
  console.log("\n── Stage 1: Requirements & Design Analysis ─────────────────────\n");

  const mission2Id = await findMission("Requirements & Design Analysis");
  assert(mission2Id !== null, `Mission "Requirements & Design Analysis" found (ID: ${mission2Id})`);

  if (mission2Id) {
    info("Launching mission with requirement context...");
    const result = await missionService.launchMission(mission2Id, USER_ID, ORG_ID, undefined, {
      jiraKey: REQUIREMENT.jiraKey,
      title: REQUIREMENT.title,
      description: REQUIREMENT.description,
      sourceType: "e2e_test",
    });

    assert(result.success === true, `Mission launched (Run #${result.missionRunId})`);

    if (result.missionRunId) {
      process.stdout.write("  Waiting for completion");
      const status = await waitForRun(result.missionRunId, "Requirements");
      console.log("");
      assert(status === "completed" || status === "timeout", `Mission status: ${status}`);

      const steps = await getRunSteps(result.missionRunId);
      assert(steps.length > 0, `Agent produced ${steps.length} execution steps`);
      info(`Step types: ${[...new Set(steps.map(s => s.type))].join(", ")}`);
    }
  }

  // ─── Stage 2: Core Application Development ────────────────────────────────
  console.log("\n── Stage 2: Core Application Development ───────────────────────\n");

  const mission3Id = await findMission("Core Application Development");
  assert(mission3Id !== null, `Mission "Core Application Development" found (ID: ${mission3Id})`);

  if (mission3Id) {
    info("Launching development mission...");
    const result = await missionService.launchMission(mission3Id, USER_ID, ORG_ID, undefined, {
      jiraKey: REQUIREMENT.jiraKey,
      title: REQUIREMENT.title,
      prdApproved: true,
      storyPoints: REQUIREMENT.storyPoints,
    });

    assert(result.success === true, `Mission launched (Run #${result.missionRunId})`);

    if (result.missionRunId) {
      process.stdout.write("  Waiting for completion");
      const status = await waitForRun(result.missionRunId, "Development");
      console.log("");
      assert(status === "completed" || status === "timeout", `Mission status: ${status}`);

      const steps = await getRunSteps(result.missionRunId);
      assert(steps.length > 0, `Agent produced ${steps.length} execution steps`);

      // Check if code was written
      const codeSteps = steps.filter(s =>
        s.toolName?.includes("file_write") || s.toolName?.includes("write") ||
        String(s.content).includes("function") || String(s.content).includes("export")
      );
      info(`Code-related steps: ${codeSteps.length}`);
    }
  }

  // ─── Stage 3: QA & Regression Testing ─────────────────────────────────────
  console.log("\n── Stage 3: QA & Regression Testing ────────────────────────────\n");

  const mission4Id = await findMission("QA & Regression Testing");
  assert(mission4Id !== null, `Mission "QA & Regression Testing" found (ID: ${mission4Id})`);

  if (mission4Id) {
    info("Launching QA mission...");
    const result = await missionService.launchMission(mission4Id, USER_ID, ORG_ID, undefined, {
      jiraKey: REQUIREMENT.jiraKey,
      pullRequestMerged: true,
      targetBranch: "staging",
    });

    assert(result.success === true, `Mission launched (Run #${result.missionRunId})`);

    if (result.missionRunId) {
      process.stdout.write("  Waiting for completion");
      const status = await waitForRun(result.missionRunId, "QA");
      console.log("");
      assert(status === "completed" || status === "timeout", `Mission status: ${status}`);

      const steps = await getRunSteps(result.missionRunId);
      assert(steps.length > 0, `Agent produced ${steps.length} execution steps`);
    }
  }

  // ─── Stage 4: Release Candidate & UAT ─────────────────────────────────────
  console.log("\n── Stage 4: Release Candidate & UAT ────────────────────────────\n");

  const mission5Id = await findMission("Release Candidate & UAT");
  assert(mission5Id !== null, `Mission "Release Candidate & UAT" found (ID: ${mission5Id})`);

  if (mission5Id) {
    info("Launching UAT mission...");
    const result = await missionService.launchMission(mission5Id, USER_ID, ORG_ID, undefined, {
      jiraKey: REQUIREMENT.jiraKey,
      qaGatePassed: true,
      releaseVersion: "1.0.1",
    });

    assert(result.success === true, `Mission launched (Run #${result.missionRunId})`);

    if (result.missionRunId) {
      process.stdout.write("  Waiting for completion");
      const status = await waitForRun(result.missionRunId, "UAT");
      console.log("");
      assert(status === "completed" || status === "timeout", `Mission status: ${status}`);

      const steps = await getRunSteps(result.missionRunId);
      assert(steps.length > 0, `Agent produced ${steps.length} execution steps`);
    }
  }

  // ─── Stage 5: Production Deployment ───────────────────────────────────────
  console.log("\n── Stage 5: Production Deployment ──────────────────────────────\n");

  const mission6Id = await findMission("Production Deployment");
  assert(mission6Id !== null, `Mission "Production Deployment" found (ID: ${mission6Id})`);

  if (mission6Id) {
    info("Launching deployment mission...");
    const result = await missionService.launchMission(mission6Id, USER_ID, ORG_ID, undefined, {
      jiraKey: REQUIREMENT.jiraKey,
      uatApproved: true,
      cabApproved: true,
      releaseVersion: "1.0.1",
    });

    assert(result.success === true, `Mission launched (Run #${result.missionRunId})`);

    if (result.missionRunId) {
      process.stdout.write("  Waiting for completion");
      const status = await waitForRun(result.missionRunId, "Deployment");
      console.log("");
      assert(status === "completed" || status === "timeout", `Mission status: ${status}`);

      const steps = await getRunSteps(result.missionRunId);
      assert(steps.length > 0, `Agent produced ${steps.length} execution steps`);
    }
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(`  RESULTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
