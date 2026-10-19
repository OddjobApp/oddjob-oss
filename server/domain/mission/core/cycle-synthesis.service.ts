
import { db } from "@server/database_service.js";
import { operationalCycles, missionRuns, aiUsageLogs, cycleTemplates } from "@shared/schema/index.js";
import { eq, sum } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";

const logger = createLogger("CycleSynthesis");

function emitCycleEvent(eventType: string, cycleId: number, orgId: number | null, payload: Record<string, unknown> = {}) {
    eventStream.publish(eventType, { cycleId, ...payload }, {
        organizationId: orgId ?? undefined,
        subject: `cycle:${cycleId}`,
    }, 'cycle-synthesis').catch(() => {});
}

export class CycleSynthesisService {
    static async calculateCycleSpend(cycleId: number): Promise<number> {
        const result = await db.select({ totalCost: sum(aiUsageLogs.costUsd) })
            .from(aiUsageLogs)
            .innerJoin(missionRuns, eq(aiUsageLogs.executionId, missionRuns.pipelineExecutionId))
            .where(eq(missionRuns.cycleId, cycleId));
        return result[0]?.totalCost ? parseFloat(result[0].totalCost) : 0;
    }

    static async calculateCycleTokens(cycleId: number): Promise<number> {
        const result = await db.select({ totalTokens: sum(aiUsageLogs.totalTokens) })
            .from(aiUsageLogs)
            .innerJoin(missionRuns, eq(aiUsageLogs.executionId, missionRuns.pipelineExecutionId))
            .where(eq(missionRuns.cycleId, cycleId));
        return result[0]?.totalTokens ? parseInt(String(result[0].totalTokens)) : 0;
    }

