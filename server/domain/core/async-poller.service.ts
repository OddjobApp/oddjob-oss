// @ts-nocheck
import path from "path";
import { db } from "@server/database_service.js";
import { pipelineStepExecutions, pipelineExecutions, mediaTakes } from "@shared/schema/index.js";
import { eq, and, inArray } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AsyncPoller");

import { fileStorageSuccess } from "../knowledge/core/file-storage.js";
import type { AirflowMetadata, Credential, Job } from "@shared/schema/index.js";
import type { ResumeCondition } from "@shared/schema/missions.js";
import { asyncPollerUtils } from "./async-poller-utils.js";
import { assertOrgId, getSystemOrgContext } from "@server/utils/auth-context.js";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

// Poll every 10 seconds
const POLLING_INTERVAL = 10000;
const MISSION_FILE_POLL_INTERVAL = 15000;

const systemContext: OrgContext = {
    userId: "system",
    organizationId: null,
    isSuperAdmin: true,
    isAdmin: true,
    isOrgAdmin: false
};

export function startAsyncPoller() {
    logger.debug("[Async Poller] Starting service...");
    // Initial check
    pollAsyncSteps().catch(err => logger.error("[Async Poller] Initial poll failed:", err));
    // Scheduled check
    setInterval(pollAsyncSteps, POLLING_INTERVAL);
    // Mission file wake-up (folder_import)
    pollMissionFileWakeUp().catch(err => logger.error("[Async Poller] Mission file poll failed:", err));
    setInterval(pollMissionFileWakeUp, MISSION_FILE_POLL_INTERVAL);
}

export async function pollMissionFileWakeUp() {
    try {
        const { missionRunService } = await import("../mission/core/mission-run.service.js");
        const waiting = await missionRunService.listWaitingOnFile();
        for (const mission of waiting) {
            const rc = mission.resumeCondition as ResumeCondition | null;
            if (!rc || rc.type !== "file" || !rc.folderPath || !rc.filePattern) continue;
            const orgId = assertOrgId(mission.organizationId);
            try {
                const files = await fileStorageSuccess.listFiles(orgId, rc.folderPath, rc.filePattern, false);
                if (files.length > 0) {
                    const first = files[0];
                    const matchedPath = path.join(rc.folderPath, first.path);
                    logger.debug(`[Async Poller] Mission Run ${mission.id} file wake-up: ${first.name}`);
                    await missionRunService.resumeMissionRun(mission.id, matchedPath);
                }
            } catch (e) {
                logger.warn(`[Async Poller] Mission ${mission.id} file check failed:`, e);
            }
        }
    } catch (error) {
        logger.error("[Async Poller] Mission file wake-up error:", error);
    }
}

export async function pollAsyncSteps() {
    try {
        // Find all step executions in 'waiting_async' state
        const asyncSteps = await db
            .select()
            .from(pipelineStepExecutions)
            .where(eq(pipelineStepExecutions.status, "waiting_async"));

        if (asyncSteps.length === 0) return;

        for (const stepExec of asyncSteps) {
            // Durable Execution: Sleep Check
            if (stepExec.sleepUntil) {
                if (new Date() < new Date(stepExec.sleepUntil)) {
                    // Still sleeping
                    continue;
                }
                // Wake up!
                logger.debug(`[Async Poller] Waking up step ${stepExec.id} (Sleep until: ${stepExec.sleepUntil})`);
            }

            if (await asyncPollerUtils.isProcessing(stepExec.id)) {
                logger.debug(`[Async Poller] Step ${stepExec.id} is already being processed by a hook. Skipping.`);
                continue;
            }

            try {
                const acquired = await asyncPollerUtils.lock(stepExec.id);
                if (!acquired) {
                    logger.debug(`[Async Poller] Could not acquire lock for step ${stepExec.id}. Skipping.`);
                    continue;
                }
                await checkStepStatus(stepExec);
            } catch (error: any) {
                logger.error(`[Async Poller] Error checking step ${stepExec.id}:`, error);
                if (error.message.includes("column") && error.message.includes("does not exist")) {
                   logger.error(`[Async Poller] SCHEMA DRIFT DETECTED: ${error.message}. Please run migrations.`);
                }
            } finally {
                asyncPollerUtils.unlock(stepExec.id);
            }
        }
    } catch (error: any) {
        logger.error("[Async Poller] Error during polling cycle:", error);
        if (error.message.includes("column") && error.message.includes("does not exist")) {
            logger.error(`[Async Poller] CRITICAL SCHEMA DRIFT: ${error.message}`);
        }
    }
}

