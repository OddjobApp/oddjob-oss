
import { Worker, Job, type WorkerOptions } from "bullmq";
import { createLogger } from "@server/utils/logger.js";
import { getRedisOptions } from "@domain/core/infrastructure/redis/redis-client.js";
import { getTracer, SpanStatusCode, extractContext } from "@server/utils/tracing.js";
import { withAiOrganization } from "@domain/ai/core/ai-org-context.js";

/**
 * Base Worker Class
 * Standardizes logging, tracing, and lifecycle management for BullMQ workers.
 */
export abstract class BaseWorker<TData = any, TResult = any> {
    protected readonly worker: Worker<TData, TResult>;
    protected readonly logger: any;
    protected readonly name: string;
    readonly workerId: string;

    private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    private jobsProcessed = 0;
    private jobsFailed = 0;
    private activeJobCount = 0;
    private readonly queueName: string;

    constructor(queueName: string, options: Partial<WorkerOptions> = {}) {
        this.name = this.constructor.name;
        this.logger = createLogger(this.name);
        this.queueName = queueName;
        this.workerId = `${this.name}-${process.pid}`;

        const connectionOpts = {
            ...getRedisOptions(),
            maxRetriesPerRequest: null,
        };

        this.worker = new Worker<TData, TResult>(
            queueName,
            async (job: Job<TData>) => this.handleJobWithTracing(job),
            {
                connection: connectionOpts,
                concurrency: 1, // Default to sequential
                ...options
            }
        );

        this.setupListeners();
        this.startHeartbeat();
    }

    /**
     * Main execution logic for the worker
     */
    protected abstract execute(job: Job<TData>): Promise<TResult>;

    /**
     * Wrap execution with OpenTelemetry tracing and standard logging
     */
    private async handleJobWithTracing(job: Job<TData>): Promise<TResult> {
        this.logger.info(`Processing Job ${job.id}`);
        this.activeJobCount++;

        const parentContext = extractContext(job.data);
        const tracer = getTracer(this.name.toLowerCase());

        return tracer.startActiveSpan(`worker.${this.name.toLowerCase()}_execute`, {
            attributes: {
                "job.id": job.id || "unknown",
                "queue.name": job.queueName
            }
        }, parentContext, async (span) => {
            try {
                const result = await withAiOrganization(
                    async () => (job.data as any)?.organizationId ?? (job.data as any)?.orgId ?? null,
                    () => this.execute(job),
                );
                span.setStatus({ code: SpanStatusCode.OK });
                this.jobsProcessed++;
                return result;
            } catch (error: any) {
                this.logger.error(`Job ${job.id} failed: ${error.message}`);
                span.recordException(error);
                span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
                this.jobsFailed++;
                await this.writeDlqRecord(job, error);
                throw error;
            } finally {
                this.activeJobCount--;
                span.end();
            }
        });
    }

    private startHeartbeat(): void {
        this.heartbeatInterval = setInterval(async () => {
            try {
                const { db } = await import("../database_service.js");
                const { workerHeartbeats } = await import("@shared/schema/infrastructure/worker-spine.js");
                await db
                    .insert(workerHeartbeats)
                    .values({
                        workerId: this.workerId,
                        workerType: this.name,
                        queueName: this.queueName,
                        jobsProcessed: this.jobsProcessed,
                        jobsFailed: this.jobsFailed,
                        status: "active",
                        metadata: { activeJobs: this.activeJobCount },
                    })
                    .onConflictDoUpdate({
                        target: workerHeartbeats.workerId,
                        set: {
                            lastSeen: new Date(),
                            jobsProcessed: this.jobsProcessed,
                            jobsFailed: this.jobsFailed,
                            status: "active",
                            metadata: { activeJobs: this.activeJobCount },
                        },
                    });
            } catch (err: any) {
                this.logger.warn(`Heartbeat upsert failed: ${err.message}`);
            }
        }, 30_000);
    }

    stopHeartbeat(): void {
        if (this.heartbeatInterval !== null) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    private async writeDlqRecord(job: Job<TData>, error: Error): Promise<void> {
        try {
            const { db } = await import("../database_service.js");
            const { deadLetterJobs } = await import("@shared/schema/infrastructure/worker-spine.js");
            await db.insert(deadLetterJobs).values({
                queueName: job.queueName,
                jobName: job.name,
                jobData: job.data as any,
                error: error.message,
                attempts: job.attemptsMade ?? 0,
                organizationId: (job.data as any)?.organizationId ?? null,
            });
        } catch (dlqErr: any) {
            this.logger.warn(`Failed to write DLQ record for job ${job.id}: ${dlqErr.message}`);
        }
    }

    protected setupListeners() {
        this.worker.on("completed", (job) => {
            this.logger.debug(`Job ${job.id} completed`);
        });

        this.worker.on("failed", (job, err) => {
            this.logger.error(`Job ${job?.id} failed: ${err.message}`);
        });

        this.worker.on("error", (err) => {
            this.logger.error(`Worker error: ${err.message}`);
        });
    }

    async close() {
        this.stopHeartbeat();
        await this.worker.close();
        this.logger.info("Worker closed");
    }
}
