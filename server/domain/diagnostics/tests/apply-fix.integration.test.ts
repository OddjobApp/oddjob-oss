/**
 * applyFix used to change nothing. It recorded the chosen recommendation and returned
 * { success: false, error: 'Engine is mocked' }, so a diagnosis could suggest a repair
 * and no path existed to carry it out.
 *
 * It now applies exactly one action type. FixAction has seven, and they are not equally
 * safe: update_url, add_header, switch_credential, change_method and update_config all
 * change how a job authenticates or where it sends traffic, from a pattern-matched
 * suggestion with no review step. Those are refused and recorded for a human.
 *
 * add_retry only writes pipeline_steps.retry_config, which pipeline-step-runner already
 * reads to decide allowedAttempts and backoff. It is bounded, reversible, and 0 of 1058
 * steps set it today — so nothing retries at all.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@server/database_service.js";
import { errorDiagnoses } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { errorDiagnosisEngine } from "@domain/diagnostics/core/error-diagnosis.engine.js";

const ids: string[] = [];

const seed = async (recommendations: any[], stepExecutionId: number | null = null) => {
    const diagnosisId = randomUUID();
    ids.push(diagnosisId);
    await db.insert(errorDiagnoses).values({
        diagnosisId,
        errorMessage: "boom",
        recommendations,
        stepExecutionId,
    } as any);
    return diagnosisId;
};

afterAll(async () => {
    for (const id of ids) {
        await db.delete(errorDiagnoses).where(eq(errorDiagnoses.diagnosisId, id)).catch(() => {});
    }
});

describe("applyFix — what it refuses to do unattended", () => {
    it.each([
        ["update_url", { type: "update_url", newUrl: "https://elsewhere.example" }],
        ["add_header", { type: "add_header", key: "Authorization", value: "Bearer x" }],
        ["switch_credential", { type: "switch_credential", reason: "expired" }],
        ["change_method", { type: "change_method", newMethod: "POST" }],
        ["update_config", { type: "update_config", field: "url", value: "x" }],
    ])("refuses %s, but records the choice for a human", async (_name, action) => {
        const id = await seed([{ id: "f1", description: "d", action, confidence: 0.9 }]);
        const res: any = await errorDiagnosisEngine.applyFix(id, "f1", {});

        expect(res.applied).toBe(false);
        expect(res.recorded).toBe(true);
        expect(res.error).toMatch(/not applied automatically/);

        const [row] = await db.select().from(errorDiagnoses).where(eq(errorDiagnoses.diagnosisId, id));
        expect(row.appliedFixId).toBe("f1");
    });

    it("returns manual instructions without changing anything", async () => {
        const id = await seed([{ id: "m1", description: "d", action: { type: "manual", instructions: "Raise the timeout" }, confidence: 0.5 }]);
        const res: any = await errorDiagnosisEngine.applyFix(id, "m1", {});
        expect(res.applied).toBe(false);
        expect(res.instructions).toBe("Raise the timeout");
    });

    it("reports a recommendation that does not exist", async () => {
        const id = await seed([{ id: "only", description: "d", action: { type: "manual", instructions: "x" }, confidence: 0.5 }]);
        const res: any = await errorDiagnosisEngine.applyFix(id, "missing", {});
        expect(res.applied).toBe(false);
        expect(res.error).toMatch(/no recommendation/);
    });

    it("reports an unknown diagnosis rather than pretending", async () => {
        const res: any = await errorDiagnosisEngine.applyFix(randomUUID(), "f1", {});
        expect(res.applied).toBe(false);
        expect(res.error).toMatch(/No diagnosis found/);
    });

    it("refuses add_retry when there is no step to configure", async () => {
        const id = await seed([{ id: "r1", description: "d", action: { type: "add_retry", maxRetries: 3, backoffMs: 1000 }, confidence: 0.9 }], null);
        const res: any = await errorDiagnosisEngine.applyFix(id, "r1", {});
        expect(res.applied).toBe(false);
        expect(res.error).toMatch(/not linked to a pipeline step/);
    });
});

describe("applyFix — add_retry, the one action it does run", () => {
    it("writes retry_config onto the pipeline step, clamped", async () => {
        const { pipelines, pipelineExecutions, pipelineStepExecutions, pipelineSteps } =
            await import("@shared/schema/index.js");

        const [pipeline] = await db.insert(pipelines).values({
            name: `applyfix-test-${Date.now()}`,
            triggerType: "manual",
            createdBy: "test",
        } as any).returning();
        const [step] = await db.insert(pipelineSteps).values({
            pipelineId: pipeline.id, order: 1,
        } as any).returning();
        const [exec] = await db.insert(pipelineExecutions).values({
            pipelineId: pipeline.id, status: "failure", createdBy: "test",
        } as any).returning();
        const [stepExec] = await db.insert(pipelineStepExecutions).values({
            pipelineExecutionId: exec.id, pipelineStepId: step.id, stepOrder: 1, status: "failure",
        } as any).returning();

        try {
            // maxRetries 99 and backoff 1ms are out of range on purpose: an unbounded
            // value from the knowledge base would turn one failing step into an
            // unbounded retry loop with exponential backoff behind it.
            const id = await seed(
                [{ id: "r1", description: "d", action: { type: "add_retry", maxRetries: 99, backoffMs: 1 }, confidence: 0.9 }],
                stepExec.id,
            );

            const res: any = await errorDiagnosisEngine.applyFix(id, "r1", {});
            expect(res.applied).toBe(true);
            expect(res.stepId).toBe(step.id);

            const [after] = await db.select().from(pipelineSteps).where(eq(pipelineSteps.id, step.id));
            const cfg = after.retryConfig as any;
            expect(cfg.maxRetries).toBe(10);      // clamped from 99
            expect(cfg.backoffMs).toBe(100);      // clamped from 1
            expect(cfg.backoffMultiplier).toBe(2);

            const [diag] = await db.select().from(errorDiagnoses).where(eq(errorDiagnoses.diagnosisId, id));
            expect(diag.fixSuccessful).toBe(true);
        } finally {
            await db.delete(pipelineStepExecutions).where(eq(pipelineStepExecutions.id, stepExec.id)).catch(() => {});
            await db.delete(pipelineExecutions).where(eq(pipelineExecutions.id, exec.id)).catch(() => {});
            await db.delete(pipelineSteps).where(eq(pipelineSteps.id, step.id)).catch(() => {});
            await db.delete(pipelines).where(eq(pipelines.id, pipeline.id)).catch(() => {});
        }
    });
});