export async function checkStepStatus(stepExec: typeof pipelineStepExecutions.$inferSelect) {
    // Durable Execution: Resume Generic Sleep Steps
    if (stepExec.sleepUntil && new Date() >= new Date(stepExec.sleepUntil)) {
        const { pipelineService } = await import("../pipeline/core/pipeline.service.js");
        const { pipelineExecutor } = await import("../../core/pipeline-executor.js");
        await pipelineService.updateStepExecution(stepExec.id, {
            status: "success",
            completedAt: new Date(),
            output: JSON.stringify({ slept_until: stepExec.sleepUntil })
        });
        await pipelineExecutor.resumePipelineExecution(stepExec.pipelineExecutionId);
        return;
    }

    if (!stepExec.jobId) {
        logger.warn(`[Async Poller] Step execution ${stepExec.id} missing jobId. Skipping.`);
        return;
    }

    const { jobService } = await import("../jobs/job.service.js");
    const job = await jobService.getById(stepExec.jobId, systemContext).catch(() => null);
    if (!job) {
        logger.warn(`[Async Poller] Job ${stepExec.jobId} not found for step ${stepExec.id}`);
        return;
    }

    if (job.type === "airflow_dag_run") {
        await handleAirflowStep(stepExec, job);
    } else if (job.type === "supervisor") {
        await handleSupervisorStep(stepExec, job);
    } else if (job.type === "media_take") {
        await handleMediaTakeStep(stepExec, job);
    } else {
        logger.warn(`[Async Poller] Job type ${job.type} not supported for async polling yet.`);
    }
}

/**
 * Handle Airflow Async Steps
 */
export async function handleAirflowStep(stepExec: any, job: Job) {
    if (!stepExec.traceId) {
        await handleStepFailure(stepExec, "Missing traceId (DAG Run ID)");
        return;
    }

    const { credentialsService } = await import("../auth/core/credentials-service.js");
    const credential = await credentialsService.getForExecution((job as any).credentialId, job.organizationId).catch(() => null);
    if (!credential) {
        await handleStepFailure(stepExec, "Credential not found");
        return;
    }

    const runStatus = await fetchAirflowRunStatus(job, credential, stepExec.traceId);

    if (runStatus.state === "success") {
        logger.debug(`[Async Poller] Airflow Step ${stepExec.id} completed.`);
        const { pipelineService } = await import("../pipeline/core/pipeline.service.js");
        const { pipelineExecutor } = await import("../../core/pipeline-executor.js");
        await pipelineService.updateStepExecution(stepExec.id, {
            status: "success",
            completedAt: new Date(),
            output: JSON.stringify({
                status: "success",
                dag_run_id: stepExec.traceId,
                metadata: runStatus.details
            })
        });
        await pipelineExecutor.resumePipelineExecution(stepExec.pipelineExecutionId);
    } else if (runStatus.state === "failed") {
        await handleStepFailure(stepExec, `Airflow DAG run failed: ${runStatus.state}`);
    }
}

/**
 * Handle Supervisor Async Steps
 */