    static async synthesize(cycleId: number, orgId: number | null, notifyFleetEvent: (orgId: number | null, title: string, msg: string) => Promise<void>) {
        const [cycle] = await db.select().from(operationalCycles).where(eq(operationalCycles.id, cycleId)).limit(1);
        if (!cycle) return;

        logger.info(`[CycleSynthesis] Synthesizing Cycle ${cycleId}`);

        const runs = await db.select().from(missionRuns).where(eq(missionRuns.cycleId, cycleId));
        const totalRuns = runs.length;
        const completedRuns = runs.filter(r => r.status === 'completed').length;
        const failedRuns = runs.filter(r => r.status === 'failed').length;
        const totalSpend = await this.calculateCycleSpend(cycleId);
        const totalTokens = await this.calculateCycleTokens(cycleId);

        const outcomeMetrics = {
            totalRuns,
            completedRuns,
            failedRuns,
            successRate: totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 0,
            totalSpend,
            totalTokens,
            synthesizedAt: new Date().toISOString(),
        };

        let summaryReport: string | null = null;
        try {
            const traceSnippets = runs
                .filter(r => r.dynamicTrace)
                .map(r => {
                    const traces = (r.dynamicTrace as any[]) || [];
                    const significant = traces
                        .filter((t: any) => ['reflection', 'critic', 'strategist', 'system_summary'].includes(t.type))
                        .slice(-5)
                        .map((t: any) => `[${t.type}] ${t.note || t.event}`)
                        .join('\n');
                    return significant ? `Run #${r.id} (${r.status}):\n${significant}` : null;
                })
                .filter(Boolean)
                .join('\n\n');

            if (traceSnippets) {
                const { LocalSLMService } = await import("@domain/ai/core/local-slm.service.js");
                summaryReport = await LocalSLMService.execute(
                    'summarize',
                    `You are a strategic analyst. Summarize the outcomes of this autonomous fleet operation in 3-5 bullet points.\n\nObjective: ${cycle.objective}\n\nMission Traces:\n${traceSnippets}\n\nMetrics: ${completedRuns}/${totalRuns} missions completed, $${totalSpend.toFixed(2)} spent.\n\nReturn a concise markdown bullet-point summary.`,
                    true
                );
            }
        } catch (err: any) {
            logger.warn(`[CycleSynthesis] LLM summary failed for ${cycleId}: ${err.message}`);
        }

        const finalMetrics = { ...outcomeMetrics, summaryReport };
        const finalStatus = summaryReport ? 'closed' : 'reviewing';

        await db.update(operationalCycles)
            .set({ status: finalStatus, outcomeMetrics: finalMetrics, updatedAt: new Date() })
            .where(eq(operationalCycles.id, cycleId));

        emitCycleEvent('cycle.status_changed', cycleId, orgId, { status: finalStatus, outcomeMetrics: finalMetrics });
        logger.info(`[CycleSynthesis] Cycle ${cycleId} → ${finalStatus}`);

        await notifyFleetEvent(
            orgId,
            finalStatus === 'closed' ? "Cycle Complete" : "Cycle Ready for Review",
            summaryReport
                ? `Cycle ${cycleId} closed.\n\n${summaryReport}`
                : `Cycle ${cycleId} completed. ${completedRuns}/${totalRuns} missions succeeded. Spend: $${totalSpend.toFixed(2)}.`
        );

        try {
            const { CycleSchedulerService } = await import("./cycle-scheduler.service.js");
            await CycleSchedulerService.handleCycleCompleted(cycleId, { finalStatus, outcomeMetrics: finalMetrics });
        } catch (err: any) {
            logger.warn(`[CycleSynthesis] Completion scheduling failed for cycle ${cycleId}: ${err.message}`);
        }

        // Strategic chaining: Accumulate parent cycle context from completed runs
        const parentCycleContext: Record<string, any> = {};
        for (const run of runs) {
            if (run.status === 'completed') {
                const runContext = (run.missionContext as any) || {};
                
                // Merge everything in run.missionContext
                for (const [key, val] of Object.entries(runContext)) {
                    if (key === 'blackboard' && val && typeof val === 'object') {
                        Object.assign(parentCycleContext, val);
                    } else {
                        parentCycleContext[key] = val;
                    }
                }
                
                // Also fetch deliverables
                try {
                    const { missionDeliverables } = await import("@shared/schema/index.js");
                    const deliverables = await db.select()
                        .from(missionDeliverables)
                        .where(eq(missionDeliverables.missionRunId, run.id));
                    for (const del of deliverables) {
                        if (del.name) {
                            const nameKey = del.name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
                            parentCycleContext[nameKey] = del.content;
                        }
                    }
                } catch (err) {
                    logger.warn(`[CycleSynthesis] Failed to fetch deliverables for run ${run.id}: ${err}`);
                }
            }
        }

        const metadata = (cycle.metadata as any) || {};
        if (metadata.follow_up_cycle_template_id) {
            const [template] = await db.select().from(cycleTemplates)
                .where(eq(cycleTemplates.id, Number(metadata.follow_up_cycle_template_id)))
                .limit(1);
            if (template) {
                logger.info(`[CycleSynthesis] Launching follow-up cycle from template ${template.id} for parent cycle ${cycle.id}`);
                const { CycleManagerService } = await import("./cycle-manager.service.js");
                const childCycle = await CycleManagerService.launchCycle({
                    name: template.name,
                    description: template.description,
                    objective: template.objective,
                    blueprints: template.blueprints,
                    priority: 5,
                    budgetLimitUsd: "100.00",
                    metadata: {
                        parent_cycle_id: cycle.id,
                        parent_cycle_context: parentCycleContext
                    }
                }, cycle.createdBy, cycle.organizationId);

                if (childCycle) {
                    metadata.follow_up_cycle_id = childCycle.id;
                    await db.update(operationalCycles)
                        .set({ 
                            metadata,
                            updatedAt: new Date()
                        })
                        .where(eq(operationalCycles.id, cycle.id));
                    logger.info(`[CycleSynthesis] Linked parent cycle ${cycle.id} to child cycle ${childCycle.id}`);
                }
            } else {
                logger.warn(`[CycleSynthesis] Follow-up cycle template ${metadata.follow_up_cycle_template_id} not found.`);
            }
        } else if (metadata.follow_up_cycle) {
            const { CycleManagerService } = await import("./cycle-manager.service.js");
            const followUp = { ...metadata.follow_up_cycle };
            followUp.metadata = {
                ...(followUp.metadata || {}),
                parent_cycle_id: cycle.id,
                parent_cycle_context: parentCycleContext
            };
            const childCycle = await CycleManagerService.launchCycle(followUp, cycle.createdBy, cycle.organizationId);
            if (childCycle) {
                metadata.follow_up_cycle_id = childCycle.id;
                await db.update(operationalCycles)
                    .set({ 
                        metadata,
                        updatedAt: new Date()
                    })
                    .where(eq(operationalCycles.id, cycle.id));
                logger.info(`[CycleSynthesis] Linked parent cycle ${cycle.id} to child cycle ${childCycle.id}`);
            }
        }

        return { finalStatus, outcomeMetrics: finalMetrics };
    }
}
