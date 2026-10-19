import { Worker, Queue } from "bullmq";
import { getRedisOptions } from "@server/domain/core/infrastructure/redis/redis-client.js";

const connectionOpts = { ...getRedisOptions(), maxRetriesPerRequest: null };
import { createLogger } from "@server/utils/logger.js";
import { CycleSchedulerService } from "@server/domain/mission/core/cycle-scheduler.service.js";
import { CyclePriorityOrchestratorService } from "@server/domain/mission/core/cycle-priority-orchestrator.service.js";
import { CycleSLAMonitorService } from "@server/domain/mission/core/cycle-sla-monitor.service.js";
import { CycleSpendWatchdogService } from "@server/domain/mission/core/cycle-spend-watchdog.service.js";
import { cycleHILCoordinatorService } from "@server/domain/mission/core/cycle-hil-coordinator.service.js";
import { cycleDependencyGatewayService } from "@server/domain/mission/core/cycle-dependency-gateway.service.js";
import { EscalationService } from "@server/domain/mission/core/escalation.service.js";
import { registerWorker, ensureShutdownHandlers } from "@server/utils/graceful-shutdown.js";
ensureShutdownHandlers();

const logger = createLogger("CycleWorker");
const QUEUE_NAME = "cycle-operations";

/**
 * Initializes the repeatable heartbeat for cycles.
 */
export async function initCycleScheduler() {
    const queue = new Queue(QUEUE_NAME, { connection: connectionOpts });

    await queue.add("heartbeat", { type: "HEARTBEAT" }, {
        repeat: { every: 60000 }, // 1 minute
        removeOnComplete: true,
        removeOnFail: true
    });

    logger.info(`[Scheduler] Cycle heartbeat initialized (1m interval).`);
}

/**
 * Runs once at startup: replays dependency gate signals for any gates
 * whose upstream missions completed while the server was down.
 */
export async function initCycleSupervisors() {
    await cycleDependencyGatewayService.resumeStuckGates();
    const { CycleManagerService } = await import("@server/domain/mission/core/cycle-manager.service.js");
    const recoveredAppSteps = await CycleManagerService.recoverWaitingAppSteps();
    logger.info(`[CycleWorker] Supervisor init complete; resumed ${recoveredAppSteps} cycle(s) waiting on Workbench apps.`);
}

let heartbeatTick = 0;

export function startCycleWorker() {
    logger.info(`[Worker] Starting Cycle Operational Worker on queue: ${QUEUE_NAME}`);

    const worker = new Worker(QUEUE_NAME, async (job) => {
        const { type } = job.data;

        try {
            switch (type) {
                case 'HEARTBEAT':
                    heartbeatTick++;

                    // Every tick (1m): recurrence triggers + HIL checks + escalations
                    await CycleSchedulerService.checkAndTriggerCycles();
                    await cycleHILCoordinatorService.checkPendingHILRequests();
                    await EscalationService.checkEscalations();

                    // Every 5 ticks (5m): drift detection + priority rebalancing + spend watchdog
                    if (heartbeatTick % 5 === 0) {
                        await CycleSchedulerService.checkDrift(heartbeatTick);
                        await CyclePriorityOrchestratorService.rebalance();
                        await CycleSpendWatchdogService.check();
                    }

                    // Every 15 ticks (15m): SLA deadline monitoring
                    if (heartbeatTick % 15 === 0) {
                        await CycleSLAMonitorService.check();
                    }

                    // Every 15 ticks (15m): dialectic user-representation reconciliation
                    // Runs as background-priority AI work — yields under quota pressure.
                    if (heartbeatTick % 15 === 0) {
                        try {
                            const { userRepresentationService } = await import("@server/domain/agents/core/user-representation.service.js");
                            const stats = await userRepresentationService.runReconciliationBatch();
                            if (stats.processed > 0) {
                                logger.info(`[Worker] Dialectic batch: ${stats.updated}/${stats.processed} reconciled.`);
                            }
                        } catch (err: any) {
                            logger.warn(`[Worker] Dialectic batch failed: ${err.message}`);
                        }
                    }

                    // Every 15 ticks (15m): Theory of Mind temporal decay batch
                    // Archives entries whose effective confidence has dropped below threshold.
                    if (heartbeatTick % 15 === 0) {
                        try {
                            const { theoryOfMindService } = await import("@server/domain/agents/core/theory-of-mind.service.js");
                            const stats = await theoryOfMindService.runDecayBatch();
                            if (stats.archived > 0) {
                                logger.info(`[Worker] ToM decay batch: ${stats.archived} entries archived from ${stats.processed} users.`);
                            }
                        } catch (err: any) {
                            logger.warn(`[Worker] ToM decay batch failed: ${err.message}`);
                        }
                    }

                    break;

                case 'EXECUTE_CYCLE': {
                    const { cycleId, orgId } = job.data;
                    const { CycleManagerService } = await import("@server/domain/mission/core/cycle-manager.service.js");
                    await CycleManagerService.synthesizeCycle(cycleId, orgId);
                    break;
                }

                default:
                    logger.warn(`[Worker] Unknown job type: ${type}`);
            }
        } catch (err: any) {
            logger.error(`[Worker] Job ${job.id} failed: ${err.message}`);
            throw err;
        }
    }, {
        connection: connectionOpts,
        concurrency: parseInt(process.env.CYCLE_CONCURRENCY || "6", 10),
    });

    worker.on("completed", (job) => {
        logger.debug(`[Worker] Cycle job ${job.id} completed.`);
    });

    worker.on("failed", (job, err) => {
        logger.error(`[Worker] Cycle job ${job?.id} failed: ${err.message}`);
    });

    registerWorker({ close: () => worker.close() }, "CycleWorker");
    return worker;
}
