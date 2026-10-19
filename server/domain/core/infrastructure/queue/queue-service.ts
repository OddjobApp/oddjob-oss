import { resolveAiOrganization } from "@domain/ai/core/ai-org-context.js";

import { Queue, QueueOptions, QueueEvents, Job, JobsOptions } from "bullmq";
import { createLogger } from "@server/utils/logger.js";
import { getRedisOptions } from "@domain/core/infrastructure/redis/redis-client.js";
import { injectContext } from "@server/utils/tracing.js";
import { generateTraceId, generateSpanId } from "@domain/core/infrastructure/tracing/trace-context.service.js";

const logger = createLogger("QueueService");

// Queue Names
export const QUEUE_NAMES = {
    STEPS: "oddjob-steps",
    AI: "oddjob-ai",
    SYSTEM: "oddjob-system",
    BROWSER: "oddjob-browser",
    HEAVY_JOBS: "oddjob-heavy",
    ANALYTICS: "oddjob-analytics",
    PROSPECTING: "oddjob-prospecting",
    HEALING: "oddjob-healing",
    AUDIT: "oddjob-audit",
    XRAY: "oddjob-xray",
    TRANSFERENCE: "oddjob-transference",
    HEARTBEAT: "oddjob-heartbeat",
} as const;

export class QueueService {
    private static instance: QueueService;
    private static readonly MAX_PAYLOAD_SIZE = 50 * 1024; // 50KB limit for Redis safety

    public stepsQueue: Queue;
    public stepsEvents: QueueEvents;
    public aiQueue: Queue;
    public systemQueue: Queue;
    public browserQueue: Queue;
    public browserEvents: QueueEvents;
    public heavyQueue: Queue;
    public heavyEvents: QueueEvents;
    public analyticsQueue: Queue;
    public prospectingQueue: Queue;
    public healingQueue: Queue;
    public healingEvents: QueueEvents;
    public auditQueue: Queue;
    public xrayQueue: Queue;
    public transferenceQueue: Queue;

    private constructor() {
        const connectionOpts = {
            ...getRedisOptions(),
            maxRetriesPerRequest: null,
        };

        const defaultOptions: QueueOptions = {
            connection: connectionOpts,
            defaultJobOptions: {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 1000,
                },
                removeOnComplete: 100,
                removeOnFail: 1000,
            }
        };

        this.stepsQueue = new Queue(QUEUE_NAMES.STEPS, defaultOptions);
        this.stepsEvents = new QueueEvents(QUEUE_NAMES.STEPS, { connection: connectionOpts });
        this.aiQueue = new Queue(QUEUE_NAMES.AI, defaultOptions);
        this.systemQueue = new Queue(QUEUE_NAMES.SYSTEM, defaultOptions);
        this.browserQueue = new Queue(QUEUE_NAMES.BROWSER, defaultOptions);
        this.browserEvents = new QueueEvents(QUEUE_NAMES.BROWSER, { connection: connectionOpts });
        this.heavyQueue = new Queue(QUEUE_NAMES.HEAVY_JOBS, defaultOptions);
        this.heavyEvents = new QueueEvents(QUEUE_NAMES.HEAVY_JOBS, { connection: connectionOpts });
        this.analyticsQueue = new Queue(QUEUE_NAMES.ANALYTICS, defaultOptions);
        this.prospectingQueue = new Queue(QUEUE_NAMES.PROSPECTING, defaultOptions);
        this.healingQueue = new Queue(QUEUE_NAMES.HEALING, defaultOptions);
        this.healingEvents = new QueueEvents(QUEUE_NAMES.HEALING, { connection: connectionOpts });
        this.auditQueue = new Queue(QUEUE_NAMES.AUDIT, defaultOptions);
        this.xrayQueue = new Queue(QUEUE_NAMES.XRAY, defaultOptions);
        this.transferenceQueue = new Queue(QUEUE_NAMES.TRANSFERENCE, defaultOptions);

        // Monitoring
        [
            this.stepsQueue, 
            this.aiQueue, 
            this.systemQueue, 
            this.browserQueue, 
            this.heavyQueue, 
            this.analyticsQueue, 
            this.prospectingQueue,
            this.healingQueue,
            this.auditQueue,
            this.xrayQueue,
            this.transferenceQueue
        ].forEach(q => this.setupListeners(q));

