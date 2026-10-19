import { db } from "@server/database_service.js";
import { evalRuns, evalResults } from "@shared/schema/index.js";
import type { ScenarioResult } from "../../../../tests/evals/scoring.js";

/**
 * Persists eval runs and per-subject results — the history that Phase 02's
 * autonomy ladder queries. Writes are best-effort: a persistence failure must
 * never fail the eval itself, only warn.
 */
export interface RecordEvalRunInput {
    commitSha?: string | null;
    suite?: string;
    model?: string | null;
    results: ScenarioResult[];
    meta?: Record<string, unknown>;
}

export class EvalStoreService {
    async recordRun(input: RecordEvalRunInput): Promise<number | null> {
        try {
            const passed = input.results.filter((r) => r.passed).length;

            const [run] = await db
                .insert(evalRuns)
                .values({
                    commitSha: input.commitSha ?? null,
                    suite: input.suite ?? "scenarios",
                    model: input.model ?? null,
                    totalScenarios: input.results.length,
                    passedScenarios: passed,
                    finishedAt: new Date(),
                    meta: input.meta ?? null,
                } as any)
                .returning();

            if (input.results.length > 0) {
                await db.insert(evalResults).values(
                    input.results.map((r) => ({
                        runId: run.id,
                        subjectKind: r.subject.kind,
                        subjectRef: r.subject.ref,
                        subjectKey: r.subjectKey,
                        scenarioId: r.scenarioId,
                        passRate: r.passRate.toFixed(4),
                        threshold: r.threshold.toFixed(4),
                        passed: r.passed,
                        repeats: r.repeats,
                        variance: r.variance.toFixed(5),
                        criteria: r.repeatOutcomes,
                    })) as any,
                );
            }

            return run.id;
        } catch (e: any) {
            console.warn("[EvalStore] Failed to persist eval run:", e?.message || e);
            return null;
        }
    }
}

export const evalStoreService = new EvalStoreService();
