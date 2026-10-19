import { createLogger } from "../utils/logger.js";
import { startAsyncPoller } from "@domain/core/async-poller.service.js";
import { startReportingMaintenance } from "@domain/analytics/infrastructure/reporting-maintenance.js";
import { startMissionMaintenance } from "@domain/mission/infrastructure/mission-maintenance.js";
import { financialMaintenanceService } from "@domain/system/financial-maintenance.service.js";
import { startAutoresearchMaintenance } from "@domain/admin/infrastructure/autoresearch-maintenance.js";
import { startDocumentationMaintenance } from "@domain/admin/infrastructure/documentation-maintenance.js";
import { startKnowledgePackMonitorMaintenance } from "@domain/knowledge-packs/knowledge-pack-monitor-maintenance.js";
import { startWorker } from "@server/integrations/job-queue.js";
import { startExtractionWorker } from "@domain/knowledge/knowledge-queue.js";
import { startStreamWorker } from "@domain/knowledge/stream-queue.js";
import { startBrowserWorker } from "@server/workers/browser-worker.js";
import { startAIWorker } from "@server/workers/ai-worker.js";
import { startStepWorker } from "@server/workers/step-worker.js";
import { startHeavyWorker } from "@server/workers/heavy-worker.js";
import { startProspectingWorker } from "@server/workers/prospecting-worker.js";
import { startSchedulerWorker, startScheduledJobExecutor, initScheduler } from "@domain/schedules/infrastructure/scheduler-worker.js";
import { startSaaSSyncWorker, initSaaSSyncScheduler } from "../workers/saas-sync-worker.js";
import { startRollingWaveWorker, stopRollingWaveWorker } from "@domain/mission/infrastructure/rolling-wave-worker.js";
import { startDynamicMissionWorker } from "@domain/mission/infrastructure/dynamic-mission-worker.js";
import { startAutonomousMissionWorker } from "@domain/ai/infrastructure/autonomous-mission.worker.js";
import { startCycleWorker, initCycleScheduler } from "../workers/cycle-worker.js";
import { SlackSocketListener } from "@domain/integrations/slack-socket-listener.js";
import { startInnovationWorker } from "@domain/governor/infrastructure/innovation-worker.js";
import { startRollingForgeWorker } from "@domain/apps/infrastructure/forge-queue.js";

const logger = createLogger("WorkerManager");

export class WorkerManagerService {
    private static enabledWorkers: string[] | null = process.env.ENABLED_WORKERS 
        ? process.env.ENABLED_WORKERS.split(',').map(s => s.trim()) 
        : null;

    static isWorkerEnabled(name: string): boolean {
        const enabled = !this.enabledWorkers || this.enabledWorkers.includes(name);
        return enabled;
    }

    /**
     * Named outright, rather than enabled by the absence of a list.
     *
     * isWorkerEnabled answers true when ENABLED_WORKERS is unset, which is right
     * for "start the fleet unless told otherwise" but wrong for deciding whether
     * to start a worker in a process that was explicitly told to skip them.
     */
    static isWorkerExplicitlyEnabled(name: string): boolean {
        return this.enabledWorkers !== null && this.enabledWorkers.includes(name);
    }

