
import { db } from "@server/database_service.js";
import { pipelineExecutions, pipelineStepExecutions, pipelineSteps, jobs } from "@shared/schema/index.js";
import { sql, eq, and, gt } from "drizzle-orm";
import { type OrgContext } from "@server/utils/auth-context.js";

export interface ExecutionExportParams {
  pipelineId: number;
  stepName: string;
  startDate: Date;
  endDate: Date;
  status?: string;
}

/**
 * Reporting Service
 * 
 * Centralizes all queries to the 'reporting' schema and materialized views.
 * Handles organization-level filtering for all dashboard metrics.
 */
export const reportingService = {
    /**
     * Get performance metrics for all pipelines
     */
    async getPipelinePerformance(orgContext: OrgContext, limit = 10) {
        const query = sql`SELECT * FROM reporting.kpi_pipeline_performance`;
        const conditions = [];

        if (!orgContext.isSuperAdmin && orgContext.organizationId !== null) {
            conditions.push(sql`organization_id = ${orgContext.organizationId}`);
        } else if (!orgContext.isSuperAdmin) {
            conditions.push(sql`organization_id IS NULL`);
        }

        const whereClause = conditions.length > 0 ? sql` WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
        // NULLS LAST: never-run pipelines have last_execution_time = NULL, which Postgres sorts
        // FIRST under DESC by default — that would push pipelines with real executions past the
        // LIMIT and make the dashboard show all-zero rows. Pipelines with executions must rank first.
        const result = await db.execute(sql`${query}${whereClause} ORDER BY last_execution_time DESC NULLS LAST LIMIT ${limit}`);
        return result.rows;
    },

    /**
     * Get AI usage metrics by model and provider
     */
    async getAIUsage(orgContext: OrgContext) {
        const query = sql`SELECT * FROM reporting.kpi_ai_usage`;
        const conditions = [];

        if (!orgContext.isSuperAdmin && orgContext.organizationId !== null) {
            conditions.push(sql`organization_id = ${orgContext.organizationId}`);
        } else if (!orgContext.isSuperAdmin) {
            conditions.push(sql`organization_id IS NULL`);
        }

        const whereClause = conditions.length > 0 ? sql` WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
        const result = await db.execute(sql`${query}${whereClause} ORDER BY request_count DESC`);
        return result.rows;
    },

    /**
     * Get top error hotspots
     */
    async getErrorHotspots(orgContext: OrgContext, limit = 10) {
        const query = sql`SELECT * FROM reporting.kpi_error_hotspots`;
        const conditions = [];

        if (!orgContext.isSuperAdmin && orgContext.organizationId !== null) {
            conditions.push(sql`organization_id = ${orgContext.organizationId}`);
        } else if (!orgContext.isSuperAdmin) {
            conditions.push(sql`organization_id IS NULL`);
        }

        const whereClause = conditions.length > 0 ? sql` WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
        const result = await db.execute(sql`${query}${whereClause} ORDER BY occurrence_count DESC LIMIT ${limit}`);
        return result.rows;
    },

    /**
     * Get trace activity volume over time (global/admin view)
     */
    async getTraceVolume(hours = 24) {
        const result = await db.execute(sql`
            SELECT 
                DATE_TRUNC('hour', created_at) as hour,
                COUNT(DISTINCT trace_id) as trace_count,
                COUNT(*) as span_count
            FROM forensic_event_log
            WHERE created_at > NOW() - (INTERVAL '1 hour' * ${hours})
            GROUP BY hour
            ORDER BY hour ASC
        `);
        return result.rows;
    },

    /**
     * Refresh all KPI materialized views
     */
    async refreshKPIViews() {
        try {
            const result = await db.execute(sql`SELECT * FROM reporting.refresh_kpi_views()`);
            return result.rows;
        } catch (error) {
            console.error("[ReportingService] Failed to refresh views:", error);
            throw error;
        }
    },

    /**
     * Stream pipeline step executions for export (NDJSON).
     * Used by /api/admin/organizations/:id/export/executions
     */
    async *streamExecutionExport(params: ExecutionExportParams): AsyncGenerator<{ execution_id: number; executed_at: Date | null; step_output: unknown }> {
        const { pipelineId, stepName, startDate, endDate, status = 'success' } = params;
        const CHUNK_SIZE = 500;
        let lastId = 0;
        let hasMore = true;

        while (hasMore) {
            const batch = await db.select({
                executionId: pipelineExecutions.id,
                executedAt: pipelineStepExecutions.completedAt,
                output: pipelineStepExecutions.output,
                stepExecutionId: pipelineStepExecutions.id
            })
                .from(pipelineStepExecutions)
                .innerJoin(pipelineExecutions, eq(pipelineStepExecutions.pipelineExecutionId, pipelineExecutions.id))
                .innerJoin(pipelineSteps, eq(pipelineStepExecutions.pipelineStepId, pipelineSteps.id))
                .innerJoin(jobs, eq(pipelineSteps.jobId, jobs.id))
                .where(and(
                    eq(pipelineExecutions.pipelineId, pipelineId),
                    eq(pipelineExecutions.status, status),
                    eq(jobs.name, stepName),
                    gt(pipelineStepExecutions.completedAt, startDate),
                    sql`${pipelineStepExecutions.completedAt} <= ${endDate}`,
                    gt(pipelineStepExecutions.id, lastId)
                ))
                .orderBy(pipelineStepExecutions.id)
                .limit(CHUNK_SIZE);

            if (batch.length === 0) {
                hasMore = false;
            } else {
                lastId = batch[batch.length - 1].stepExecutionId;
                for (const row of batch) {
                    let parsedOutput: unknown = row.output;
                    try {
                        if (typeof row.output === 'string' && (row.output.startsWith('{') || row.output.startsWith('['))) {
                            parsedOutput = JSON.parse(row.output);
                        }
                    } catch {
                        // keep raw output on parse failure
                    }
                    yield {
                        execution_id: row.executionId,
                        executed_at: row.executedAt,
                        step_output: parsedOutput
                    };
                }
            }
        }
    }
};

