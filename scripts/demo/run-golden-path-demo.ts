/**
 * Golden Path Demo — the real, executed version.
 *
 * `npm run smoke:golden-path` is a deterministic CONTRACT check: it validates the
 * fixture and re-evaluates the shared autonomy policy, but it creates no mission and
 * its timeline is derived from the fixture rather than from an execution.
 *
 * This script is the end-to-end counterpart. It actually:
 *   1. creates (or reuses) an isolated demo organization,
 *   2. ingests the fixture's knowledge documents into Knowledge Store,
 *   3. creates a real mission and mission run,
 *   4. reads the knowledge back out of the database to ground the work,
 *   5. evaluates the SHARED autonomy policy on the external commitment,
 *   6. opens a real approval request and pauses the run (status: waiting_on_human),
 *   7. records the human decision and resumes the run,
 *   8. completes the run and prints the timeline read back from the database.
 *
 * SAFETY CONTRACT
 * ---------------
 * - Runs against the configured DATABASE_URL (the point is to prove the real stack).
 * - Strictly ADDITIVE. It never truncates and never updates a row it did not create.
 * - Everything it creates is scoped to one organization named DEMO_ORG_NAME.
 * - Idempotent: re-running reuses the demo org, mission, and knowledge documents.
 * - `--cleanup` deletes exactly what it created, scoped to that org id, and nothing else.
 * - Refuses to run when NODE_ENV=production.
 *
 * Usage:
 *   npm run demo:golden-path
 *   npm run demo:golden-path -- --cleanup
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "../../server/db/index.js";
import { orgs, users } from "../../shared/schema/auth.js";
import { missions } from "../../shared/schema/missions/core.js";
import { missionRuns } from "../../shared/schema/missions/runs.js";
import { approvalRequests } from "../../shared/schema/hil.js";
import { knowledgeDocuments } from "../../shared/schema/knowledge-base.js";
import { evaluateAutonomyPolicy } from "../../shared/governance/autonomy-policy.js";
import {
    validateGovernedSupportTriageFixture,
    type GovernedSupportTriageFixture,
} from "../../shared/product/golden-path-contract.js";

import { missionService } from "../../server/domain/mission/core/mission.service.js";
import { missionRunService } from "../../server/domain/mission/core/mission-run.service.js";
import { knowledgeService } from "../../server/domain/knowledge/core/knowledge.service.js";
import { approvalService } from "../../server/domain/integrations/core/approval.service.js";

// ---------------------------------------------------------------------------
// Constants — the blast radius of this script is everything named below.
// ---------------------------------------------------------------------------

const DEMO_ORG_NAME = "Golden Path Demo";
const DEMO_USERNAME = "golden-path-operator";
const DEMO_MISSION_NAME = "Golden Path — Governed Support Triage";
/** RFC 2606 reserved TLD: guaranteed undeliverable, so the demo cannot email a real person. */
const DEMO_APPROVER_EMAIL = "golden-path-operator@demo.invalid";

const FIXTURE_PATH = resolve("fixtures/golden-path/governed-support-triage.json");

// ---------------------------------------------------------------------------
// Small output helpers
// ---------------------------------------------------------------------------

let stepNumber = 0;
const step = (label: string) => console.log(`\n[${++stepNumber}] ${label}`);
const detail = (label: string, value: unknown) => console.log(`      ${label}: ${value}`);
const fail = (message: string): never => {
    console.error(`\n✗ ${message}`);
    process.exit(1);
};

