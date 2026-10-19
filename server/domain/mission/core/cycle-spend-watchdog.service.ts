/**
 * Cycle Spend Rate Watchdog
 *
 * Proactively monitors budget consumption velocity for active cycles.
 * Unlike StrategicSentinel.enforceFiscalGuardrails (which triggers AFTER breach),
 * this watchdog forecasts exhaustion and throttles before the limit is hit.
 *
 * Thresholds:
 *   70% spend  → warn, emit cycle.spend_warning
 *   85% spend  → throttle (increase cycle priority number to slow resource allocation)
 *   95% spend  → escalate + notify fleet
 *
 * Burn-rate forecast: if endDate is known, uses projected total = spend + (burnRate × hoursRemaining).
 * Without endDate, uses absolute spend thresholds only.
 */

import { db } from "@server/database_service.js";
import { operationalCycles, missionRuns, aiUsageLogs } from "@shared/schema/index.js";
import { eq, and, isNull, sql, inArray } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";

const logger = createLogger("CycleSpendWatchdog");

export type SpendAlert = 'warn' | 'throttle' | 'escalate';

export interface SpendAssessment {
    cycleId: number;
    currentSpend: number;
    budgetLimit: number;
    spendPct: number;
    burnRatePerHour: number;
    forecastedTotal: number | null;
    alert: SpendAlert | null;
}

export class CycleSpendWatchdogService {
    /**
     * Entry point — called by the heartbeat every 5 ticks (5 minutes).
     */
    static async check(): Promise<void> {
        const cycles = await db.select({
            id: operationalCycles.id,
            name: operationalCycles.name,
            organizationId: operationalCycles.organizationId,
            budgetLimitUsd: operationalCycles.budgetLimitUsd,
            currentSpendUsd: operationalCycles.currentSpendUsd,
            priority: operationalCycles.priority,
            startDate: operationalCycles.startDate,
            endDate: operationalCycles.endDate,
        })
        .from(operationalCycles)
        .where(and(
            eq(operationalCycles.status, 'active'),
            isNull(operationalCycles.deletedAt),
            sql`${operationalCycles.budgetLimitUsd}::numeric > 0`
        ));

        if (cycles.length === 0) return;

        const cycleIds = cycles.map(c => c.id);

        // Batch: one cost aggregation query for ALL cycles instead of N individual queries
        const costRows = await db.select({
            cycleId: missionRuns.cycleId,
            total: sql<string>`coalesce(sum(${aiUsageLogs.costUsd}::numeric), 0)`,
        })
        .from(aiUsageLogs)
        .innerJoin(missionRuns, eq(aiUsageLogs.executionId, missionRuns.pipelineExecutionId))
        .where(and(inArray(missionRuns.cycleId, cycleIds), isNull(missionRuns.deletedAt)))
        .groupBy(missionRuns.cycleId);

        const spendByCycle = new Map(costRows.map(r => [r.cycleId, parseFloat(String(r.total))]));

        await Promise.all(cycles.map(async cycle => {
            try {
                await this.assessCycle(cycle, spendByCycle.get(cycle.id) ?? 0);
            } catch (err: any) {
                logger.warn(`[SpendWatchdog] Assessment failed for cycle ${cycle.id}: ${err.message}`);
            }
        }));
    }

    static async assessCycle(cycle: any, currentSpend?: number): Promise<SpendAssessment> {
        const budgetLimit = parseFloat(String(cycle.budgetLimitUsd || 0));
        if (budgetLimit <= 0) return { cycleId: cycle.id, currentSpend: 0, budgetLimit: 0, spendPct: 0, burnRatePerHour: 0, forecastedTotal: null, alert: null };
        if (currentSpend == null) {
            const [costRow] = await db.select({
                total: sql<string>`coalesce(sum(${aiUsageLogs.costUsd}::numeric), 0)`,
            })
            .from(aiUsageLogs)
            .innerJoin(missionRuns, eq(aiUsageLogs.executionId, missionRuns.pipelineExecutionId))
            .where(and(eq(missionRuns.cycleId, cycle.id), isNull(missionRuns.deletedAt)));

            currentSpend = parseFloat(String(costRow?.total ?? 0));
        }
        const spendPct = (currentSpend / budgetLimit) * 100;
        // Burn rate: dollars per hour since cycle start
        const hoursElapsed = Math.max(0.1, (Date.now() - new Date(cycle.startDate).getTime()) / 3600000);
        const burnRatePerHour = currentSpend / hoursElapsed;

        // Forecast total if endDate is known
        let forecastedTotal: number | null = null;
        if (cycle.endDate) {
            const hoursRemaining = Math.max(0, (new Date(cycle.endDate).getTime() - Date.now()) / 3600000);
            forecastedTotal = currentSpend + burnRatePerHour * hoursRemaining;
        }

        // Persist live spend back to cycles table for quick reads
        await db.update(operationalCycles)
            .set({ currentSpendUsd: String(currentSpend.toFixed(4)) as any })
            .where(eq(operationalCycles.id, cycle.id));

        // Determine alert level
        let alert: SpendAlert | null = null;
        const forecastRatio = forecastedTotal ? forecastedTotal / budgetLimit : null;

        if (spendPct >= 95 || (forecastRatio && forecastRatio >= 1.1)) {
            alert = 'escalate';
        } else if (spendPct >= 85 || (forecastRatio && forecastRatio >= 0.95)) {
            alert = 'throttle';
        } else if (spendPct >= 70 || (forecastRatio && forecastRatio >= 0.85)) {
            alert = 'warn';
        }

        const assessment: SpendAssessment = {
            cycleId: cycle.id,
            currentSpend,
            budgetLimit,
            spendPct: Math.round(spendPct * 10) / 10,
            burnRatePerHour: Math.round(burnRatePerHour * 100) / 100,
            forecastedTotal: forecastedTotal ? Math.round(forecastedTotal * 100) / 100 : null,
            alert,
        };

        if (alert) {
            logger.warn(`[SpendWatchdog] Cycle ${cycle.id} (${cycle.name}): ${alert.toUpperCase()} — ${spendPct.toFixed(1)}% of $${budgetLimit} used, burn rate $${burnRatePerHour.toFixed(2)}/h`);

            // Emit event
            eventStream.publish('cycle.spend_alert', {
                ...assessment,
                cycleName: cycle.name,
            }, {
                organizationId: cycle.organizationId ?? undefined,
                subject: `cycle:${cycle.id}`,
            }, 'spend-watchdog').catch(() => {});

            if (alert === 'throttle') {
                // Increase priority number (lower urgency) to slow resource allocation
                const throttledPriority = Math.min(10, (cycle.priority ?? 5) + 2);
                await db.update(operationalCycles)
                    .set({ priority: throttledPriority, updatedAt: new Date() })
                    .where(eq(operationalCycles.id, cycle.id));
                logger.info(`[SpendWatchdog] Cycle ${cycle.id} throttled to priority ${throttledPriority}`);
            }

            if (alert === 'escalate') {
                import("./cycle-manager.service.js").then(({ CycleManagerService }) =>
                    CycleManagerService.notifyFleetEvent(
                        cycle.organizationId,
                        'Budget Escalation Alert',
                        `Cycle *${cycle.name}* has consumed ${spendPct.toFixed(1)}% of its $${budgetLimit} budget. Burn rate: $${burnRatePerHour.toFixed(2)}/h.${forecastedTotal ? ` Forecasted total: $${forecastedTotal.toFixed(2)}.` : ''}`,
                        'error'
                    )
                ).catch(() => {});
            }
        }

        return assessment;
    }
}