    static async startAll(): Promise<void> {
        if (process.env.SKIP_WORKERS === 'true') {
            // Forge requests are accepted by this process but executed by a BullMQ
            // worker, so in a genuinely single-process deployment an accepted build
            // strands forever. Starting one here unconditionally is the wrong cure:
            // SKIP_WORKERS is how a deployment says "a dedicated worker-entrypoint
            // fleet runs the workers", and that fleet starts its own forge worker.
            // Two then consume one queue — each with its own stalled-checker, each
            // pre-warming the same master dependency cache — and a long build gets
            // reclaimed mid-flight and restarted from stage 0.
            //
            // startRollingForgeWorker cannot catch this: its guard is a module-level
            // singleton, so it only ever sees its own process.
            //
            // So this requires naming forge outright in ENABLED_WORKERS. A truly
            // single-process deployment sets ENABLED_WORKERS=forge and gets its
            // worker; one running the fleet leaves it unset and gets exactly one,
            // over there.
            if (this.isWorkerExplicitlyEnabled('forge')) {
                startRollingForgeWorker();
                logger.info("SKIP_WORKERS is true, but ENABLED_WORKERS names forge: starting the App Forge worker in this process.");
            } else {
                logger.info("SKIP_WORKERS is true. Skipping background fleet initialization.");
                // Saved Gmail alerts are a lightweight connector poller, not the AI fleet.
                void import('../domain/integrations/core/gmail-directives.service.js')
                    .then(({ startGmailDirectiveMonitor }) => startGmailDirectiveMonitor())
                    .catch(error => logger.error(`Gmail directive monitor failed to start: ${error.message}`));
            }
            return;
        }

        logger.info("Initializing distributed background fleet...");

        const allWorkers: Array<{ close(): Promise<void> }> = [];

        // Control Plane Poller (Usually runs on all nodes)
        startAsyncPoller();

        // 1. Maintenance & Cleanup Workers
        if (this.isWorkerEnabled('maintenance')) {
            startReportingMaintenance();
            startMissionMaintenance();
            startAutoresearchMaintenance();
            startDocumentationMaintenance();
            startKnowledgePackMonitorMaintenance();
            // Monthly budget resets. Nothing called this before, so
            // org_settings.current_month_spend_usd only ever grew — a dashboard
            // reporting June's figure in August, and an admission-control check
            // that compares that counter to the monthly limit and would
            // eventually refuse all work for an org that had spent nothing.
            financialMaintenanceService.start();
            void import('../domain/integrations/core/gmail-directives.service.js')
                .then(({ startGmailDirectiveMonitor }) => startGmailDirectiveMonitor())
                .catch(error => logger.error(`Gmail directive monitor failed to start: ${error.message}`));
            // Pushes new approvals to their approver's browsers. Also started by the
            // standalone worker; the delivery ledger keeps the two from double-sending.
            void import("../domain/core/notifications/push-approval-sweep.js")
                .then(({ startApprovalPushSweep }) => startApprovalPushSweep())
                .catch((err) => logger.error(`Approval push sweep failed to start: ${err.message}`));
            // Posts new alerts into each org's CREW alert rooms; the standalone
            // worker starts it too, and the claim in push_deliveries posts each once.
            void import("../domain/crew/core/crew-alert-rooms.js")
                .then(({ startAlertRoomSweep }) => startAlertRoomSweep())
                .catch((err) => logger.error(`Alert room sweep failed to start: ${err.message}`));
            logger.info("✅ Maintenance Workers active");
        }

        // 2. Knowledge & Extraction Fleet
        if (this.isWorkerEnabled('extraction')) {
            const ew = startExtractionWorker(); if (ew) allWorkers.push(ew);
            const sw = startStreamWorker(); if (sw) allWorkers.push(sw);
            logger.info("✅ Knowledge Extraction Fleet active");
        }

        // 3. AI & Compute Fleet
        if (this.isWorkerEnabled('ai')) {
            const aiw = startAIWorker(); if (aiw) allWorkers.push(aiw);
            const stw = startStepWorker(); if (stw) allWorkers.push(stw);
            const hw = startHeavyWorker(); if (hw) allWorkers.push(hw);
            const iw = startInnovationWorker(); if (iw) allWorkers.push(iw);
            logger.info("✅ AI Compute Fleet active (+ Innovation Lab Worker)");
        }

        // 4. Mission Orchestration Fleet
        if (this.isWorkerEnabled('mission')) {
            startWorker(); // Legacy job queue
            startRollingWaveWorker();
            allWorkers.push({ close: stopRollingWaveWorker });
            const dmw = startDynamicMissionWorker(); if (dmw) allWorkers.push(dmw);
            const amw = startAutonomousMissionWorker(); if (amw) allWorkers.push(amw);
            logger.info("✅ Mission Orchestration Fleet active");
        }

        // 5. Scheduling & SaaS Fleet
        if (this.isWorkerEnabled('schedules')) {
            await initScheduler();
            const schw = startSchedulerWorker(); if (schw) allWorkers.push(schw);
            const sjew = startScheduledJobExecutor(); if (sjew) allWorkers.push(sjew);
            await initSaaSSyncScheduler();
            const ssw = startSaaSSyncWorker(); if (ssw) allWorkers.push(ssw);
            logger.info("✅ Scheduling & SaaS Fleet active");
        }

        // 6. Business Operations Fleet
        if (this.isWorkerEnabled('cycles')) {
            await initCycleScheduler();
            const cyw = startCycleWorker(); if (cyw) allWorkers.push(cyw);
            logger.info("✅ Business Ops Cycle Fleet active");
        }

        // 7. Infrastructure Workers (Browser, etc)
        if (this.isWorkerEnabled('browser')) {
            const brw = startBrowserWorker(); if (brw) allWorkers.push(brw);
            logger.info("✅ Browser Automation Worker active");
        }

        if (this.isWorkerEnabled('prospecting')) {
            const prw = startProspectingWorker(); if (prw) allWorkers.push(prw);
            logger.info("✅ Prospecting Worker active");
        }

        if (this.isWorkerEnabled('forge')) {
            const fw = startRollingForgeWorker(); if (fw) allWorkers.push(fw);
            logger.info("✅ App Forge Worker active");
        }

        // 8. Messaging & Conversational Fleet
        if (this.isWorkerEnabled('messaging')) {
            SlackSocketListener.startAll().catch(err =>
                logger.error("Failed to start Slack listeners", { err })
            );
            logger.info("✅ Slack Messaging Listener active");
        }

        // Capability Sync Fleet (ACDD bi-directional code⇄docs engine)
        if (this.isWorkerEnabled('capability-sync')) {
            const { startCapabilitySyncWorker } = await import("@domain/capabilities/infrastructure/capability-sync-queue.js");
            const csw = startCapabilitySyncWorker(); if (csw) allWorkers.push(csw);
            logger.info("✅ Capability Sync Fleet active");
        }

        // Mission Support Services (Telemetry, Blackboard, Governance)
        await this.startMissionSupportServices();

        // 9. Agentic HR (hourly performance audit — gates on 'ai' worker group)
        if (this.isWorkerEnabled('ai')) {
            this.startAgenticHrMonitor();
        }

        // State Consistency Checker (System 1) to prevent Docker container drifts
        const runConsistencyChecker = () =>
            import("@domain/apps/infrastructure/state-consistency-checker.service.js")
                .then(({ consistencyCheckerService }) => {
                    consistencyCheckerService.start();
                    allWorkers.push({ close: () => consistencyCheckerService.stop() });
                })
                .catch(err => logger.error(`[WorkerManager] Consistency Checker failed to start: ${err.message}`));
        setTimeout(runConsistencyChecker, 5000);

        // Proactive Health Monitoring Service (System 2) to ping app instances
        const runHealthCheck = () =>
            import("@domain/apps/infrastructure/health-check.service.js")
                .then(({ healthCheckService }) => {
                    healthCheckService.start();
                    allWorkers.push({ close: () => healthCheckService.stop() });
                })
                .catch(err => logger.error(`[WorkerManager] Health Check Service failed to start: ${err.message}`));
        setTimeout(runHealthCheck, 5000);

        // Garbage Collection Service (System 1) to reap orphaned containers and stale ports
        const runGarbageCollection = () =>
            import("@domain/apps/infrastructure/garbage-collection.service.js")
                .then(({ garbageCollectionService }) => {
                    garbageCollectionService.start();
                    allWorkers.push({ close: async () => garbageCollectionService.stop() });
                })
                .catch(err => logger.error(`[WorkerManager] Garbage Collection Service failed to start: ${err.message}`));
        setTimeout(runGarbageCollection, 5000);


        // 10. X-Ray & Observability Fleet
        if (this.isWorkerEnabled('observability')) {
            const { startXrayNightlyIndexer } = await import("../domain/xray/infrastructure/xray-nightly-indexer.js");
            const { initializeXrayEventListeners } = await import("../domain/xray/listeners/xray-event-listener.js");
            const { initializePrefetchEventListeners } = await import("../domain/xray/listeners/prefetch-event-listener.js");
            const { startXrayWorker } = await import("../workers/xray-worker.js");
            startXrayNightlyIndexer();
            await initializeXrayEventListeners();
            await initializePrefetchEventListeners();
            const xw = startXrayWorker(); if (xw) allWorkers.push(xw);
            logger.info("✅ X-Ray Automated Indexing active");
        }

        logger.info("Domain services initialized.");

        // Graceful shutdown handlers
        const shutdown = async (signal: string) => {
            logger.info(`[WorkerManager] ${signal} received — graceful shutdown`);
            for (const worker of allWorkers) {
                try { await worker.close(); } catch {}
            }
            process.exit(0);
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
    }

    private static async startMissionSupportServices(): Promise<void> {
        try {
            const { telemetryProcessor } = await import("@domain/rescue/core/telemetry-processor.js");
            telemetryProcessor.start().catch((err: any) => logger.error("Telemetry Processor failed to start", { err }));

            const { startQMDWorker } = await import("../domain/mission/core/qmd-worker.js");
            startQMDWorker().catch((err: any) => logger.error("QMD Worker failed to start", { err }));

            const { governanceAgentService } = await import("@domain/mission/core/governance-agent.service.js");
            governanceAgentService.start(300000); 

            const { reactiveOrchestratorService } = await import("../domain/mission/core/reactive-orchestrator.service.js");
            await reactiveOrchestratorService.initializeActiveListeners().catch((err: any) => logger.error("Reactive listeners failed to initialize", { err }));
        } catch (e) {
            logger.warn("Some mission support services failed to initialize");
        }
    }

    private static startAgenticHrMonitor(): void {
        const RUN_INTERVAL_MS = 60 * 60 * 1000; // hourly
        const run = async () => {
            try {
                const { db } = await import("../database_service.js");
                const { orgs } = await import("@shared/schema/index.js");
                const { AgenticHRService } = await import("../domain/governor/core/agentic-hr.service.js");
                const orgRows = await db.select({ id: orgs.id }).from(orgs).limit(50);
                await Promise.allSettled(orgRows.map(o => AgenticHRService.monitorPerformance(o.id)));
                logger.info(`[AgenticHR] Performance audit completed for ${orgRows.length} org(s)`);
            } catch (err: any) {
                logger.warn(`[AgenticHR] Monitor run failed: ${err.message}`);
            }
        };
        // Run once at startup (non-blocking), then hourly
        setTimeout(() => {
            run();
            setInterval(run, RUN_INTERVAL_MS);
        }, 30_000); // 30s delay to let DB settle after boot
        logger.info("✅ Agentic HR Monitor scheduled (hourly)");
    }
}
