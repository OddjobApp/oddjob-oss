/**
 * Error Diagnosis Engine
 *
 * Classifies a failure against the shared error knowledge base and records the
 * result so it can be reviewed and fed back on.
 *
 * This was previously a stub that logged "ErrorDiagnosisEngine is MOCKED" and
 * returned `{ bestMatch: null, isDiagnosed: false }` unconditionally. That was not
 * merely a missing feature — retry-service.ts reads the category off bestMatch:
 *
 *     const errorCategory = diagnosis.bestMatch?.pattern.category;
 *     if (!errorCategory) return { shouldRetry: false, reason: 'Error category not recognized' };
 *
 * so a null bestMatch meant AUTOMATIC RETRIES WERE DISABLED EVERYWHERE. Every
 * retryable failure — rate limits, 5xx, network blips, timeouts — was reported as
 * unrecognised and never retried.
 *
 * The matching itself already existed in shared/utils/errorKnowledgeBase.ts
 * (BUILTIN_ERROR_PATTERNS plus matchPatterns/getBestMatch); nothing called it.
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { errorDiagnoses, pipelineSteps, pipelineStepExecutions } from "@shared/schema/index.js";
import {
    getBestMatch,
    matchPatterns,
    type ErrorFix,
    type MatchedPattern,
} from "@shared/utils/errorKnowledgeBase.js";
import { createLogger } from "../../../utils/logger.js";

const logger = createLogger("ErrorDiagnosisEngine");

export interface DiagnoseParams {
    /** Callers pass either a message or the Error itself. */
    error: string | Error | null;
    httpStatus?: number;
    /** Named requestUrl by every existing caller. */
    requestUrl?: string;
    jobType?: string;
    errorCode?: string;
    jobId?: number;
    jobConfig?: unknown;
    stepOutput?: unknown;
    stepExecutionId?: number;
    pipelineExecutionId?: number;
    organizationId?: number | null;
}

export interface DiagnoseOptions {
    /** Reserved for LLM-assisted diagnosis; see aiDiagnosis below. */
    includeAI?: boolean;
    /** Skip the error_diagnoses insert (used by callers on hot paths). */
    persist?: boolean;
}

export interface DiagnosisResult {
    diagnosisId: string | null;
    bestMatch: MatchedPattern | null;
    matchedPatterns: MatchedPattern[];
    recommendations: ErrorFix[];
    aiDiagnosis: null;
    isDiagnosed: boolean;
}

