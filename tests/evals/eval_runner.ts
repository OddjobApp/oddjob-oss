import { dynamicOrchestratorService } from "../../server/domain/mission/core/dynamic-orchestrator.service.js";
import { missionRunService } from "../../server/domain/mission/core/mission-run.service.js";
import { db } from "../../server/database_service.js";
import { decisionRouter } from "../../server/domain/governor/core/decision-router.js";
import { redis } from "../../server/domain/core/infrastructure/redis/redis-client.js";
import { missions, missionRuns, orgs, users } from "@shared/schema/index.js";
import { evaluationService } from "../../server/domain/pipeline/core/evaluation.service.js";
import { evalStoreService } from "../../server/domain/ai/core/eval-store.service.js";
import { evalScenarioSchema, type EvalScenario, type SubjectPassRate } from "@shared/contracts/index.js";
import { scoreRepeat, scoreScenario, aggregateSubjects, type ScenarioResult, type RepeatOutcome } from "./scoring.js";
import { eq } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// Mock Decision Router to auto-approve in evals
decisionRouter.requestDecision = async (request) => {
    console.log(`[Eval Mock] Auto-approving request for ${request.tool}`);
    return { approved: true, source: "db" };
};

const MAX_CYCLES = 3; // Limit cycles per run to save time/cost

interface EvalContext { orgId: number; userId: string; }

async function ensureOrgUser(): Promise<EvalContext> {
    let orgId = 1;
    const [existingOrg] = await db.select().from(orgs).limit(1);
    if (existingOrg) orgId = existingOrg.id;
    else {
        const [newOrg] = await db.insert(orgs).values({ name: "Eval Org" } as any).returning();
        orgId = newOrg.id;
    }

    let userId = "eval-user";
    const [existingUser] = await db.select().from(users).limit(1);
    if (existingUser) userId = existingUser.id;
    else {
        // username and password are NOT NULL with no default, and `name` is not
        // a column on users at all. The original insert supplied neither, so
        // this threw 23502 on the first row it tried to create — meaning the
        // runner could never complete against a fresh database, which is why
        // the committed baseline is marked commit: "seed" rather than measured.
        const [newUser] = await db.insert(users).values({
            id: userId,
            username: "eval-user",
            password: "eval-only-not-a-login",
            email: "eval@example.com",
            organizationId: orgId,
        } as any).returning();
        userId = newUser.id;
    }
    return { orgId, userId };
}

async function resetQuotas() {
    await redis.set("quota:gap:global", "1000");
    await redis.set("quota:gap:ollama", "1000");
    await redis.set("quota:gap:gemini-flash-latest", "1000");
    for (const k of ["quota:last:global", "quota:last:ollama", "quota:last:gemini-flash-latest", "quota:burst:global", "quota:burst:ollama", "quota:burst:gemini-flash-latest"]) {
        await redis.del(k);
    }
}

/** Run one mission for the scenario and return its trace + serialized context. */
async function runMissionOnce(scenario: EvalScenario, ctx: EvalContext): Promise<{ trace: any[]; resultStr: string }> {
    await resetQuotas();

    const [mission] = await db.insert(missions).values({
        name: `Eval: ${scenario.name}`,
        objective: scenario.prompt,
        organizationId: ctx.orgId,
        createdBy: ctx.userId,
        status: "active",
        executionStrategy: "dynamic_autonomous",
    } as any).returning();

    const launchResult = await dynamicOrchestratorService.launchDynamicMission(mission.id, ctx.userId, ctx.orgId, { intent: scenario.prompt });
    if (!launchResult.success || !launchResult.missionRunId) {
        console.error("Failed to launch mission:", launchResult.error);
        return { trace: [], resultStr: "{}" };
    }

    const runId = launchResult.missionRunId;
    let run = await missionRunService.getById(runId);
    let cycles = 0;
    while (run && run.status === "active" && cycles < MAX_CYCLES) {
        await dynamicOrchestratorService.processMissionCycle(runId, ctx.userId, ctx.orgId);
        run = await missionRunService.getById(runId);
        cycles++;
    }

    const [updatedRun] = await db.select().from(missionRuns).where(eq(missionRuns.id, runId)).limit(1);
    return {
        trace: (updatedRun?.dynamicTrace as any[]) || [],
        resultStr: JSON.stringify(updatedRun?.missionContext || {}),
    };
}

/** Evaluate each criterion against one run's trace/output → aligned pass flags. */
async function checkCriteria(scenario: EvalScenario, trace: any[], resultStr: string): Promise<boolean[]> {
    const flags: boolean[] = [];
    for (const c of scenario.criteria) {
        let passed = false;
        if (c.type === "tool_used") {
            passed = trace.some((t) => t.type === "decision" && t.action === c.value);
        } else if (c.type === "final_output_contains") {
            passed = resultStr.includes(c.value);
        } else if (c.type === "llm_judge") {
            passed = await evaluationService.evaluateWithLLM(resultStr, c.value);
        }
        flags.push(passed);
    }
    return flags;
}

