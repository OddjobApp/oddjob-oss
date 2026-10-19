/**
 * Cycle Priority Orchestrator
 *
 * Runs on the heartbeat every 5 minutes and dynamically re-scores active cycles
 * based on deadline urgency, budget burn rate, and stall detection. Updates
 * both the DB priority column and the BullMQ wave-job priority for in-flight
 * missions so future work is processed in the correct order.
 *
 * Priority scale: 1 (most urgent) → 10 (least urgent), matching BullMQ semantics.
 */

import { db } from "@server/database_service.js";
import { operationalCycles, missionRuns } from "@shared/schema/index.js";
import { eq, and, isNull, sql, inArray } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { rollingWaveQueue } from "../infrastructure/rolling-wave-queue.js";

const logger = createLogger("CyclePriorityOrchestrator");

const STALL_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes with no run progress

interface PriorityAssessment {
    cycleId: number;
    previousPriority: number;
    newPriority: number;
    reason: string;
}

export class CyclePriorityOrchestratorService {
    /**
     * Entry point — called by the heartbeat every 5 ticks.
     * Re-scores all active cycles and propagates changes to queued BullMQ jobs.
     */
    static async rebalance(): Promise<void> {
        const activeCycles = await db.select({
            id: operationalCycles.id,
            priority: operationalCycles.priority,
            budgetLimitUsd: operationalCycles.budgetLimitUsd,
            currentSpendUsd: operationalCycles.currentSpendUsd,
            startDate: operationalCycles.startDate,
            endDate: operationalCycles.endDate,
            organizationId: operationalCycles.organizationId,
            metadata: operationalCycles.metadata,
        })
        .from(operationalCycles)
        .where(and(
            eq(operationalCycles.status, 'active'),
            isNull(operationalCycles.deletedAt)
        ));

        if (activeCycles.length === 0) return;

        const cycleIds = activeCycles.map(c => c.id);

        // Batch stall detection: one query for ALL cycles instead of N individual queries
        const latestActivity = await db.select({
            cycleId: missionRuns.cycleId,
            lastUpdated: sql<string>`MAX(${missionRuns.updatedAt})`,
        })
        .from(missionRuns)
        .where(and(inArray(missionRuns.cycleId, cycleIds), isNull(missionRuns.deletedAt)))
        .groupBy(missionRuns.cycleId);

        const now = Date.now();
        const stalledCycleIds = new Set<number>(
            latestActivity
                .filter(r => r.cycleId != null && now - new Date(r.lastUpdated).getTime() > STALL_THRESHOLD_MS)
                .map(r => r.cycleId!)
        );

        const changes: PriorityAssessment[] = [];
        for (const cycle of activeCycles) {
            const assessment = this.scoreCycle(cycle, stalledCycleIds.has(cycle.id));
            if (assessment.newPriority !== assessment.previousPriority) {
                changes.push(assessment);
            }
        }

        if (changes.length === 0) return;

        logger.info(`[PriorityOrchestrator] Rebalancing ${changes.length} cycles.`);

        // Parallelise all DB updates + BullMQ changes
        await Promise.all(changes.map(change => this.applyPriorityChange(change)));
    }

    /** Pure scoring — no DB queries. All data pre-loaded by rebalance(). */
    private static scoreCycle(cycle: any, stalled: boolean): PriorityAssessment {
        const basePriority = cycle.priority ?? 5;
        const reasons: string[] = [];
        let score = basePriority;

        // --- Factor 1: Deadline Urgency ---
        if (cycle.endDate) {
            const totalMs = new Date(cycle.endDate).getTime() - new Date(cycle.startDate).getTime();
            const remainingMs = new Date(cycle.endDate).getTime() - Date.now();
            const elapsed = totalMs > 0 ? 1 - (remainingMs / totalMs) : 0;

            if (remainingMs < 0) {
                score = Math.max(1, score - 4);
                reasons.push("overdue");
            } else if (elapsed > 0.8) {
                score = Math.max(1, score - 3);
                reasons.push("deadline-critical");
            } else if (elapsed > 0.6) {
                score = Math.max(1, score - 2);
                reasons.push("deadline-approaching");
            } else if (elapsed > 0.4) {
                score = Math.max(1, score - 1);
                reasons.push("deadline-near");
            }
        }

        // --- Factor 2: Budget Burn Risk ---
        const budgetLimit = parseFloat(String(cycle.budgetLimitUsd || 0));
        const currentSpend = parseFloat(String(cycle.currentSpendUsd || 0));
        if (budgetLimit > 0) {
            const burnRatio = currentSpend / budgetLimit;
            if (burnRatio > 0.9) {
                score = Math.min(10, score + 2);
                reasons.push("budget-near-cap");
            } else if (burnRatio > 0.7) {
                score = Math.min(10, score + 1);
                reasons.push("budget-watch");
            }
        }

        // --- Factor 3: Stall (pre-computed by caller) ---
        if (stalled) {
            score = Math.min(10, score + 2);
            reasons.push("stalled");
        }

        return {
            cycleId: cycle.id,
            previousPriority: basePriority,
            newPriority: Math.max(1, Math.min(10, score)),
            reason: reasons.join(", ") || "periodic-rebalance",
        };
    }

    private static async applyPriorityChange(change: PriorityAssessment): Promise<void> {
        const { cycleId, newPriority, reason } = change;

        // 1. Persist to DB
        await db.update(operationalCycles)
            .set({ priority: newPriority, updatedAt: new Date() })
            .where(eq(operationalCycles.id, cycleId));

        // 2. Batch-fetch active runs then update BullMQ priorities in parallel
        const activeRuns = await db.select({ id: missionRuns.id })
            .from(missionRuns)
            .where(and(
                eq(missionRuns.cycleId, cycleId),
                eq(missionRuns.status, 'active'),
                isNull(missionRuns.deletedAt)
            ));

        await Promise.all(activeRuns.map(async run => {
            const job = await rollingWaveQueue.getJob(`wave-${run.id}`);
            if (job) await job.changePriority({ priority: newPriority }).catch(() => {});
        }));

        logger.info(`[PriorityOrchestrator] Cycle ${cycleId}: ${change.previousPriority} → ${newPriority} (${reason})`);

        eventStream.publish('cycle.priority_changed', {
            cycleId,
            previousPriority: change.previousPriority,
            newPriority,
            reason,
        }, { subject: `cycle:${cycleId}` }, 'priority-orchestrator').catch(() => {});
    }
}
