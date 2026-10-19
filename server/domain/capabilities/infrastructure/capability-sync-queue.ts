/**
 * Capability Sync Queue + Worker (fleet integration)
 * ==================================================
 *
 * Runs both ACDD pipelines OFF the request thread so the heavy LLM/embedding
 * work gets isolation + backpressure + retries from BullMQ, while the read path
 * (`registry.discover`) stays in-process for latency.
 *
 * Queue-level dedupe: code→docs jobs use `jobId = c2d-<org>-<id>-<sigHash>`, so
 * an identical code change can't stack duplicate jobs — a second guard on top of
 * the reconciler's signature gate.
 *
 * The Queue is created lazily (not at import) so importing this module for the
 * dispatch unit test does not open a Redis connection. The job-dispatch logic is
 * a pure, injectable function for the same reason.
 */

import { Queue, Job } from "bullmq";
import { createLogger } from "@server/utils/logger.js";
import { BaseWorker } from "@server/workers/base-worker.js";
import { redisConnectionOptions } from "@domain/core/infrastructure/redis/connection-options.js";
import { type CapabilityManifest } from "@shared/schema/capabilities/index.js";
import { computeSignatureHash } from "../core/capability-reconciler.service.js";
import { codeToDocsPipeline, type CodeToDocsPipeline } from "../core/code-to-docs.pipeline.js";
import { docsToCodePipeline, type DocsToCodePipeline } from "../core/docs-to-code.pipeline.js";

const logger = createLogger("CapabilitySyncQueue");

const QUEUE_NAME = "oddjob-capability-sync";

const redisOptions = redisConnectionOptions();

export type CapabilitySyncJob =
    | { kind: "code-to-docs"; organizationId: number; manifest: CapabilityManifest }
    | { kind: "docs-to-code-file"; organizationId: number; absPath: string }
    | { kind: "docs-to-code-folder"; organizationId: number; dir?: string };

// --- Queue (lazy) ---------------------------------------------------------

let queueInstance: Queue<CapabilitySyncJob> | null = null;

export function getCapabilitySyncQueue(): Queue<CapabilitySyncJob> {
    if (!queueInstance) {
        queueInstance = new Queue<CapabilitySyncJob>(QUEUE_NAME, {
            connection: redisOptions,
            defaultJobOptions: {
                attempts: 3,
                backoff: { type: "exponential", delay: 2000 },
                removeOnComplete: { count: 200 },
                removeOnFail: { count: 100 },
            },
        });
    }
    return queueInstance;
}

// --- Enqueue helpers ------------------------------------------------------

/** Enqueue a Path A run. Deduped by capability signature hash. */
export async function enqueueCodeToDocs(organizationId: number, manifest: CapabilityManifest): Promise<Job> {
    const jobId = `c2d-${organizationId}-${manifest.capability_id}-${computeSignatureHash(manifest).slice(0, 12)}`;
    return getCapabilitySyncQueue().add(
        "code-to-docs",
        { kind: "code-to-docs", organizationId, manifest },
        { jobId },
    );
}

/** Enqueue Path B ingestion of a single Markdown file (deduped by path). */
export async function enqueueDocsToCodeFile(organizationId: number, absPath: string): Promise<Job> {
    return getCapabilitySyncQueue().add(
        "docs-to-code-file",
        { kind: "docs-to-code-file", organizationId, absPath },
        { jobId: `d2c-file-${organizationId}-${absPath}` },
    );
}

/** Enqueue a Path B folder scan (always runs; timestamped id). */
export async function enqueueDocsToCodeFolder(organizationId: number, dir?: string): Promise<Job> {
    return getCapabilitySyncQueue().add(
        "docs-to-code-folder",
        { kind: "docs-to-code-folder", organizationId, dir },
        { jobId: `d2c-folder-${organizationId}-${Date.now()}` },
    );
}

// --- Dispatch (pure, injectable, unit-tested) -----------------------------

export interface DispatchDeps {
    codeToDocs: Pick<CodeToDocsPipeline, "run">;
    docsToCode: Pick<DocsToCodePipeline, "ingestFile" | "ingestFolder">;
}

export async function dispatchCapabilitySyncJob(
    data: CapabilitySyncJob,
    deps: Partial<DispatchDeps> = {},
): Promise<unknown> {
    const codeToDocs = deps.codeToDocs ?? codeToDocsPipeline;
    const docsToCode = deps.docsToCode ?? docsToCodePipeline;

    switch (data.kind) {
        case "code-to-docs":
            return codeToDocs.run(data.organizationId, data.manifest);
        case "docs-to-code-file":
            return docsToCode.ingestFile(data.organizationId, data.absPath);
        case "docs-to-code-folder":
            return docsToCode.ingestFolder(data.organizationId, data.dir);
        default: {
            // Exhaustiveness guard — unreachable for the typed union.
            logger.warn(`Unknown capability-sync job kind: ${JSON.stringify(data)}`);
            return { skipped: true };
        }
    }
}

// --- Worker ---------------------------------------------------------------

export class CapabilitySyncWorker extends BaseWorker<CapabilitySyncJob> {
    constructor() {
        super(QUEUE_NAME, { concurrency: 2, lockDuration: 300000 });
    }

    protected async execute(job: Job<CapabilitySyncJob>): Promise<unknown> {
        return dispatchCapabilitySyncJob(job.data);
    }
}

let workerInstance: CapabilitySyncWorker | null = null;

export function startCapabilitySyncWorker(): CapabilitySyncWorker {
    if (!workerInstance) {
        workerInstance = new CapabilitySyncWorker();
        logger.info("Capability Sync Worker started");
        // Start opt-in auto-triggers. Dynamic import breaks the queue↔triggers
        // static cycle; failures here must not stop the worker.
        void import("./capability-triggers.js")
            .then((m) => m.startCapabilityTriggers())
            .catch((err) => logger.warn(`Capability triggers failed to start: ${String(err)}`));
        // Provision the dedicated docs checkout when managed-branch mode is on, so
        // audit/* isolation never touches the live working tree.
        if (["1", "true", "yes", "on"].includes((process.env.ACDD_DOCS_MANAGE_BRANCHES || "").trim().toLowerCase())) {
            void import("./docs-checkout.js")
                .then((m) => m.ensureDocsCheckout())
                .then((r) => logger.info(`Docs checkout: ${r.reason}`))
                .catch((err) => logger.warn(`Docs checkout provisioning failed: ${String(err)}`));
        }
    }
    return workerInstance;
}