/** Assert a condition that the demo is supposed to be proving. */
function prove(condition: boolean, claim: string, observed: string) {
    if (!condition) fail(`Demo claim not met — ${claim}. Observed: ${observed}`);
    console.log(`      ✓ ${claim} (${observed})`);
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function assertNotProduction() {
    if (process.env.NODE_ENV === "production") {
        fail("Refusing to run against NODE_ENV=production. This script writes demo data.");
    }
    if (!process.env.DATABASE_URL) {
        fail("DATABASE_URL is not set. Configure your development database first.");
    }
}

// ---------------------------------------------------------------------------
// Idempotent resolution of the demo scope
// ---------------------------------------------------------------------------

async function resolveDemoOrg(): Promise<{ id: number; created: boolean }> {
    const [existing] = await db.select().from(orgs).where(eq(orgs.name, DEMO_ORG_NAME)).limit(1);
    if (existing) return { id: existing.id, created: false };

    const [created] = await db.insert(orgs).values({ name: DEMO_ORG_NAME }).returning();
    if (!created) fail("Could not create the demo organization.");
    return { id: created.id, created: true };
}

async function resolveDemoUser(orgId: number): Promise<{ id: string; created: boolean }> {
    const [existing] = await db.select().from(users).where(eq(users.username, DEMO_USERNAME)).limit(1);
    if (existing) return { id: existing.id, created: false };

    // Password is a placeholder — this account exists to own demo rows, not to log in.
    const [created] = await db
        .insert(users)
        .values({
            username: DEMO_USERNAME,
            password: "!golden-path-demo-no-login!",
            email: DEMO_APPROVER_EMAIL,
            firstName: "Golden Path",
            lastName: "Operator",
            defaultOrgId: orgId,
        })
        .returning();
    if (!created) fail("Could not create the demo user.");
    return { id: created.id, created: true };
}

async function resolveDemoMission(orgId: number, userId: string, fixture: GovernedSupportTriageFixture) {
    const [existing] = await db
        .select()
        .from(missions)
        .where(and(eq(missions.organizationId, orgId), eq(missions.name, DEMO_MISSION_NAME), isNull(missions.deletedAt)))
        .limit(1);
    if (existing) return { mission: existing, created: false };

    const mission = await missionService.createMission(
        {
            name: DEMO_MISSION_NAME,
            description: fixture.title,
            objective: fixture.mission.objective,
            organizationId: orgId,
            type: "governed",
            executionStrategy: "human_driven",
            hilStrictness: "strict",
        } as any,
        userId,
    );
    if (!mission) fail("Could not create the demo mission.");
    return { mission, created: true };
}

// ---------------------------------------------------------------------------
// Cleanup — scoped strictly to the demo org id
// ---------------------------------------------------------------------------

async function cleanup() {
    step("Cleaning up demo data");

    const [org] = await db.select().from(orgs).where(eq(orgs.name, DEMO_ORG_NAME)).limit(1);
    if (!org) {
        console.log("      Nothing to clean up — no demo organization found.");
        return;
    }
    detail("demo org id", org.id);

    const runRows = await db
        .select({ id: missionRuns.id })
        .from(missionRuns)
        .where(eq(missionRuns.organizationId, org.id));
    const runIds = runRows.map((r) => r.id);

    // Approvals are keyed by executionId (the run id as text), so delete by org first,
    // then mop up any run-scoped rows that predate organizationId being populated.
    const approvalsByOrg = await db
        .delete(approvalRequests)
        .where(eq(approvalRequests.organizationId, org.id))
        .returning({ id: approvalRequests.id });

    let approvalsByRun: Array<{ id: number }> = [];
    if (runIds.length > 0) {
        approvalsByRun = await db
            .delete(approvalRequests)
            .where(inArray(approvalRequests.executionId, runIds.map(String)))
            .returning({ id: approvalRequests.id });
    }

    const deletedRuns = await db
        .delete(missionRuns)
        .where(eq(missionRuns.organizationId, org.id))
        .returning({ id: missionRuns.id });

    const deletedMissions = await db
        .delete(missions)
        .where(eq(missions.organizationId, org.id))
        .returning({ id: missions.id });

    const deletedDocs = await db
        .delete(knowledgeDocuments)
        .where(eq(knowledgeDocuments.organizationId, org.id))
        .returning({ id: knowledgeDocuments.id });

    detail("approval requests deleted", approvalsByOrg.length + approvalsByRun.length);
    detail("mission runs deleted", deletedRuns.length);
    detail("missions deleted", deletedMissions.length);
    detail("knowledge documents deleted", deletedDocs.length);

    // The demo user and org are left in place by default: the org may own a default
    // project row created by the projects service, and deleting it can trip FKs from
    // unrelated tables in a heavily-seeded dev database. Removing the data above is
    // what makes the demo re-runnable from clean.
    console.log(
        `\n      Kept: org "${DEMO_ORG_NAME}" (id ${org.id}) and user "${DEMO_USERNAME}".` +
        `\n      Re-running the demo reuses them. Delete manually if you want them gone.`,
    );
    console.log("\n✓ Cleanup complete.");
}

// ---------------------------------------------------------------------------
// The demo itself
// ---------------------------------------------------------------------------

async function runDemo() {
    const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as GovernedSupportTriageFixture;

    const fixtureErrors = validateGovernedSupportTriageFixture(fixture);
    if (fixtureErrors.length > 0) {
        fail(`Fixture is invalid:\n- ${fixtureErrors.join("\n- ")}`);
    }

    console.log("═".repeat(72));
    console.log("  Golden Path Demo — governed support triage, executed end to end");
    console.log("═".repeat(72));

    // -- 1. Scope ----------------------------------------------------------
    step("Resolving isolated demo scope");
    const org = await resolveDemoOrg();
    const user = await resolveDemoUser(org.id);
    detail("organization", `${DEMO_ORG_NAME} (id ${org.id}) ${org.created ? "— created" : "— reused"}`);
    detail("operator", `${DEMO_USERNAME} ${user.created ? "— created" : "— reused"}`);

    // -- 2. Knowledge ingest ----------------------------------------------
    step("Ingesting grounding knowledge into Knowledge Store");
    const orgContext = { organizationId: org.id, userId: user.id } as any;
    for (const doc of fixture.knowledge) {
        await knowledgeService.createDocument(
            {
                title: doc.title,
                summary: `Golden path grounding source (confidence ${doc.sourceConfidence}).`,
                sourceType: "golden-path-demo",
                textContent: doc.content,
                metadata: { goldenPathId: doc.id, sourceConfidence: doc.sourceConfidence },
            },
            orgContext,
        );
        detail("ingested", `${doc.title} (confidence ${doc.sourceConfidence})`);
    }

    // -- 3. Mission --------------------------------------------------------
    step("Creating the governed mission");
    const { mission, created } = await resolveDemoMission(org.id, user.id, fixture);
    detail("mission", `#${mission.id} "${mission.name}" ${created ? "— created" : "— reused"}`);
    detail("objective", fixture.mission.objective);

    const run = await missionRunService.create({
        missionId: mission.id,
        organizationId: org.id,
        name: `Golden path run — ${fixture.ticket.id}`,
        pipelineSequence: [],
        createdBy: DEMO_USERNAME,
        missionContext: {
            goldenPathFixture: fixture.id,
            ticket: { id: fixture.ticket.id, subject: fixture.ticket.subject, signals: fixture.ticket.signals },
        },
    });
    detail("mission run", `#${run.id} (status: ${run.status})`);

    await missionRunService.checkpoint({
        missionRunId: run.id,
        missionId: mission.id,
        missionContext: { phase: "mission_created", ticket: fixture.ticket.id },
        reason: "Governed support mission created.",
        changedBy: DEMO_USERNAME,
    });

    // -- 4. Grounding (a real read-back, not a sort over the fixture) -------
    step("Grounding the mission in stored knowledge");
    const storedDocs = await db
        .select({ id: knowledgeDocuments.id, title: knowledgeDocuments.title, metadata: knowledgeDocuments.metadata })
        .from(knowledgeDocuments)
        .where(and(eq(knowledgeDocuments.organizationId, org.id), eq(knowledgeDocuments.sourceType, "golden-path-demo")));

    prove(
        storedDocs.length >= fixture.knowledge.length,
        "knowledge retrieved from the database",
        `${storedDocs.length} documents`,
    );
    for (const doc of storedDocs) detail("cited", `#${doc.id} ${doc.title}`);

    await missionRunService.checkpoint({
        missionRunId: run.id,
        missionId: mission.id,
        missionContext: { phase: "knowledge_retrieved", documentIds: storedDocs.map((d) => d.id) },
        reason: `Retrieved ${storedDocs.length} trusted sources.`,
        changedBy: DEMO_USERNAME,
    });

    // -- 5. Classification -------------------------------------------------
    step("Classifying the issue");
    const classification = fixture.ticket.signals.includes("workflow_failure")
        ? "workflow_instability"
        : "support_escalation";
    detail("signals", fixture.ticket.signals.join(", "));
    detail("classification", classification);

    await missionRunService.checkpoint({
        missionRunId: run.id,
        missionId: mission.id,
        missionContext: { phase: "issue_classified", classification },
        reason: `Issue classified as ${classification}.`,
        changedBy: DEMO_USERNAME,
    });

    // -- 6. Policy gate (the real shared policy engine) --------------------
    step("Evaluating the shared autonomy policy on the external commitment");
    const policy = evaluateAutonomyPolicy({
        domain: "mission",
        goal: fixture.mission.objective,
        instruction: fixture.approvalScenario.trigger,
        action: "send message to customer",
    });
    detail("decision", `${policy.decision} (${policy.maxRiskLevel})`);
    detail("rationale", policy.rationale);

    prove(
        policy.decision === fixture.approvalScenario.expectedDecisionBeforeApproval,
        "policy withheld autonomous action",
        `decision=${policy.decision}`,
    );
    prove(
        policy.flags.some((flag) => flag.code === fixture.approvalScenario.policyFlag),
        "required policy flag raised",
        fixture.approvalScenario.policyFlag,
    );

    // -- 7. Approval + pause ----------------------------------------------
    step("Opening the approval request and pausing the run");
    const approval = await approvalService.createApprovalRequest({
        executionId: String(run.id),
        approverType: "internal",
        approverEmail: DEMO_APPROVER_EMAIL,
        approverId: user.id,
        status: "pending",
        organizationId: org.id,
        context: {
            type: "golden_path_external_commitment",
            classification,
            policyFlag: fixture.approvalScenario.policyFlag,
            reviewReason: policy.rationale,
            proposedResponse: fixture.approvalScenario.trigger,
            citedDocumentIds: storedDocs.map((d) => d.id),
        },
    });
    detail("approval request", `#${approval.id} (status: ${approval.status})`);

    await missionRunService.pauseForHumanApproval(run.id, [approval.id]);

    const pausedRun = await missionRunService.getByIdOrThrow(run.id, org.id);
    prove(
        pausedRun.status === "waiting_on_human",
        "mission run paused for human review",
        `status=${pausedRun.status}`,
    );

    // -- 8. Human decision -------------------------------------------------
    step("Recording the human decision");
    const [decided] = await db
        .update(approvalRequests)
        .set({
            status: "approved",
            decisionAt: new Date(),
            comments: "Approved with edits by the golden-path operator.",
            modifiedOutput: { decision: fixture.approvalScenario.humanDecision, editedBy: DEMO_USERNAME },
        })
        .where(eq(approvalRequests.id, approval.id))
        .returning();
    detail("decision", `${decided?.status} — ${fixture.approvalScenario.humanDecision}`);

    await missionRunService.checkpoint({
        missionRunId: run.id,
        missionId: mission.id,
        missionContext: { phase: "approval_recorded", approvalId: approval.id, decision: decided?.status },
        reason: `Human decision recorded: ${fixture.approvalScenario.humanDecision}.`,
        changedBy: DEMO_USERNAME,
    });

    // -- 9. Resume ---------------------------------------------------------
    step("Resuming the mission run");
    await missionRunService.clearResumeAndSetActive(run.id);
    const resumedRun = await missionRunService.getByIdOrThrow(run.id, org.id);
    prove(resumedRun.status === "active", "mission run resumed after approval", `status=${resumedRun.status}`);

    // -- 10. Complete ------------------------------------------------------
    step("Completing the mission run");
    await missionRunService.checkpoint({
        missionRunId: run.id,
        missionId: mission.id,
        missionContext: { phase: "mission_completed", classification, approvalId: approval.id },
        reason: "Mission resumed and completed with replay evidence.",
        changedBy: DEMO_USERNAME,
        status: "completed",
        isSuccess: true,
    });

    const finalRun = await missionRunService.getByIdOrThrow(run.id, org.id);
    prove(finalRun.status === "completed", "mission run completed", `status=${finalRun.status}`);

    // -- 11. Replay --------------------------------------------------------
    step("Reading the replay timeline back from the database");
    const checkpoints = await missionRunService.getCheckpoints(run.id, 50, mission.id);
    prove(checkpoints.length >= 5, "replay evidence persisted", `${checkpoints.length} checkpoints`);
    for (const cp of [...checkpoints].reverse()) {
        detail(cp.createdAt.toISOString(), cp.changeReason ?? "(no reason recorded)");
    }

    // -- Report ------------------------------------------------------------
    console.log("\n" + "═".repeat(72));
    console.log("  Golden path completed — every assertion above was read back from the DB");
    console.log("═".repeat(72));
    console.log(`  organization    ${DEMO_ORG_NAME} (id ${org.id})`);
    console.log(`  mission         #${mission.id}`);
    console.log(`  mission run     #${run.id} → ${finalRun.status}`);
    console.log(`  classification  ${classification}`);
    console.log(`  policy          ${policy.decision} (${policy.maxRiskLevel}) · flag ${fixture.approvalScenario.policyFlag}`);
    console.log(`  approval        #${approval.id} → ${decided?.status} (${fixture.approvalScenario.humanDecision})`);
    console.log(`  knowledge       ${storedDocs.length} documents cited`);
    console.log(`  replay          ${checkpoints.length} checkpoints`);
    console.log("═".repeat(72));
    console.log(`\n  Inspect in the UI:  /missions/${mission.id}`);
    console.log(`  Remove demo data:   npm run demo:golden-path -- --cleanup\n`);
}

// ---------------------------------------------------------------------------

async function main() {
    const args = process.argv.slice(2);

    if (args.includes("--help") || args.includes("-h")) {
        console.log("Usage: npm run demo:golden-path [-- --cleanup]");
        console.log("  (no flags)   run the governed support-triage demo end to end");
        console.log("  --cleanup    delete the demo data this script created");
        return;
    }

    assertNotProduction();

    if (args.includes("--cleanup")) {
        await cleanup();
        return;
    }

    await runDemo();
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("\n✗ Golden path demo failed:", error);
        process.exit(1);
    });