export async function handleSupervisorStep(stepExec: any, job: Job) {
    // For supervisor, the 'output' field contains the current plan state
    if (!stepExec.output) {
        await handleStepFailure(stepExec, "Supervisor step missing plan in output");
        return;
    }

    let plan;
    try {
        plan = JSON.parse(stepExec.output);
    } catch (e) {
        await handleStepFailure(stepExec, "Invalid plan JSON in supervisor step output");
        return;
    }

    const pipelineExecutionId = stepExec.pipelineExecutionId;
    const [pipelineExec] = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, pipelineExecutionId)).limit(1);

    if (!pipelineExec) {
        logger.error(`[Async Poller] Pipeline execution ${pipelineExecutionId} not found`);
        return;
    }

    // Call executePlan to update statuses and potentially start new tasks
    const userId = "system-poller";
    const { supervisorService } = await import("../integrations/core/supervisor.service.js");
    const result = await supervisorService.executePlan(
        plan,
        pipelineExecutionId,
        userId,
        job.organizationId || undefined
    );

    // Update the output with the latest plan state regardless of overall state
    const { pipelineService } = await import("../pipeline/core/pipeline.service.js");
    await pipelineService.updateStepExecution(stepExec.id, {
        output: JSON.stringify(result.plan)
    });

    if (result.state === "completed") {
        logger.debug(`[Async Poller] Supervisor Step ${stepExec.id} completed.`);
        const { pipelineExecutor } = await import("../../core/pipeline-executor.js");
        await pipelineService.updateStepExecution(stepExec.id, {
            status: "success",
            completedAt: new Date()
        });
        await pipelineExecutor.resumePipelineExecution(pipelineExecutionId);
    } else if (result.state === "failed") {
        const errorTask = result.plan.tasks.find((t: any) => t.status === "failed");
        await handleStepFailure(stepExec, `Supervisor plan failed at task '${errorTask?.name}'`);
    } else {
        // still waiting or delegating, do nothing (output updated above)
    }
}

/**
 * Handle Media Studio take steps
 *
 * The media_take executor stores `{ _type: "media_takes", productionId,
 * takeIds, waitFor, requestedAt }` in the step output and suspends with
 * waitReason "media_render". Each poll refreshes every take with its provider,
 * then evaluates the waitFor threshold: ready_for_review resolves as soon as
 * every take can be reviewed; approved waits for human sign-off. Simulated
 * takes count as reached under either threshold — they never render.
 */
const MEDIA_TAKE_TIMEOUT_MS = 72 * 60 * 60 * 1000;
const MEDIA_TAKE_REACHED: Record<string, Set<string>> = {
    ready_for_review: new Set(["ready_for_review", "approved", "simulated"]),
    approved: new Set(["approved", "simulated"]),
};

