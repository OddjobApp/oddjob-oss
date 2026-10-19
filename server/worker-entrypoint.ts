/**
 * Worker Entrypoint
 * 
 * Standalone entrypoint for running workers without the HTTP server.
 * Use this for horizontal scaling in containerized environments.
 * 
 * Usage: node dist/worker-entrypoint.js
 */

import "./utils/dns-order.js"; // must precede any module that opens a socket
import "dotenv/config";
import { initTracing } from "./instrumentation.js";

// Alias GEMINI_API_KEY -> GOOGLE_API_KEY for the google adapter and LangChain libs
// (see server/index.ts) so background agent jobs don't fail over to Ollama.
if (!process.env.GOOGLE_API_KEY && process.env.GEMINI_API_KEY) {
  process.env.GOOGLE_API_KEY = process.env.GEMINI_API_KEY;
}

initTracing();

import { createLogger } from "./utils/logger.js";
import { initializeHooks } from "./domain/pipeline/hooks/index.js";

const logger = createLogger("WorkerEntrypoint");

async function main() {
    const workerType = (process.env.WORKER_TYPE || 'all').trim().toLowerCase();
    if (workerType === 'none' || workerType === 'disabled') {
        logger.info(`WORKER_TYPE is "${workerType}". Skipping worker initialization and entering idle mode.`);
        setInterval(() => {}, 60000);
        return;
    }

    if (process.env.SKIP_WORKERS === 'true') {
        logger.warn(
            "SKIP_WORKERS=true is ignored by the standalone worker entrypoint. " +
            "Use WORKER_TYPE=none to intentionally run this process without workers."
        );
    }

    // Initialize hooks early (critical for distributed environments)
    initializeHooks();

    // The worker fleet calls providers too, so it needs the tuned thresholds and
    // the persisted open-circuit state as much as the API process does.
    const { initializeCircuits } = await import("./domain/core/infrastructure/circuit-breaker.service.js");
    await initializeCircuits();

    const { jobExecutorRegistry } = await import("./domain/jobs/core/executors/index.js");
    await (jobExecutorRegistry as any).autoRegister();

    // This process is the dedicated worker fleet — flag it so
    // initializeWorkers() registers queue consumers, not just producers.
    // Not awaited: its trailing getQueueStats() blocks on a Redis reply, and
    // Bull retries the connection in the background regardless.
    if (!process.env.WORKER_PROCESS) process.env.WORKER_PROCESS = "true";
    const { initializeWorkers } = await import("./domain/queue/workers.bootstrap.js");
    void initializeWorkers().catch((err) =>
        logger.error("Queue worker initialization failed — queued jobs will wait", { error: err?.message }),
    );

    const { eventStream } = await import("./domain/core/infrastructure/event-stream.service.js");
    await eventStream.initialize();

    const { kafkaRuntimeService } = await import("./domain/core/infrastructure/kafka-runtime.service.js");
    await kafkaRuntimeService.initialize();

    const { e2eTriggerListenerService } = await import("./domain/sdlc-pipeline/autonomous/e2e-trigger-listener.service.js");
    await e2eTriggerListenerService.initialize();

    logger.info(`Starting worker processes (Type: ${workerType})...`);

    const startStepWorker = async () => {
        const { startStepWorker: fn } = await import("./workers/step-worker.js");
        return fn();
    };
    const startAIWorker = async () => {
        const { startAIWorker: fn } = await import("./workers/ai-worker.js");
        return fn();
    };
    const startBrowserWorker = async () => {
        const { startBrowserWorker: fn } = await import("./workers/browser-worker.js");
        return fn();
    };
    const startHeavyWorker = async () => {
        const { startHeavyWorker: fn } = await import("./workers/heavy-worker.js");
        return fn();
    };
    const startAnalyticsWorker = async () => {
        const { startAnalyticsWorker: fn } = await import("./workers/analytics-worker.js");
        return fn();
    };
    const startProspectingWorker = async () => {
        const { startProspectingWorker: fn } = await import("./workers/prospecting-worker.js");
        return fn();
    };
    const startExtractionWorker = async () => {
        const { startExtractionWorker: fn } = await import("./domain/knowledge/knowledge-queue.js");
        return fn();
    };
    const startSchedulerWorker = async () => {
        const { startSchedulerWorker: fn } = await import("./domain/schedules/infrastructure/scheduler-worker.js");
        return fn();
    };
    const startScheduledJobExecutor = async () => {
        const { startScheduledJobExecutor: fn } = await import("./domain/schedules/infrastructure/scheduler-worker.js");
        return fn();
    };
    const initScheduler = async () => {
        const { initScheduler: fn } = await import("./domain/schedules/infrastructure/scheduler-worker.js");
        return fn();
    };
    
    const startForgeWorker = async () => {
        const { startRollingForgeWorker } = await import("./domain/apps/infrastructure/forge-queue.js");
        startRollingForgeWorker();
    };

    const startDynamicMissionWorker = async () => {
        const { startDynamicMissionWorker } = await import("./domain/mission/infrastructure/dynamic-mission-worker.js");
        startDynamicMissionWorker();
    };

    const startRollingWaveWorker = async () => {
        const { startRollingWaveWorker } = await import("./domain/mission/infrastructure/rolling-wave-worker.js");
        startRollingWaveWorker();
    };

    const startTransferenceWorker = async () => {
        const { startTransferenceWorker: fn } = await import("./workers/transference-worker.js");
        const worker = fn();
        // Seed the daily candidate mining job (idempotent — repeat:jobId avoids duplicates)
        const { queueService } = await import("./domain/core/infrastructure/queue/queue-service.js");
        await queueService.transferenceQueue.add(
            "transference-mine-daily",
            { type: "mine", data: {} },
            {
                repeat: { pattern: "0 3 * * *" }, // 3 AM every day
                jobId: "transference-mine-daily",
                removeOnComplete: 10,
                removeOnFail: 20,
            }
        );
        logger.info("[TransferenceWorker] Daily mining cron scheduled (3 AM)");
        return worker;
    };

    const workerRegistry: Record<string, () => Promise<any> | any> = {
        step: startStepWorker,
        ai: startAIWorker,
        browser: startBrowserWorker,
        heavy: startHeavyWorker,
        extraction: startExtractionWorker,
        analytics: startAnalyticsWorker,
        prospecting: startProspectingWorker,
        forge: startForgeWorker,
        "dynamic-mission": startDynamicMissionWorker,
        "rolling-wave": startRollingWaveWorker,
        // Periodic mission maintenance incl. the zombie reaper (reapZombies).
        // Previously only wired into WorkerManagerService.startAll() on the HTTP
        // server, which is skipped via SKIP_WORKERS — so it ran in NO process and
        // orphaned 'active' runs accumulated. The standalone worker process is its
        // correct home.
        maintenance: async () => {
            const { startMissionMaintenance } = await import("./domain/mission/infrastructure/mission-maintenance.js");
            startMissionMaintenance();
            // Prunes the spatial iteration gate's confirmation counters, which
            // otherwise accumulate one row per tracked subject per gated
            // condition and are never reclaimed. Same reasoning as above: the
            // HTTP-server path is skipped under SKIP_WORKERS.
            const { startSignalIntelligenceMaintenance } = await import(
                "./domain/signal-intelligence/infrastructure/signal-intelligence-maintenance.js"
            );
            startSignalIntelligenceMaintenance();
            // Monthly budget resets — the third instance of exactly the pattern
            // described above. financialMaintenanceService had NO caller at all,
            // so org_settings.current_month_spend_usd only ever grew: one org
            // was still carrying its June figure in August. Worse than the stale
            // dashboard number, admission control compares that counter against
            // the monthly limit, so a counter that never resets eventually
            // refuses all work for an org that has spent nothing this month.
            const { financialMaintenanceService } = await import(
                "./domain/system/financial-maintenance.service.js"
            );
            financialMaintenanceService.start();
            // Pushes new approvals to their approver's browsers. The HTTP server
            // starts it too unless SKIP_WORKERS; the delivery ledger dedupes.
            const { startApprovalPushSweep } = await import(
                "./domain/core/notifications/push-approval-sweep.js"
            );
            startApprovalPushSweep();
            // Posts new alerts into each org's CREW alert rooms. Also started by
            // the HTTP server; the claim in push_deliveries posts each alert once.
            const { startAlertRoomSweep } = await import("./domain/crew/core/crew-alert-rooms.js");
            startAlertRoomSweep();
            const { startGmailDirectiveMonitor } = await import('./domain/integrations/core/gmail-directives.service.js');
            startGmailDirectiveMonitor();
        },
        // Polls signal feeds on their configured interval. Until this existed,
        // `polling_interval_seconds` was validated and stored but read by
        // nothing — `pollAndProcess` had one caller, the manual poll route — so
        // every configured feed ingested only when a human POSTed to it.
        "signal-feeds": async () => {
            const { startSignalFeedPoller } = await import(
                "./domain/signal-intelligence/infrastructure/signal-feed-poller.js"
            );
            startSignalFeedPoller();
        },
        // Subscribes the pipeline event-trigger listener to the event stream.
        // `pipelineTriggerService.start()` previously had no caller at all, so
        // `triggerType: 'event'` pipelines stored triggers that never fired. It
        // must run in exactly ONE process: the listener fans out via Redis
        // pub/sub, so an HTTP-side start would double-fire every event.
        "pipeline-triggers": async () => {
            const { pipelineTriggerService } = await import(
                "./domain/pipeline/core/pipeline-trigger.service.js"
            );
            await pipelineTriggerService.start();
        },
        healing: async () => {
            const { startHealingWorker } = await import("./workers/healing-worker.js");
            return startHealingWorker();
        },
        audit: async () => {
            const { startAuditWorker } = await import("./workers/audit-worker.js");
            return startAuditWorker();
        },
        consensus: async () => {
            const { startConsensusWorker } = await import("./workers/consensus-worker.js");
            return startConsensusWorker();
        },
        "graph-walker": async () => {
            const { startGraphWalkerWorker } = await import("./domain/knowledge/workers/graph-walker.js");
            return startGraphWalkerWorker();
        },
        "capability-sync": async () => {
            const { startCapabilitySyncWorker } = await import("./domain/capabilities/infrastructure/capability-sync-queue.js");
            return startCapabilitySyncWorker();
        },
        scheduler: async () => {
            startSchedulerWorker();
            startScheduledJobExecutor();
            await initScheduler();
        },
        "reactive-listeners": async () => {
            const { reactiveOrchestratorService } = await import("./domain/mission/core/reactive-orchestrator.service.js");
            await reactiveOrchestratorService.initializeActiveListeners();
        },
        "saas-sync": async () => {
            const { startSaaSSyncWorker, initSaaSSyncScheduler } = await import("./workers/saas-sync-worker.js");
            startSaaSSyncWorker();
            await initSaaSSyncScheduler();
        },
        "messaging": async () => {
            const { SlackSocketListener } = await import("./domain/integrations/slack-socket-listener.js");
            await SlackSocketListener.startAll();
        },
        system: async () => {
            const { startSystemWorker } = await import("./workers/system-worker.js");
            return startSystemWorker();
        },
        heartbeat: async () => {
            const { startHeartbeatWorker } = await import("./workers/heartbeat-worker.js");
            return startHeartbeatWorker();
        },
        reconciliation: async () => {
            const { containerReconciliationService } = await import("./domain/infrastructure/container-reconciliation.service.js");
            containerReconciliationService.start(60000);
        },
        transference: startTransferenceWorker,
    };

    if (workerType === 'all') {
        logger.info("Initializing all workers...");
        for (const [name, startFn] of Object.entries(workerRegistry)) {
            try {
                await startFn();
                logger.info(`  [✓] ${name} started`);
            } catch (err: any) {
                logger.error(`  [✗] ${name} failed: ${err.message}`);
            }
        }
    } else {
        const selectedTypes = workerType.split(',').map(t => t.trim().toLowerCase());
        for (const type of selectedTypes) {
            if (workerRegistry[type]) {
                try {
                    await workerRegistry[type]();
                    logger.info(`  [✓] ${type} started`);
                } catch (err: any) {
                    logger.error(`  [✗] ${type} failed: ${err.message}`);
                }
            } else {
                logger.warn(`  [!] Unknown worker type: ${type}`);
            }
        }
    }

    logger.info("Worker initialization complete");

    // Registry sanity: warn loudly if any advertised tool can't be dispatched
    // (missing execute / non-parseable schema) — cheap guard against the
    // advertised-vs-dispatchable drift the fallthrough closed.
    try {
        const { auditToolRegistrySanity } = await import("./domain/tools/v1/capabilities/index.js");
        auditToolRegistrySanity();
    } catch (err: any) {
        logger.warn(`Tool registry sanity audit failed: ${err.message}`);
    }

    // Handle graceful shutdown
    const shutdown = async () => {
        logger.info("Shutting down workers...");
        try {
            const { shutdownWorkers } = await import("./domain/queue/workers.bootstrap.js");
            await shutdownWorkers();
            const { containerReconciliationService } = await import("./domain/infrastructure/container-reconciliation.service.js");
            containerReconciliationService.stop();
            process.exit(0);
        } catch (error) {
            logger.error("Error during shutdown:", error);
            process.exit(1);
        }
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Keep the process running
    logger.info("Worker entrypoint ready. Press Ctrl+C to stop.");
}

main().catch((error) => {
    logger.error("Failed to start workers:", error);
    process.exit(1);
});
