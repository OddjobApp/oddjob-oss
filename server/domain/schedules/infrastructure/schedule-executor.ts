import { db } from "@server/database_service.js";
import { scheduledJobs, jobs, alerts, scheduleExecutionHistory } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { assertOrgId } from "@server/utils/auth-context.js";

const logger = createLogger("ScheduleExecutor");

export const scheduleExecutor = {
    /**
     * Executes a scheduled item (Mission, Pipeline, or Job).
     */
    async executeScheduledItem(
        scheduledJob: typeof scheduledJobs.$inferSelect,
        trigger: { id: number; nextFireAt: Date },
        retryCount: number = 0
    ) {
        const startTime = Date.now();
        const scheduledFor = trigger.nextFireAt;
        const executionType = scheduledJob.missionId ? "mission" : (scheduledJob.pipelineId ? "pipeline" : "job");

        const [historyRecord] = await db.insert(scheduleExecutionHistory).values({
            scheduledJobId: scheduledJob.id,
            triggerId: trigger.id > 0 ? trigger.id : null,
            status: "running",
            scheduledFor,
            executionType,
            retryCount,
            organizationId: scheduledJob.organizationId,
        }).returning();

        try {
            let result: any;

            if (scheduledJob.missionId) {
                result = await this.executeMission(scheduledJob, historyRecord.id);
            } else if (scheduledJob.pipelineId) {
                result = await this.executePipeline(scheduledJob, historyRecord.id);
            } else if (scheduledJob.jobId) {
                result = await this.executeJob(scheduledJob, historyRecord.id);
            } else {
                throw new Error("Neither jobId, pipelineId, nor missionId is set on the scheduled job");
            }

            const durationMs = Date.now() - startTime;
            await db.update(scheduleExecutionHistory)
                .set({
                    status: "completed",
                    completedAt: new Date(),
                    durationMs,
                    result: result ? { summary: typeof result === 'string' ? result : JSON.stringify(result).slice(0, 1000) } : null,
                })
                .where(eq(scheduleExecutionHistory.id, historyRecord.id));

            if (scheduledJob.alertOnSuccess) {
                await db.insert(alerts).values({
                    severity: 'info',
                    category: 'job_success',
                    message: `Scheduled ${executionType} "${scheduledJob.name}" executed successfully.`,
                    scheduledJobId: scheduledJob.id,
                    organizationId: scheduledJob.organizationId,
                });
            }

            logger.info(`[ScheduleExecutor] ${executionType} "${scheduledJob.name}" completed in ${durationMs}ms`);

        } catch (err: any) {
            const durationMs = Date.now() - startTime;
            const errorMessage = err.message || String(err);
            const maxRetries = scheduledJob.maxRetries || 0;
            const shouldRetry = retryCount < maxRetries;

            await db.update(scheduleExecutionHistory)
                .set({
                    status: shouldRetry ? "retrying" : "failed",
                    completedAt: new Date(),
                    durationMs,
                    error: errorMessage,
                    errorDetails: {
                        stack: err.stack,
                        retryCount,
                        willRetry: shouldRetry,
                    },
                })
                .where(eq(scheduleExecutionHistory.id, historyRecord.id));

            logger.error(`[ScheduleExecutor] ${executionType} "${scheduledJob.name}" failed (retry ${retryCount}/${maxRetries}):`, errorMessage);

            if (shouldRetry) {
                const retryDelayMs = (scheduledJob.retryDelaySeconds || 60) * 1000;
                logger.info(`[ScheduleExecutor] Scheduling retry in ${retryDelayMs}ms...`);

                setTimeout(async () => {
                    await this.executeScheduledItem(scheduledJob, trigger, retryCount + 1);
                }, retryDelayMs);
            } else {
                if (scheduledJob.alertOnFailure) {
                    try {
                        await db.insert(alerts).values({
                            severity: 'critical',
                            category: 'job_failure',
                            message: `Scheduled ${executionType} "${scheduledJob.name}" failed after ${retryCount + 1} attempt(s): ${errorMessage}`,
                            details: { error: String(err), retryCount },
                            scheduledJobId: scheduledJob.id,
                            organizationId: scheduledJob.organizationId,
                        });
                    } catch (alertErr) {
                        console.error("[ScheduleExecutor] Failed to create alert:", alertErr);
                    }
                }
            }
        }
    },

    async executeJob(
        scheduledJob: typeof scheduledJobs.$inferSelect,
        historyId: number
    ): Promise<any> {
        if (!scheduledJob.jobId) throw new Error("No jobId configured");

        const [job] = await db.select().from(jobs).where(eq(jobs.id, scheduledJob.jobId));
        if (!job) throw new Error(`Job ${scheduledJob.jobId} not found`);

        logger.info(`[ScheduleExecutor] Executing Job ${job.id}: ${job.name} (${job.type})`);

        if (job.type === 'api' || job.type === 'curl') {
            return await this.executeHttpJob(job);
        } else if (job.type === 'shell') {
            return await this.executeShellJob(job);
        } else {
            logger.warn(`[ScheduleExecutor] Job type ${job.type} - attempting via pipeline executor...`);
            return await this.executeJobViaPipelineExecutor(job);
        }
    },

    async executeHttpJob(job: typeof jobs.$inferSelect): Promise<any> {
        const config = job.config as any;
        const response = await fetch(config.url, {
            method: config.method || 'GET',
            headers: { 'Content-Type': 'application/json', ...(config.headers || {}) },
            body: config.body ? (typeof config.body === 'string' ? config.body : JSON.stringify(config.body)) : undefined
        });

        if (!response.ok) throw new Error(`HTTP Status ${response.status} ${response.statusText}`);
        const text = await response.text();
        return { status: response.status, body: text.slice(0, 500) };
    },

    async executeShellJob(job: typeof jobs.$inferSelect): Promise<any> {
        const config = job.config as any;
        const { spawn } = await import('child_process');

        return new Promise((resolve, reject) => {
            const child = spawn(config.executable || '', (config.parameters || '').split(' '), { cwd: config.workingDirectory || process.cwd(), shell: true });
            let stdout = '', stderr = '';
            child.stdout?.on('data', (data) => { stdout += data.toString(); });
            child.stderr?.on('data', (data) => { stderr += data.toString(); });
            child.on('close', (code) => {
                if (code === 0) resolve({ exitCode: code, stdout: stdout.slice(0, 1000), stderr: stderr.slice(0, 500) });
                else reject(new Error(`Shell command failed with exit code ${code}: ${stderr || stdout}`));
            });
            child.on('error', (err) => reject(err));
        });
    },

    async executeJobViaPipelineExecutor(job: typeof jobs.$inferSelect): Promise<any> {
        const { pipelineExecutor } = await import("@server/core/pipeline-executor.js");
        logger.warn(`[ScheduleExecutor] Job type ${job.type} requires pipeline wrapper`);
        return { warning: `Job type ${job.type} not fully supported for direct scheduling.` };
    },

    async executePipeline(
        scheduledJob: typeof scheduledJobs.$inferSelect,
        historyId: number
    ): Promise<any> {
        if (!scheduledJob.pipelineId) throw new Error("No pipelineId configured");
        const { pipelineExecutor } = await import("@server/core/pipeline-executor.js");
        const userId = scheduledJob.createdByUserId || scheduledJob.createdBy || "system";
        const result = await pipelineExecutor.executePipeline(scheduledJob.pipelineId, userId, null);

        if (result && result.executionId) {
            await db.update(scheduleExecutionHistory)
                .set({ pipelineRunId: result.executionId })
                .where(eq(scheduleExecutionHistory.id, historyId));
        }

        return { pipelineId: scheduledJob.pipelineId, executionId: result?.executionId, success: result?.success };
    },

    async executeMission(
        scheduledJob: typeof scheduledJobs.$inferSelect,
        historyId: number
    ): Promise<any> {
        if (!scheduledJob.missionId) throw new Error("No missionId configured");

        const { missionService } = await import("@domain/mission/core/mission.service.js"); // Updated path
        const userId = scheduledJob.createdByUserId || scheduledJob.createdBy || "system";
        const orgId = assertOrgId(scheduledJob.organizationId);

        logger.info(`[ScheduleExecutor] Launching Mission ${scheduledJob.missionId} for Scheduled Job ${scheduledJob.id}`);

        const result = await missionService.launchMission(scheduledJob.missionId, userId, orgId);

        if (!result.success) {
            throw new Error(`Mission launch failed: ${result.error}`);
        }

        return {
            missionId: scheduledJob.missionId,
            executionId: result.executionId,
            missionRunId: (result as any).missionRunId,
            success: true
        };
    }
};