export async function handleMediaTakeStep(stepExec: any, job: Job) {
    if (!stepExec.output) {
        await handleStepFailure(stepExec, "media_take step missing take state in output");
        return;
    }

    let state: any;
    try {
        state = JSON.parse(stepExec.output);
    } catch {
        await handleStepFailure(stepExec, "Invalid media_takes JSON in step output");
        return;
    }

    const takeIds: number[] = Array.isArray(state.takeIds) ? state.takeIds : [];
    if (takeIds.length === 0) {
        await handleStepFailure(stepExec, "media_take step recorded no take ids");
        return;
    }

    const [pipelineExec] = await db.select().from(pipelineExecutions)
        .where(eq(pipelineExecutions.id, stepExec.pipelineExecutionId)).limit(1);
    const orgId = pipelineExec?.organizationId ?? job.organizationId ?? null;
    const ctx = { ...getSystemOrgContext(orgId), userId: "system-poller" };

    // Refresh each take against its provider; a per-take refresh error is
    // recorded but does not fail the step — the stored row still has a status.
    const refreshErrors: string[] = [];
    const { mediaStudio } = await import("../media-studio/core/media-studio.service.js");
    for (const takeId of takeIds) {
        try {
            await mediaStudio.refreshTakeStatus(ctx, takeId);
        } catch (e: any) {
            refreshErrors.push(`take ${takeId}: ${e?.message ?? e}`);
            logger.warn(`[Async Poller] Refreshing take ${takeId} failed:`, e);
        }
    }

    const conditions = [inArray(mediaTakes.id, takeIds)];
    if (orgId != null) conditions.push(eq(mediaTakes.organizationId, orgId));
    const rows = await db.select().from(mediaTakes).where(and(...conditions));
    const byId = new Map(rows.map((r: any) => [r.id, r]));

    const missing = takeIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
        await handleStepFailure(stepExec, `Take ${missing[0]} no longer exists`);
        return;
    }

    const dead = takeIds.map((id) => byId.get(id)).find((t: any) => t.status === "failed" || t.status === "rejected");
    if (dead) {
        await handleStepFailure(stepExec, `Take ${dead.id} ${dead.status}: ${dead.error || dead.notes || "no details"}`);
        return;
    }

    const requestedAt = state.requestedAt ? new Date(state.requestedAt).getTime() : NaN;
    if (!Number.isNaN(requestedAt) && Date.now() - requestedAt > MEDIA_TAKE_TIMEOUT_MS) {
        await handleStepFailure(stepExec, "media takes did not complete within 72h");
        return;
    }

    const waitFor = state.waitFor === "ready_for_review" ? "ready_for_review" : "approved";
    const reached = MEDIA_TAKE_REACHED[waitFor];
    if (takeIds.every((id) => reached.has(byId.get(id).status))) {
        logger.debug(`[Async Poller] Media take step ${stepExec.id} completed (${waitFor}).`);
        const takes = takeIds.map((id) => {
            const t: any = byId.get(id);
            return {
                takeId: t.id,
                shotId: t.shotId,
                status: t.status,
                videoAssetId: t.videoAssetId ?? null,
                costCents: t.costCents ?? 0,
            };
        });
        const { pipelineService } = await import("../pipeline/core/pipeline.service.js");
        const { pipelineExecutor } = await import("../../core/pipeline-executor.js");
        await pipelineService.updateStepExecution(stepExec.id, {
            status: "success",
            completedAt: new Date(),
            output: JSON.stringify({
                _type: "media_takes_result",
                productionId: state.productionId,
                takes,
                totalCostCents: takes.reduce((sum: number, t: any) => sum + t.costCents, 0),
            })
        });
        await pipelineExecutor.resumePipelineExecution(stepExec.pipelineExecutionId);
        return;
    }

    // Still queued/rendering/waiting on approval: record the latest statuses so
    // the run view shows progress, then leave the step waiting.
    const { pipelineService } = await import("../pipeline/core/pipeline.service.js");
    await pipelineService.updateStepExecution(stepExec.id, {
        output: JSON.stringify({
            ...state,
            takes: takeIds.map((id) => ({ takeId: id, status: byId.get(id).status })),
            ...(refreshErrors.length ? { refreshErrors } : {}),
        })
    });
}

export async function handleStepFailure(stepExec: any, errorMsg: string) {
    const { pipelineService } = await import("../pipeline/core/pipeline.service.js");
    const { pipelineExecutor } = await import("../../core/pipeline-executor.js");
    await pipelineService.updateStepExecution(stepExec.id, {
        status: "failed",
        completedAt: new Date(),
        error: errorMsg
    } as any);

    const step = await pipelineService.getStepById(stepExec.pipelineStepId).catch(() => null);
    const action = step?.onFailureAction || "Stop Pipeline";

    if (action === "continue") { // Note: 'Continue to Next' in UI might map to 'continue' in schema
        await pipelineExecutor.resumePipelineExecution(stepExec.pipelineExecutionId);
    } else {
        await pipelineService.updateExecution(stepExec.pipelineExecutionId, {
            status: "failed",
            completedAt: new Date(),
            error: `Step ${stepExec.stepOrder} failed: ${errorMsg}`
        });
    }
}

/**
 * Helper: Ported from airflow-poller.ts
 */
async function fetchAirflowRunStatus(job: Job, credential: Credential, dagRunId: string): Promise<{ state: string, details?: any }> {
    const metadata = credential.metadata as AirflowMetadata;
    const dagId = (job.config as any).dagId;
    const baseUrl = metadata.baseUrl.replace(/\/$/, "");
    const url = `${baseUrl}/api/v1/dags/${dagId}/dagRuns/${dagRunId}`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (metadata.authType === "basic" && metadata.username) {
        const auth = Buffer.from(`${metadata.username}:${(await resolveCredentialSecret(credential))}`).toString("base64");
        headers["Authorization"] = `Basic ${auth}`;
    } else if (metadata.authType === "bearer") {
        headers["Authorization"] = `Bearer ${(await resolveCredentialSecret(credential))}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`Airflow API error: ${response.status}`);
    const data = await response.json();
    return { state: data.state, details: data };
}




