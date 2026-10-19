import { db } from "@server/database_service.js";
import { pipelineExecutions, pipelineStepExecutions, aiUsageLogs, jobs } from "@shared/schema/index.js";
import { eq, desc, sql, and, gte, lt } from "drizzle-orm";

export class ROIService {
    // Baseline: How much does a human cost per hour?
    private static HUMAN_HOURLY_RATE = 50.00;

    // Baseline: How long does a typical task take a human?
    // In a real app, this would be configured per Job type.
    private static AVG_HUMAN_TASK_MINUTES = 15;

    /**
     * ROI for ONE organization.
     *
     * `organizationId` is required, with no default, because the previous
     * signature took only `days` and neither query filtered by org: the page
     * showed every organization's totals under whichever org the user had
     * selected. That was not hypothetical — the only AI spend in the system
     * belonged to org 342 while org 291 was on screen, so TECHHEAD7's "ROI"
     * was another tenant's money. Making the parameter required means a caller
     * cannot reintroduce that by forgetting it.
     *
     * Step executions carry no organization_id of their own, which is likely
     * why this was never scoped — the owning org is on the parent
     * pipeline_executions row, so it takes a join rather than a where clause.
     */
    async getSystemROI(organizationId: number, days = 30) {
        // 1. Get stats for the time period
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Count successful job executions (steps), scoped through the parent run.
        const [executionStats] = await db
            .select({
                totalSteps: sql<number>`count(*)`,
            })
            .from(pipelineStepExecutions)
            .innerJoin(
                pipelineExecutions,
                eq(pipelineStepExecutions.pipelineExecutionId, pipelineExecutions.id),
            )
            .where(and(
                gte(pipelineStepExecutions.executedAt, startDate),
                eq(pipelineStepExecutions.status, 'success'),
                eq(pipelineExecutions.organizationId, organizationId),
            ));

        // Calculate AI Costs
        const [aiCosts] = await db
            .select({
                totalCost: sql<number>`sum(${aiUsageLogs.costUsd})`
            })
            .from(aiUsageLogs)
            .where(and(
                gte(aiUsageLogs.createdAt, startDate),
                eq(aiUsageLogs.organizationId, organizationId),
            ));

        // 2. ROI Calculations
        const totalSteps = Number(executionStats.totalSteps || 0);
        const automationCost = Number(aiCosts.totalCost || 0);

        // Human Equivalent
        // Formula: (Steps * AvgHumanTime) / 60 * HourlyRate
        const humanHours = (totalSteps * ROIService.AVG_HUMAN_TASK_MINUTES) / 60;
        const humanCost = humanHours * ROIService.HUMAN_HOURLY_RATE;

        // Net Savings
        const netSavings = humanCost - automationCost;

        return {
            periodOps: totalSteps,
            automationCost: automationCost.toFixed(2),
            humanCostEquivalent: humanCost.toFixed(2),
            netSavings: netSavings.toFixed(2),
            hoursSaved: humanHours.toFixed(1),
            // A ratio needs something to divide. With no automated work there is
            // no return to express: the old code answered "-1.0x" when nothing
            // ran but a little was spent (0 - 0.05)/0.05, and "∞" when nothing
            // was spent at all — infinite return on no activity. Both are
            // arithmetic on an empty period dressed as a business metric.
            roiMultiplier:
                totalSteps > 0 && automationCost > 0
                    ? (netSavings / automationCost).toFixed(1) + "x"
                    : "N/A",
        };
    }

    /** Daily aggregation for the chart, scoped to one organization. */
    async getTrendData(organizationId: number, days = 30) {
        const result = await db.execute(sql`
            SELECT
                DATE(pse.executed_at) as date,
                COUNT(*) as count
            FROM pipeline_step_executions pse
            JOIN pipeline_executions pe ON pe.id = pse.pipeline_execution_id
            WHERE pse.executed_at >= NOW() - INTERVAL '${sql.raw(days.toString())} days'
            AND pse.status = 'success'
            AND pe.organization_id = ${organizationId}
            GROUP BY DATE(pse.executed_at)
            ORDER BY date ASC
        `);

        return result.rows.map((row: any) => ({
            date: new Date(row.date).toLocaleDateString(),
            savings: ((row.count * ROIService.AVG_HUMAN_TASK_MINUTES / 60) * ROIService.HUMAN_HOURLY_RATE).toFixed(2),
            tasks: row.count
        }));
    }
}

export const roiService = new ROIService();


