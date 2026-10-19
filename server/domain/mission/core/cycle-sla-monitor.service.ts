/**
 * Cycle SLA Monitor
 *
 * Checks all active cycles with an endDate against their completion progress.
 * Emits warnings and escalations when a cycle is at risk of missing its deadline,
 * and marks cycles as 'overdue' when the endDate has passed without completion.
 *
 * Risk tiers:
 *   AT_RISK   — > 60% of time elapsed, < 40% of blueprints complete
 *   CRITICAL  — > 80% of time elapsed, < 60% of blueprints complete
 *   OVERDUE   — endDate has passed, cycle still active
 */

import { db } from "@server/database_service.js";
import { operationalCycles, missionRuns } from "@shared/schema/index.js";
import { eq, and, isNull, sql, inArray } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";

const logger = createLogger("CycleSLAMonitor");

export type SLAStatus = 'on_track' | 'at_risk' | 'critical' | 'overdue';

export interface SLAAssessment {
    cycleId: number;
    cycleName: string;
    slaStatus: SLAStatus;
    timeElapsedPct: number;
    completionPct: number;
    hoursRemaining: number | null;
    recommendation: string;
}

export class CycleSLAMonitorService {
    /**
     * Entry point — called by the heartbeat every 15 ticks (15 minutes).
     */
    static async check(): Promise<void> {
        const cycles = await db.select({
            id: operationalCycles.id,
            name: operationalCycles.name,
            objective: operationalCycles.objective,
            startDate: operationalCycles.startDate,
            endDate: operationalCycles.endDate,
            blueprintCount: operationalCycles.blueprintCount,
            organizationId: operationalCycles.organizationId,
            metadata: operationalCycles.metadata,
        })
        .from(operationalCycles)
        .where(and(
            eq(operationalCycles.status, 'active'),
            isNull(operationalCycles.deletedAt),
            sql`${operationalCycles.endDate} IS NOT NULL`
        ));

        if (cycles.length === 0) return;

        const cycleIds = cycles.map(c => c.id);

        // Batch: one run-stats query for ALL deadline cycles instead of N individual queries
        const runStatRows = await db.select({
            cycleId: missionRuns.cycleId,
            total: sql<number>`count(*)::int`,
            completed: sql<number>`count(*) filter (where ${missionRuns.status} = 'completed')::int`,
        })
        .from(missionRuns)
        .where(and(inArray(missionRuns.cycleId, cycleIds), isNull(missionRuns.deletedAt)))
        .groupBy(missionRuns.cycleId);

        const runStatsByCycle = new Map(runStatRows.map(r => [r.cycleId, r]));

        await Promise.all(cycles.map(async cycle => {
            try {
                await this.assessCycle(cycle, runStatsByCycle.get(cycle.id));
            } catch (err: any) {
                logger.warn(`[SLAMonitor] Assessment failed for cycle ${cycle.id}: ${err.message}`);
            }
        }));
    }

    static async assessCycle(
        cycle: any,
        runStats?: { total: number; completed: number } | null
    ): Promise<SLAAssessment> {
        const now = Date.now();
        const startMs = new Date(cycle.startDate).getTime();
        const endMs = new Date(cycle.endDate).getTime();
        const totalMs = endMs - startMs;
        const elapsedMs = now - startMs;
        const remainingMs = endMs - now;

        const timeElapsedPct = totalMs > 0 ? Math.min(100, (elapsedMs / totalMs) * 100) : 0;
        const hoursRemaining = remainingMs > 0 ? remainingMs / 3600000 : 0;

        const totalBlueprints = cycle.blueprintCount || runStats?.total || 1;
        const completedCount = runStats?.completed ?? 0;

        const completionPct = (completedCount / totalBlueprints) * 100;

        let slaStatus: SLAStatus;
        let recommendation: string;

        if (remainingMs <= 0) {
            slaStatus = 'overdue';
            recommendation = 'Cycle has exceeded its deadline. Consider aborting or extending the end date.';
        } else if (timeElapsedPct > 80 && completionPct < 60) {
            slaStatus = 'critical';
            recommendation = `Only ${Math.round(hoursRemaining)}h remaining with ${Math.round(completionPct)}% complete. Consider parallelising remaining blueprints or pausing low-priority missions.`;
        } else if (timeElapsedPct > 60 && completionPct < 40) {
            slaStatus = 'at_risk';
            recommendation = `${Math.round(100 - timeElapsedPct)}% of time remains but only ${Math.round(completionPct)}% complete. Monitor closely.`;
        } else {
            slaStatus = 'on_track';
            recommendation = 'Cycle is progressing within its SLA window.';
        }

        const assessment: SLAAssessment = {
            cycleId: cycle.id,
            cycleName: cycle.name,
            slaStatus,
            timeElapsedPct: Math.round(timeElapsedPct),
            completionPct: Math.round(completionPct),
            hoursRemaining: remainingMs > 0 ? Math.round(hoursRemaining * 10) / 10 : null,
            recommendation,
        };

        if (slaStatus !== 'on_track') {
            logger.warn(`[SLAMonitor] Cycle ${cycle.id} (${cycle.name}): ${slaStatus.toUpperCase()} — ${recommendation}`);

            // Persist SLA status and conditionally flip overdue cycles in one UPDATE
            await db.update(operationalCycles)
                .set({
                    metadata: sql`${operationalCycles.metadata} || jsonb_build_object('slaStatus', ${slaStatus}::text, 'slaCheckedAt', ${new Date().toISOString()}::text)`,
                    ...(slaStatus === 'overdue' ? { status: 'reviewing' as any } : {}),
                    updatedAt: new Date(),
                })
                .where(and(
                    eq(operationalCycles.id, cycle.id),
                    ...(slaStatus === 'overdue' ? [eq(operationalCycles.status, 'active')] : [])
                ));

            // Emit event for real-time UI + webhook delivery
            eventStream.publish(`cycle.sla_${slaStatus}`, {
                ...assessment,
            }, {
                organizationId: cycle.organizationId ?? undefined,
                subject: `cycle:${cycle.id}`,
            }, 'sla-monitor').catch(() => {});

            // Notify via Slack for critical/overdue
            if (slaStatus === 'critical' || slaStatus === 'overdue') {
                import("./cycle-manager.service.js").then(({ CycleManagerService }) =>
                    CycleManagerService.notifyFleetEvent(
                        cycle.organizationId,
                        slaStatus === 'overdue' ? 'Cycle Overdue' : 'Cycle SLA Critical',
                        `*${cycle.name}*: ${recommendation}`,
                        slaStatus === 'overdue' ? 'error' : 'warn'
                    )
                ).catch(() => {});
            }
        }

        return assessment;
    }
}