async function runEval(scenarioPath: string, ctx: EvalContext): Promise<ScenarioResult | null> {
    if (!fs.existsSync(scenarioPath)) {
        console.error(`Scenario file not found: ${scenarioPath}`);
        return null;
    }

    const parsed = evalScenarioSchema.safeParse(JSON.parse(fs.readFileSync(scenarioPath, "utf-8")));
    if (!parsed.success) {
        console.error(`Invalid scenario ${scenarioPath}:`, parsed.error.issues.map((i) => i.message).join("; "));
        return null;
    }
    const scenario = parsed.data;

    console.log(`\n=== ${scenario.name} · subject ${scenario.subject.kind}:${scenario.subject.ref} · repeats ${scenario.repeats} ===`);

    const repeatOutcomes: RepeatOutcome[] = [];
    for (let i = 0; i < scenario.repeats; i++) {
        try {
            const { trace, resultStr } = await runMissionOnce(scenario, ctx);
            const flags = await checkCriteria(scenario, trace, resultStr);
            repeatOutcomes.push(scoreRepeat(scenario.criteria, flags));
        } catch (err) {
            console.error(`Repeat ${i + 1} failed:`, err);
            repeatOutcomes.push(scoreRepeat(scenario.criteria, scenario.criteria.map(() => false)));
        }
    }

    const result = scoreScenario(scenario, repeatOutcomes);
    console.log(`  → passRate ${result.passRate.toFixed(3)} (threshold ${result.threshold}) — ${result.passed ? "PASS" : "FAIL"}`);
    return result;
}

/**
 * Refuse to grade canned output.
 *
 * When the Gemini project is over its spending cap the client answers 429, the
 * chain fails over, and under NODE_ENV=test it lands on MockAIClient — which
 * returns fixed strings tagged `provider: "mock"` while still reporting the
 * requested model name. The suite runs to completion and writes a full,
 * plausible-looking results file that grades nothing but the mock.
 *
 * That file is what the regression gate reads and what a re-baseline would be
 * cut from, so a capped key would quietly become the committed definition of
 * "how well the agents perform". One real call up front, and we stop.
 */
async function assertLiveModel(): Promise<void> {
    const { AIClientFactory } = await import("../../server/domain/ai/core/ai-client.service.js");
    const client = AIClientFactory.getClient({ provider: "gemini" } as any);
    const res: any = await client.execute(
        { provider: "gemini", model: "gemini-2.5-flash", userPrompt: "Reply with the single word: ok" } as any,
        undefined,
        process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
    );

    const provider = res?.metadata?.provider;
    if (provider === "mock" || !res?.success) {
        console.error(
            [
                "",
                "[evals] ABORT - the model chain answered from the mock client" +
                    (provider ? ` (provider: ${provider})` : "") + ".",
                "        Every scenario would be scored against canned text, and the",
                "        results file would look exactly like a real run.",
                "        Usual cause: the Gemini project is over its monthly spend cap",
                "        (429 RESOURCE_EXHAUSTED). Check https://ai.studio/spend .",
                "        Set EVALS_ALLOW_MOCK=1 to override - the numbers are not",
                "        usable as a baseline.",
                "",
            ].join("\n"),
        );
        process.exit(3);
    }
    console.log(`[evals] Preflight OK — live model responded (provider: ${provider ?? "unknown"}).`);
}

function currentCommit(): string | undefined {
    try { return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim(); } catch { return undefined; }
}

async function runAll() {
    const scenariosDir = path.join(process.cwd(), "tests/evals/scenarios");
    if (!fs.existsSync(scenariosDir)) {
        console.error("Scenarios directory not found!");
        process.exit(1);
    }

    if (process.env.EVALS_ALLOW_MOCK !== "1") {
        await assertLiveModel();
    } else {
        console.warn("[evals] EVALS_ALLOW_MOCK=1 — results may come from the mock client and must not be baselined.");
    }

    const ctx = await ensureOrgUser();
    const files = fs.readdirSync(scenariosDir).filter((f) => f.endsWith(".json"));
    console.log(`Found ${files.length} evaluation scenarios.`);

    const results: ScenarioResult[] = [];
    for (const file of files) {
        const res = await runEval(path.join(scenariosDir, file), ctx);
        if (res) results.push(res);
    }

    const subjects: SubjectPassRate[] = aggregateSubjects(results);

    // Write the per-subject results the regression gate consumes.
    const outPath = path.join(process.cwd(), "tests/evals/.last-results.json");
    fs.writeFileSync(outPath, JSON.stringify(subjects, null, 2));

    // Persist run history (best-effort).
    await evalStoreService.recordRun({ commitSha: currentCommit(), results, meta: { files: files.length } });

    console.log("\n========================================");
    console.log("          EVALUATION SUMMARY            ");
    console.log("========================================");
    let allPassed = true;
    for (const r of results) {
        console.log(`[${r.passed ? "PASS" : "FAIL"}] ${r.scenarioId} — passRate ${r.passRate.toFixed(3)} (var ${r.variance.toFixed(3)})`);
        if (!r.passed) allPassed = false;
    }
    console.log("\nPer-subject pass-rate:");
    for (const s of subjects) {
        console.log(`  ${s.subjectKey}: ${s.passRate.toFixed(3)} (${s.scenarioCount} scenario${s.scenarioCount > 1 ? "s" : ""})`);
    }
    console.log(`\nResults written to ${outPath} — run \`npm run evals:gate\` to check against baseline.`);
    console.log(allPassed ? "🎉 ALL EVALS PASSED!" : "⚠️ SOME EVALS FAILED");

    process.exit(allPassed ? 0 : 1);
}

runAll();
