import { db } from "@server/database_service.js";
import {
    pipelines,
    pipelineExecutions,
    pipelineStepExecutions,
    pipelineSteps,
} from "@shared/schema/index.js";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { NotFoundError } from "@server/utils/errors.js";
import { withQueryTracking } from "@domain/knowledge/core/query-monitor.service.js";
import type { OrgContext } from "./types.js";
import { pipelineEngine } from "./pipeline-engine.js";

export const pipelineAnalytics = {
    /**
     * Get pipeline execution statistics
     */
    async getStats(pipelineId: number, orgContext: OrgContext) {
        return withQueryTracking("pipelineService.getStats", async () => {
            await pipelineEngine.getById(pipelineId, orgContext);

            const lastExecutions = await db
                .select({
                    id: pipelineExecutions.id,
                    startedAt: pipelineExecutions.startedAt,
                    completedAt: pipelineExecutions.completedAt,
                })
                .from(pipelineExecutions)
                .where(
                    and(
                        eq(pipelineExecutions.pipelineId, pipelineId),
                        eq(pipelineExecutions.status, 'completed')
                    )
                )
                .orderBy(desc(pipelineExecutions.startedAt))
                .limit(10);

            if (lastExecutions.length === 0) {
                return {
                    runCount: 0,
                    averageTotalDuration: null,
                    stepAverages: {}
                };
            }

            let totalDurationSum = 0;
            let validDurationCount = 0;

            for (const exec of lastExecutions) {
                if (exec.startedAt && exec.completedAt) {
                    const duration = new Date(exec.completedAt).getTime() - new Date(exec.startedAt).getTime();
                    totalDurationSum += duration;
                    validDurationCount++;
                }
            }

            const averageTotalDuration = validDurationCount > 0
                ? Math.round((totalDurationSum / validDurationCount) / 1000)
                : null;

            const executionIds = lastExecutions.map(e => e.id);

            const stepStats = await db
                .select({
                    stepOrder: pipelineStepExecutions.stepOrder,
                    avgDuration: sql<number>`AVG(EXTRACT(EPOCH FROM (${pipelineStepExecutions.completedAt} - ${pipelineStepExecutions.executedAt})))`
                })
                .from(pipelineStepExecutions)
                .where(
                    and(
                        inArray(pipelineStepExecutions.pipelineExecutionId, executionIds),
                        eq(pipelineStepExecutions.status, 'success')
                    )
                )
                .groupBy(pipelineStepExecutions.stepOrder);

            const stepAverages: Record<number, number> = {};
            stepStats.forEach(stat => {
                stepAverages[stat.stepOrder] = Math.round(Number(stat.avgDuration));
            });

            return {
                runCount: validDurationCount,
                averageTotalDuration,
                stepAverages
            };
        }, { table: "pipeline_executions", operation: "select" });
    },

    /**
     * Get Cost Analytics for a pipeline
     */
    async getCostAnalytics(pipelineId: number, orgContext: OrgContext): Promise<any> {
        return withQueryTracking("pipelineService.getCostAnalytics", async () => {
            const pipeline = await pipelineEngine.getById(pipelineId, orgContext);
            const { getPipelineCurrentMonthSpend, getPipelineDailySpend } = await import("@domain/admin/core/analytics.service.js");

            const currentMonthSpend = await getPipelineCurrentMonthSpend(pipelineId);
            const budget = pipeline.monthlyBudgetUsd ? parseFloat(pipeline.monthlyBudgetUsd) : null;
            const dailyCosts = await getPipelineDailySpend(pipelineId, 30);

            return {
                pipelineId,
                currentMonthSpend,
                budget,
                dailyCosts,
                budgetRemaining: budget ? Math.max(0, budget - currentMonthSpend) : null,
                budgetPercentage: budget ? (currentMonthSpend / budget) * 100 : null,
            };
        }, { table: "ai_usage_logs", operation: "select" });
    },

    /**
     * Discover available variables for a pipeline step
     */
    async discoverVariables(pipelineId: number, orgContext: OrgContext, options: { stepOrder?: number } = {}): Promise<any[]> {
        const { jobs } = await import("@shared/schema/index.js");
        return withQueryTracking("pipelineService.discoverVariables", async () => {
            await pipelineEngine.getById(pipelineId, orgContext);

            const steps = await db
                .select({
                    id: pipelineSteps.id,
                    order: pipelineSteps.order,
                    outputName: pipelineSteps.outputName,
                    jobName: jobs.name,
                    jobType: jobs.type,
                    jobConfig: jobs.config,
                    jobOutputSchema: jobs.outputSchema,
                })
                .from(pipelineSteps)
                .leftJoin(jobs, eq(pipelineSteps.jobId, jobs.id))
                .where(eq(pipelineSteps.pipelineId, pipelineId))
                .orderBy(pipelineSteps.order);

            let previousStepOutputs: { stepOrder: number; stepName?: string; output: any; outputName?: string }[] = [];

            const [latestExec] = await db
                .select({ id: pipelineExecutions.id })
                .from(pipelineExecutions)
                .where(and(
                    eq(pipelineExecutions.pipelineId, pipelineId),
                    eq(pipelineExecutions.status, 'completed')
                ))
                .orderBy(desc(pipelineExecutions.startedAt))
                .limit(1);

            if (latestExec) {
                const stepExecs = await db
                    .select({
                        stepOrder: pipelineStepExecutions.stepOrder,
                        output: pipelineStepExecutions.output,
                        outputName: pipelineStepExecutions.outputName,
                    })
                    .from(pipelineStepExecutions)
                    .where(and(
                        eq(pipelineStepExecutions.pipelineExecutionId, latestExec.id),
                        eq(pipelineStepExecutions.status, 'success')
                    ))
                    .orderBy(pipelineStepExecutions.stepOrder);

                previousStepOutputs = stepExecs.map(se => {
                    const step = steps.find(s => s.order === se.stepOrder);
                    return {
                        stepOrder: se.stepOrder,
                        stepName: step?.jobName || undefined,
                        output: se.output,
                        outputName: se.outputName || step?.outputName || undefined,
                    };
                });
            } else {
                previousStepOutputs = steps.map(step => {
                    let output = step.jobOutputSchema || null;

                    // Fallback for Form Agents: use fields from config
                    if (!output && step.jobType === 'form_agent' && (step.jobConfig as any)?.formSchema?.fields) {
                        const fields = (step.jobConfig as any).formSchema.fields;
                        const mockOutput: Record<string, any> = {};
                        fields.forEach((f: any) => {
                            mockOutput[f.key] = f.defaultValue || (f.type === 'number' ? 0 : f.type === 'boolean' ? false : "Sample Value");
                        });
                        output = mockOutput;
                    }

                    return {
                        stepOrder: step.order,
                        stepName: step.jobName || undefined,
                        output,
                        outputName: step.outputName || undefined,
                    };
                });
            }

            const { discoverAvailableVariables } = await import('@shared/utils/variableDiscovery.js');

            return discoverAvailableVariables({
                pipelineId,
                currentStepOrder: options.stepOrder,
                previousStepOutputs,
                isInIterator: false,
                initialVariables: {},
            });
        }, { table: "pipeline_steps", operation: "select" });
    },

    async getRunSchemaDiff(stepExecutionId: number) {
        return withQueryTracking("pipelineService.getRunSchemaDiff", async () => {
            const [currentExec] = await db
                .select()
                .from(pipelineStepExecutions)
                .where(eq(pipelineStepExecutions.id, stepExecutionId))
                .limit(1);

            if (!currentExec) {
                throw new NotFoundError("Step execution not found");
            }

            if (!currentExec.outputSchema) {
                return { hasChanges: false, reason: "No schema captured for this execution" };
            }

            const [baselineExec] = await db
                .select()
                .from(pipelineStepExecutions)
                .where(and(
                    eq(pipelineStepExecutions.pipelineStepId, currentExec.pipelineStepId),
                    eq(pipelineStepExecutions.status, 'success'),
                    sql`${pipelineStepExecutions.id} < ${stepExecutionId}`,
                    sql`${pipelineStepExecutions.outputSchema} IS NOT NULL`
                ))
                .orderBy(desc(pipelineStepExecutions.id))
                .limit(1);

            if (!baselineExec) {
                return { hasChanges: false, reason: "No previous successful run found for comparison" };
            }

            const { schemaComparisonService } = await import("@domain/knowledge/core/schema-comparison.service.js");

            const diff = schemaComparisonService.compare(
                baselineExec.outputSchema as any,
                currentExec.outputSchema as any
            );

            return {
                ...diff,
                baselineId: baselineExec.id,
                currentId: currentExec.id
            };
        }, { table: "pipeline_step_executions", operation: "select" });
    },
};