        [this.stepsEvents, this.browserEvents, this.heavyEvents, this.healingEvents].forEach(qe => {
            qe.on("error", (err) => {
                logger.error(`QueueEvents ${qe.name} error`, { error: err?.message || String(err) });
            });
            try {
                (qe as any).client?.on?.("error", (err: any) => {
                    logger.error(`QueueEvents ${qe.name} Redis error`, { error: err?.message || String(err) });
                });
            } catch {
                // Ignore
            }
        });
    }

    private setupListeners(queue: Queue) {
        queue.on("error", (err) => {
            logger.error(`Queue ${queue.name} error`, { error: err?.message || String(err) });
        });
        try {
            (queue as any).client?.on?.("error", (err: any) => {
                logger.error(`Queue ${queue.name} Redis error`, { error: err?.message || String(err) });
            });
        } catch {
            // Ignore
        }
    }

    static getInstance(): QueueService {
        if (!QueueService.instance) {
            QueueService.instance = new QueueService();
        }
        return QueueService.instance;
    }

    async close() {
        await Promise.all([
            this.stepsQueue.close(),
            this.stepsEvents.close(),
            this.aiQueue.close(),
            this.systemQueue.close(),
            this.browserQueue.close(),
            this.browserEvents.close(),
            this.heavyQueue.close(),
            this.heavyEvents.close(),
            this.prospectingQueue.close()
        ]);
    }

    /**
     * Add a job to a queue with the current trace context automatically injected.
     */
    async addJobWithTrace<T = any>(queue: Queue, name: string, data: T, opts?: JobsOptions): Promise<Job> {
        const jobData = { ...data } as any;
        jobData.organizationId = await resolveAiOrganization(jobData.organizationId ?? jobData.orgId);
        this._injectTrace(jobData);
        return queue.add(name, this._sanitizePayload(jobData), opts);
    }

    async addBulkJobsWithTrace(queue: Queue, name: string, data: any[], opts?: JobsOptions) {
        const bulkData = await Promise.all(data.map(async d => {
            const organizationId = await resolveAiOrganization(d.organizationId ?? d.orgId);
            const jobData = { ...d, organizationId } as any;
            this._injectTrace(jobData);
            return {
                name,
                data: this._sanitizePayload(jobData),
                opts
            };
        }));
        return queue.addBulk(bulkData);
    }

    async waitForJob(queueEvents: QueueEvents, job: Job, timeoutMs: number = 300000): Promise<any> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Job ${job.id} timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            const onCompleted = ({ jobId, returnvalue }: { jobId: string; returnvalue: string }) => {
                if (jobId === job.id) {
                    clearTimeout(timeout);
                    queueEvents.off("completed", onCompleted);
                    queueEvents.off("failed", onFailed);
                    if (typeof returnvalue === 'string' && (returnvalue.startsWith('{') || returnvalue.startsWith('['))) {
                        try {
                            resolve(JSON.parse(returnvalue));
                        } catch {
                            resolve(returnvalue);
                        }
                    } else {
                        resolve(returnvalue);
                    }
                }
            };

            const onFailed = ({ jobId, failedReason }: { jobId: string; failedReason: string }) => {
                if (jobId === job.id) {
                    clearTimeout(timeout);
                    queueEvents.off("completed", onCompleted);
                    queueEvents.off("failed", onFailed);
                    reject(new Error(`Job ${job.id} failed: ${failedReason}`));
                }
            };

            queueEvents.on("completed", onCompleted);
            queueEvents.on("failed", onFailed);
        });
    }

    private _injectTrace(jobData: any) {
        injectContext(jobData);

        if (!jobData.traceContext) {
            const traceparent = jobData.traceparent;
            if (traceparent) {
                const parts = traceparent.split('-');
                if (parts.length >= 4) {
                    jobData.traceContext = {
                        traceId: parts[1],
                        spanId: parts[2],
                        traceFlags: parts[3],
                        depth: 0
                    };
                }
            } else {
                jobData.traceContext = {
                    traceId: generateTraceId(),
                    spanId: generateSpanId(),
                    traceFlags: "01",
                    depth: 0
                };
            }
        }
    }

    private _sanitizePayload(data: any): any {
        try {
            const str = JSON.stringify(data);
            if (str.length > QueueService.MAX_PAYLOAD_SIZE) {
                logger.warn(`Payload exceeds ${QueueService.MAX_PAYLOAD_SIZE} bytes. Truncating.`);
                if (data.payload && typeof data.payload === 'object') {
                    return { ...data, payload: { _truncated: true, _originalSize: str.length } };
                }
                return { _truncated_raw: true, _originalSize: str.length };
            }
        } catch (e) {
            logger.error("Sanitization failed", e);
        }
        return data;
    }
}

export const queueService = QueueService.getInstance();