export const errorDiagnosisEngine = {
    async diagnose(params: DiagnoseParams, options: DiagnoseOptions = {}): Promise<DiagnosisResult> {
        const { error, httpStatus, requestUrl, jobType } = params ?? ({} as DiagnoseParams);

        // Callers hand us Error objects as well as strings; the matcher wants text.
        const errorText = error instanceof Error ? (error.message || String(error)) : (error ?? null);

        const matchedPatterns = matchPatterns(errorText, httpStatus, requestUrl, jobType);
        const bestMatch = getBestMatch(errorText, httpStatus, requestUrl, jobType);

        // Fixes are ordered by confidence so the caller can take the head of the list.
        const recommendations = bestMatch
            ? [...bestMatch.pattern.fixes].sort((a, b) => b.confidence - a.confidence)
            : [];

        const result: DiagnosisResult = {
            diagnosisId: null,
            bestMatch,
            matchedPatterns,
            recommendations,
            // Deliberately null: no LLM call is made here. The `includeAI` option is
            // accepted because callers already pass it, but claiming an AI diagnosis
            // that was never produced would be worse than reporting none.
            aiDiagnosis: null,
            isDiagnosed: Boolean(bestMatch),
        };

        if (options.persist === false) return result;

        // Recording must never take down the path that failed.
        try {
            const diagnosisId = randomUUID();
            await db.insert(errorDiagnoses).values({
                diagnosisId,
                pipelineExecutionId: params.pipelineExecutionId ?? null,
                stepExecutionId: params.stepExecutionId ?? null,
                errorMessage: errorText,
                errorCode: params.errorCode ?? null,
                httpStatus: httpStatus ?? null,
                jobType: jobType ?? null,
                matchedPatternId: bestMatch?.pattern.id ?? null,
                // Column is an integer; the matcher scores 0-1.
                matchedPatternScore: bestMatch ? Math.round(bestMatch.score * 100) : null,
                aiDiagnosis: null,
                recommendations,
                organizationId: params.organizationId ?? null,
            });
            result.diagnosisId = diagnosisId;
        } catch (err: any) {
            logger.warn(`[ErrorDiagnosis] Could not record diagnosis: ${err?.message ?? err}`);
        }

        logger.debug(
            bestMatch
                ? `[ErrorDiagnosis] Matched "${bestMatch.pattern.id}" (${bestMatch.pattern.category}) at ${bestMatch.score.toFixed(2)}`
                : `[ErrorDiagnosis] No pattern matched${errorText ? `: ${errorText.slice(0, 120)}` : ""}`,
        );

        return result;
    },

    async recordFeedback(
        diagnosisId: string,
        feedback: { helpful?: boolean; appliedFixId?: string; fixSuccessful?: boolean; comment?: string; rating?: string } = {},
    ) {
        if (!diagnosisId) {
            logger.warn("[ErrorDiagnosis] recordFeedback called without a diagnosisId; ignoring.");
            return;
        }

        const rating = feedback.rating ?? (feedback.helpful === undefined ? undefined : feedback.helpful ? "helpful" : "not_helpful");

        const patch: Record<string, unknown> = {};
        if (rating !== undefined) patch.userFeedback = String(rating).slice(0, 50);
        if (feedback.appliedFixId !== undefined) patch.appliedFixId = feedback.appliedFixId;
        if (feedback.fixSuccessful !== undefined) patch.fixSuccessful = feedback.fixSuccessful;

        if (Object.keys(patch).length === 0) return;

        await db.update(errorDiagnoses).set(patch).where(eq(errorDiagnoses.diagnosisId, diagnosisId));
    },

    /**
     * Applies a recommended fix, for the narrow set of fixes that are safe to run
     * unattended.
     *
     * FixAction has seven shapes and they are NOT equally safe. update_url,
     * add_header, switch_credential, change_method and update_config all mutate how a
     * job talks to the outside world, from a pattern-matched suggestion, with no review
     * step — an automated change that redirects traffic or swaps a credential is not
     * something a diagnosis should be able to make on its own. Those are recorded for a
     * human and explicitly refused.
     *
     * add_retry is different. It writes pipeline_steps.retry_config, which
     * pipeline-step-runner.ts already reads to decide allowedAttempts and backoff. It
     * changes how many times a step is attempted and nothing else, it is trivially
     * reversible, and 0 of 1058 steps currently set it — so nothing retries at all
     * today. That is a real fix worth applying.
     *
     * manual carries instructions rather than an action, so it is returned as guidance.
     */
    async applyFix(diagnosisId: string, recommendationId: string, _context: unknown) {
        const [row] = await db
            .select()
            .from(errorDiagnoses)
            .where(eq(errorDiagnoses.diagnosisId, diagnosisId))
            .limit(1);

        if (!row) {
            return { success: false, applied: false, error: `No diagnosis found for id ${diagnosisId}` };
        }

        const recommendations = (row.recommendations ?? []) as ErrorFix[];
        const fix = recommendations.find((r) => r?.id === recommendationId);

        // The selection is recorded either way, so the choice stays auditable even when
        // the action is refused.
        await db
            .update(errorDiagnoses)
            .set({ appliedFixId: recommendationId })
            .where(eq(errorDiagnoses.diagnosisId, diagnosisId));

        if (!fix) {
            return {
                success: false,
                applied: false,
                recorded: true,
                error: `Diagnosis ${diagnosisId} has no recommendation "${recommendationId}".`,
            };
        }

        const action: any = fix.action;

        if (action?.type === "manual") {
            return {
                success: true,
                applied: false,
                recorded: true,
                instructions: action.instructions,
                message: "This fix is manual; nothing was changed.",
            };
        }

        if (action?.type === "add_retry") {
            if (!row.stepExecutionId) {
                return {
                    success: false,
                    applied: false,
                    recorded: true,
                    error: "This diagnosis is not linked to a pipeline step, so there is no step to configure retries on.",
                };
            }

            const [stepExec] = await db
                .select({ pipelineStepId: pipelineStepExecutions.pipelineStepId })
                .from(pipelineStepExecutions)
                .where(eq(pipelineStepExecutions.id, row.stepExecutionId))
                .limit(1);

            if (!stepExec?.pipelineStepId) {
                return {
                    success: false,
                    applied: false,
                    recorded: true,
                    error: `Step execution ${row.stepExecutionId} no longer resolves to a pipeline step.`,
                };
            }

            // Clamped. maxRetries comes from the knowledge base, and an unbounded value
            // would turn one failing step into an unbounded retry loop with exponential
            // backoff behind it.
            const maxRetries = Math.min(Math.max(Number(action.maxRetries) || 3, 1), 10);
            const backoffMs = Math.min(Math.max(Number(action.backoffMs) || 5000, 100), 300000);

            await db
                .update(pipelineSteps)
                .set({ retryConfig: { maxRetries, backoffMs, backoffMultiplier: 2 } as any })
                .where(eq(pipelineSteps.id, stepExec.pipelineStepId));

            await db
                .update(errorDiagnoses)
                .set({ fixSuccessful: true })
                .where(eq(errorDiagnoses.diagnosisId, diagnosisId));

            logger.info(
                `[ErrorDiagnosis] Applied add_retry to pipeline step ${stepExec.pipelineStepId} (maxRetries=${maxRetries}, backoffMs=${backoffMs})`,
            );

            return {
                success: true,
                applied: true,
                recorded: true,
                stepId: stepExec.pipelineStepId,
                applieds: { maxRetries, backoffMs },
                message: `Retries enabled on pipeline step ${stepExec.pipelineStepId}: up to ${maxRetries} attempts, ${backoffMs}ms backoff.`,
            };
        }

        return {
            success: false,
            applied: false,
            recorded: true,
            error:
                `"${action?.type ?? "unknown"}" fixes are not applied automatically. ` +
                `They change how a job authenticates or where it sends traffic, which needs a human to approve. ` +
                `The selection has been recorded for manual action.`,
        };
    },
};
