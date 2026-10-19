import { db } from "@server/database_service.js";
import { 
  aiUsageLogs, pipelines, schedules, pipelineStepExecutions, 
  jobs, alerts, pipelineExecutions, auditLogs, missions, 
  orgSettings, knowledgeNodes, agentDeployments,
  missionRuns, missionShadowRuns
} from "@shared/schema/index.js";
import { monthlySpendHistory } from "@shared/schema/billing.js";


import { agentRunSteps } from "@shared/schema/agent/chat.js";
import { memoryEvolutionService } from "../../knowledge/core/evolution/memory-evolution.service.js";
import { eq, and, gte, sql, desc, gt, lt, or } from "drizzle-orm";
import { subDays } from "date-fns";
import { budgetService } from "../../core/budget.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("DashboardService");

/** The authorization facts every method here receives. */
type DashboardOrgContext = { isSuperAdmin: boolean; organizationId: number | null };

/**
 * The tenant predicate for one column, or undefined for a deliberately
 * unscoped super-admin view.
 *
 * This existed twice already as a local closure - once per method, with the
 * second hardcoded to ai_usage_logs - and five queries in this file hand-rolled
 * a third version as `orgContext.organizationId ? eq(col, orgId) : undefined`.
 * That ternary differs from the helper in the case that matters: a
 * non-super-admin whose organization is null got no predicate at all rather
 * than `IS NULL`, so the dashboard read every tenant's rows. One of those five
 * was the audit timeline.
 *
 * Returning undefined for a super admin is intentional and is why callers push
 * conditionally; a null organization is a value to filter on, not an absence of
 * scope.
 */
function orgPredicate(orgIdField: any, orgContext: DashboardOrgContext) {
    if (orgContext.isSuperAdmin) return undefined;
    if (orgContext.organizationId !== null) return eq(orgIdField, orgContext.organizationId);
    return sql`${orgIdField} IS NULL`;
}

export const dashboardService = {
    /**
     * Get Dashboard Statistics (Home Page)
     */
    async getDashboardStats(orgContext: { isSuperAdmin: boolean; organizationId: number | null }) {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const buildOrgFilter = (orgIdField: any) => orgPredicate(orgIdField, orgContext);

        // Build all condition arrays upfront
        const scheduleConditions = [eq(schedules.isActive, true)];
        const scheduleOrgFilter = buildOrgFilter(schedules.organizationId);
        if (scheduleOrgFilter) scheduleConditions.push(scheduleOrgFilter);

        const failedJobsConditions = [eq(pipelineStepExecutions.status, 'failure'), gt(pipelineStepExecutions.executedAt, twentyFourHoursAgo)];
        const failedJobsOrgFilter = buildOrgFilter(jobs.organizationId);
        if (failedJobsOrgFilter) failedJobsConditions.push(failedJobsOrgFilter);

        const alertConditions = [eq(alerts.suppressed, false), sql`${alerts.acknowledgedAt} IS NULL`, sql`${alerts.resolvedAt} IS NULL`];
        const alertOrgFilter = buildOrgFilter(alerts.organizationId);
        if (alertOrgFilter) alertConditions.push(alertOrgFilter);

        const pipelineConditions = [eq(pipelines.isActive, true)];
        const pipelineOrgFilter = buildOrgFilter(pipelines.organizationId);
        if (pipelineOrgFilter) pipelineConditions.push(pipelineOrgFilter);

        const pipelineExecConditions = [gt(pipelineExecutions.startedAt, twentyFourHoursAgo)];
        const pipelineExecOrgFilter = buildOrgFilter(pipelineExecutions.organizationId);
        if (pipelineExecOrgFilter) pipelineExecConditions.push(pipelineExecOrgFilter);

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setHours(0, 0, 0, 0);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const trendConditions = [gte(pipelineStepExecutions.executedAt, sevenDaysAgo)];
        const trendOrgFilter = buildOrgFilter(jobs.organizationId);
        if (trendOrgFilter) trendConditions.push(trendOrgFilter);

        const workstreamConditions = [gt(knowledgeNodes.createdAt, twentyFourHoursAgo)];
        const workstreamOrgFilter = buildOrgFilter(knowledgeNodes.organizationId);
        if (workstreamOrgFilter) workstreamConditions.push(workstreamOrgFilter);

        const orgId = orgContext.organizationId;
        const orgFilter = orgId ? sql`AND j.organization_id = ${orgId}` : sql``;
        const arsOrgFilter = orgId ? sql`AND ars.organization_id = ${orgId}` : sql``;

        const combinedActivityQuery = sql`
            SELECT
                pse.id as "executionId",
                j.name as "jobName",
                pse.status as "status",
                pse.executed_at as "startTime",
                'planned' as "type",
                pe.mission_id as "missionId",
                COALESCE(pe.mission_run_id, (SELECT id FROM mission_runs WHERE pipeline_execution_id = pe.id LIMIT 1)) as "runId"
            FROM pipeline_step_executions pse
            JOIN jobs j ON pse.job_id = j.id
            JOIN pipeline_executions pe ON pse.pipeline_execution_id = pe.id
            WHERE 1=1 ${orgFilter}
            UNION ALL
            SELECT
                ars.id as "executionId",
                COALESCE(ars.tool_name, 'Agent Thought') as "jobName",
                'success' as "status",
                ars.created_at as "startTime",
                'autonomous' as "type",
                ars.mission_id as "missionId",
                COALESCE(ars.mission_run_id, (SELECT id FROM mission_runs WHERE mission_id = ars.mission_id ORDER BY created_at DESC LIMIT 1)) as "runId"
            FROM agent_run_steps ars
            WHERE 1=1 ${arsOrgFilter}
            ORDER BY "startTime" DESC
            LIMIT 10
        `;

        // Run all independent queries in parallel
        const [
            [activeSchedulesResult],
            [failedJobsResult],
            [activeAlertsResult],
            activeAlertList,
            [activePipelinesResult],
            [pipelineMetrics],
            recentActivityRaw,
            trendResults,
            [activeWorkstreamsResult],
        ] = await Promise.all([
            db.select({ count: sql<number>`count(*)` }).from(schedules).where(and(...scheduleConditions)),
            db.select({ count: sql<number>`count(*)` }).from(pipelineStepExecutions).innerJoin(jobs, eq(pipelineStepExecutions.jobId, jobs.id)).where(and(...failedJobsConditions)),
            db.select({ count: sql<number>`count(*)` }).from(alerts).where(and(...alertConditions)),
            db.select({ alertId: alerts.id, severity: alerts.severity, message: alerts.message }).from(alerts).where(and(...alertConditions)).orderBy(desc(alerts.createdAt)).limit(5),
            db.select({ count: sql<number>`count(*)` }).from(pipelines).where(and(...pipelineConditions)),
            db.select({ total: sql<number>`count(*)`, failed: sql<number>`count(*) filter (where ${pipelineExecutions.status} = 'failed')` }).from(pipelineExecutions).where(and(...pipelineExecConditions)),
            db.execute(combinedActivityQuery),
            db.select({
                date: sql<string>`date_trunc('day', ${pipelineStepExecutions.executedAt})::date`,
                day: sql<string>`to_char(${pipelineStepExecutions.executedAt}, 'Dy')`,
                completed: sql<number>`count(*) filter (where ${pipelineStepExecutions.status} = 'success')`,
                failed: sql<number>`count(*) filter (where ${pipelineStepExecutions.status} = 'failure')`,
            }).from(pipelineStepExecutions).innerJoin(jobs, eq(pipelineStepExecutions.jobId, jobs.id)).where(and(...trendConditions)).groupBy(sql`date_trunc('day', ${pipelineStepExecutions.executedAt})`, sql`to_char(${pipelineStepExecutions.executedAt}, 'Dy')`).orderBy(sql`date_trunc('day', ${pipelineStepExecutions.executedAt})`),
            db.select({ count: sql<number>`count(*)` }).from(knowledgeNodes).where(and(...workstreamConditions)),
        ]);

        const recentActivity = (recentActivityRaw.rows as any[]).map((r: any) => ({
            executionId: parseInt(String(r.executionId)),
            jobName: r.jobName,
            status: r.status === 'success' ? 'success' : r.status === 'failure' ? 'failed' : r.status,
            startTime: new Date(r.startTime).toISOString(),
            scheduledJobName: r.type === 'autonomous' ? 'Autonomous Activity' : 'Manual Run',
            type: r.type,
            missionId: r.missionId ? parseInt(String(r.missionId)) : undefined,
            runId: r.runId ? parseInt(String(r.runId)) : undefined
        }));

        const trendMap = new Map(trendResults.map((r: any) => [new Date(r.date).toISOString().split('T')[0], r]));
        const trend = Array.from({ length: 7 }, (_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - (6 - i));
            const dateKey = d.toISOString().split('T')[0];
            const dayKey = d.toLocaleDateString('en-US', { weekday: 'short' });
            const dayData = trendMap.get(dateKey);
            return {
                day: dayKey,
                status_completed: Number(dayData?.completed || 0),
                status_failed: Number(dayData?.failed || 0)
            };
        });

        return {
            activeSchedules: Number(activeSchedulesResult?.count || 0),
            failedJobs24h: Number(failedJobsResult?.count || 0),
            activeAlerts: Number(activeAlertsResult?.count || 0),
            activePipelines: Number(activePipelinesResult?.count || 0),
            activeWorkstreams: Number(activeWorkstreamsResult?.count || 0),
            pipelineRuns24h: Number(pipelineMetrics?.total || 0),
            failedPipelines24h: Number(pipelineMetrics?.failed || 0),
            recentExecutions: recentActivity,
            activeAlertList: activeAlertList,
            executionTrend: trend
        };
    },

    /**
     * Get Cost Dashboard Stats
     */
    async getCostDashboardStats(orgContext: { isSuperAdmin: boolean; organizationId: number | null }) {
        const orgFilter = orgPredicate(aiUsageLogs.organizationId, orgContext);
        const thirtyDaysAgo = subDays(new Date(), 30);
        const conditions = [gte(aiUsageLogs.createdAt, thirtyDaysAgo)];
        if (orgFilter) conditions.push(orgFilter);

        const pipelineConditions = [sql`${aiUsageLogs.pipelineId} IS NOT NULL`];
        if (orgFilter) pipelineConditions.push(orgFilter);
        const agentConditions = [gte(aiUsageLogs.createdAt, thirtyDaysAgo)];
        if (orgFilter) agentConditions.push(orgFilter);

        // Run all independent cost queries in parallel
        const [
            dailyCosts,
            modelCosts,
            topPipelines,
            topAgents,
            [totalSpendResult],
            orgSettingsRow,
            activeMissionsRaw,
            spendHistory,
            insights,
        ] = await Promise.all([
            db.select({
                date: sql<string>`date_trunc('day', ${aiUsageLogs.createdAt})::date::text`,
                cost: sql<number>`COALESCE(SUM(${aiUsageLogs.costUsd}::numeric), 0)`,
            }).from(aiUsageLogs).where(and(...conditions)).groupBy(sql`date_trunc('day', ${aiUsageLogs.createdAt})`).orderBy(sql`date_trunc('day', ${aiUsageLogs.createdAt})`),

            db.select({ model: aiUsageLogs.model, cost: sql<number>`COALESCE(SUM(${aiUsageLogs.costUsd}::numeric), 0)` })
                .from(aiUsageLogs).where(orgFilter ? and(orgFilter) : undefined as any)
                .groupBy(aiUsageLogs.model).orderBy(desc(sql`COALESCE(SUM(${aiUsageLogs.costUsd}::numeric), 0)`)),

            db.select({ pipelineId: pipelines.id, name: pipelines.name, totalCost: sql<number>`COALESCE(SUM(${aiUsageLogs.costUsd}::numeric), 0)` })
                .from(aiUsageLogs).leftJoin(pipelines, eq(aiUsageLogs.pipelineId, pipelines.id))
                .where(and(...pipelineConditions)).groupBy(pipelines.id, pipelines.name)
                .orderBy(desc(sql`COALESCE(SUM(${aiUsageLogs.costUsd}::numeric), 0)`)).limit(5),

            // Attribute AI spend to an agent deployment through the step execution that
            // incurred it: ai_usage_logs.step_execution_id -> pipeline_step_executions
            // -> job_id -> agent_deployments.job_id.
            //
            // This previously joined on (pipelineExecutions as any).agentDeploymentId.
            // That column does not exist on pipeline_executions — the `as any` hid it —
            // so Drizzle rendered the condition with an empty left side
            // (`inner join "agent_deployments" on  = "agent_deployments"."id"`) and the
            // query threw on every dashboard load, swallowed by the .catch below.
            //
            // Note: this returns nothing until callers populate stepExecutionId when
            // logging usage. It is currently null on every ai_usage_logs row, so
            // per-agent cost attribution is unavailable rather than wrong. Joining via
            // pipeline_id instead would fan one usage row out across every step of the
            // pipeline and inflate the cost per agent, which is worse than empty.
            db.select({ agentId: agentDeployments.id, name: agentDeployments.title, totalCost: sql<number>`COALESCE(SUM(${aiUsageLogs.costUsd}::numeric), 0)` })
                .from(aiUsageLogs)
                .innerJoin(pipelineStepExecutions, eq(aiUsageLogs.stepExecutionId, pipelineStepExecutions.id))
                .innerJoin(agentDeployments, eq(pipelineStepExecutions.jobId, agentDeployments.jobId))
                .where(and(...agentConditions)).groupBy(agentDeployments.id, agentDeployments.title)
                .orderBy(desc(sql`COALESCE(SUM(${aiUsageLogs.costUsd}::numeric), 0)`)).limit(5)
                .catch((err: any) => { logger.warn("Dashboard query failed, returning empty:", err.message); return [] as any[]; }),

            db.select({ total: sql<number>`COALESCE(SUM(${aiUsageLogs.costUsd}::numeric), 0)` })
                .from(aiUsageLogs).where(and(...conditions)),

            orgContext.organizationId
                ? db.select().from(orgSettings).where(eq(orgSettings.organizationId, orgContext.organizationId)).limit(1)
                : Promise.resolve([] as any[]),

            db.select({ id: missions.id, name: missions.name, budgetLimit: sql<string>`${missions.budgetLimitUsd}`, currentSpend: sql<string>`${missions.currentSpendUsd}` })
                .from(missions)
                .where(and(
                    orgPredicate(missions.organizationId, orgContext),
                    or(eq(missions.status, 'active'), eq(missions.status, 'running'))
                ))
                .orderBy(desc(missions.currentSpendUsd)).limit(10)
                .catch((err: any) => { logger.warn("Dashboard query failed, returning empty:", err.message); return [] as any[]; }),

            orgContext.organizationId
                ? db.select().from(monthlySpendHistory).where(eq(monthlySpendHistory.organizationId, orgContext.organizationId)).orderBy(desc(monthlySpendHistory.year), desc(monthlySpendHistory.month)).limit(6)
                : Promise.resolve([] as any[]),

            this.getDashboardInsights(orgContext),
        ]);

        const orgBudget = orgSettingsRow[0] ? {
            monthlyBudget: Number(orgSettingsRow[0].monthlyBudgetUsd),
            currentMonthSpend: Number(orgSettingsRow[0].currentMonthSpendUsd),
            resetDay: orgSettingsRow[0].budgetResetDay,
            lastResetAt: orgSettingsRow[0].lastBudgetResetAt
        } : null;
        const activeMissions = activeMissionsRaw;

        return {
            dailyCosts: dailyCosts.map((r: any) => ({ date: r.date, cost: Number(r.cost) })),
            modelCosts: modelCosts.map((r: any) => ({ model: r.model, cost: Number(r.cost) })),
            topPipelines: topPipelines.map((r: any) => ({ pipelineId: r.pipelineId, name: r.name, totalCost: Number(r.totalCost) })),
            topAgents: topAgents.map((r: any) => ({ agentId: r.agentId, name: r.name, totalCost: Number(r.totalCost) })),
            totalSpend: Number(totalSpendResult?.total || 0),
            orgBudget,
            activeMissions: activeMissions.map(m => ({
                id: m.id,
                name: m.name,
                budgetLimit: Number(m.budgetLimit),
                currentSpend: Number(m.currentSpend)
            })),
            spendHistory: spendHistory.map(h => ({
                month: h.month,
                year: h.year,
                totalSpend: Number(h.totalSpendUsd),
                budgetLimit: Number(h.budgetLimitUsd),
                date: new Date(h.year, h.month).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
            })),
            insights: insights.filter(i => i.type === 'optimization' || i.type === 'warning' || i.type === 'success')
        };
    },

    /**
     * Get Proactive Insights based on real data
     */
    async getDashboardInsights(orgContext: { isSuperAdmin: boolean; organizationId: number | null }) {
        const insights = [];

        // 1. Check for High Failure Rate Jobs (Last 24h)
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const failedJobs = await db.select({
            jobId: jobs.id,
            jobName: jobs.name,
            failureCount: sql<number>`count(*)`
        })
            .from(pipelineStepExecutions)
            .innerJoin(jobs, eq(pipelineStepExecutions.jobId, jobs.id))
            .where(and(
                eq(pipelineStepExecutions.status, 'failure'),
                gt(pipelineStepExecutions.executedAt, twentyFourHoursAgo),
                orgPredicate(jobs.organizationId, orgContext)
            ))
            .groupBy(jobs.id, jobs.name)
            .having(sql`count(*) > 2`) // More than 2 failures
            .limit(3);
        
        failedJobs.forEach((job: any) => {
            insights.push({
                id: `failure-${job.jobId}`,
                type: 'warning',
                title: 'High Failure Rate',
                description: `Activity "${job.jobName}" has failed ${job.failureCount} times in the last 24 hours.`,
                impact: 'Reliability Risk',
                actionLabel: 'View Activity',
                actionPath: `/jobs/${job.jobId}`
            });
        });

        // 1b. Check for Failed Missions (Last 24h)
        const failedMissions = await db.select({
            id: missionRuns.id,
            missionId: missionRuns.missionId,
            name: missionRuns.name
        })
            .from(missionRuns)
            .where(and(
                eq(missionRuns.status, 'failed'),
                gt(missionRuns.updatedAt, twentyFourHoursAgo),
                orgPredicate(missionRuns.organizationId, orgContext)
            ))
            .limit(3);

        failedMissions.forEach(run => {
            insights.push({
                id: `mission-failure-${run.id}`,
                type: 'warning',
                title: 'Mission Failed',
                description: `Autonomous Mission "${run.name}" failed to reach its objective.`,
                impact: 'Goal Not Met',
                actionLabel: 'Analyze Failure',
                actionPath: `/missions/${run.missionId}/runs/${run.id}`
            });
        });

        // 2. Check for Budget Warnings
        const budgetPipelines = await db.select()
            .from(pipelines)
            .where(and(
                sql`${pipelines.monthlyBudgetUsd} IS NOT NULL`,
                eq(pipelines.isActive, true),
                orgPredicate(pipelines.organizationId, orgContext)
            ))
            .limit(5);

        for (const pipeline of budgetPipelines) {
            if (!pipeline.monthlyBudgetUsd) continue;
            const spend = await budgetService.getPipelineCurrentMonthSpend(pipeline.id);
            const budget = Number(pipeline.monthlyBudgetUsd);

            if (spend > budget * 0.9) {
                insights.push({
                    id: `budget-${pipeline.id}`,
                    type: spend > budget ? 'warning' : 'optimization',
                    title: spend > budget ? 'Budget Exceeded' : 'Budget Critical',
                    description: `Pipeline "${pipeline.name}" is at ${(spend / budget * 100).toFixed(0)}% of its monthly budget ($${spend.toFixed(2)} / $${budget}).`,
                    impact: 'Cost Alert',
                    actionLabel: 'Adjust Budget',
                    actionPath: `/pipelines/${pipeline.id}`
                });
            }
        }

        // 3. Inference Optimization (Shadow Runs)
        const topShadowRuns = await db.select()
            .from(missionShadowRuns)
            .where(and(
                eq(missionShadowRuns.status, 'completed'),
                eq(missionShadowRuns.isSuccess, true),
                gt(missionShadowRuns.evalScore, 80)
            ))
            .limit(3);

        topShadowRuns.forEach(shadow => {
            insights.push({
                id: `shadow-${shadow.id}`,
                type: 'optimization',
                title: 'Inference Optimization',
                description: `Shadow Run #${shadow.id} (Model: ${shadow.modelId}) achieved a score of ${shadow.evalScore}. Promoting this to primary could improve performance.`,
                impact: 'High',
                actionLabel: 'Review Results',
                actionPath: `/missions/${shadow.parentRunId}`
            });
        });

        // 4. Maturity Insights
        if (orgContext.organizationId) {
            const maturityStats = await memoryEvolutionService.getMaturityStats(orgContext.organizationId);
            if (maturityStats.maturityScore < 60) {
                insights.push({
                    id: 'maturity-low',
                    type: 'warning',
                    title: 'Agentic Maturity Low',
                    description: `Organization maturity score is at ${maturityStats.maturityScore}%. Knowledge base may contain stale or low-utility nodes.`,
                    impact: 'Retrieval Risk',
                    actionLabel: 'Improve Maturity',
                    actionPath: '/knowledge/maturity'
                });
            } else if (maturityStats.utilityDistribution.low > maturityStats.totalNodes * 0.3) {
                insights.push({
                    id: 'maturity-prune',
                    type: 'optimization',
                    title: 'Knowledge Pruning',
                    description: `${maturityStats.utilityDistribution.low} nodes have low utility. Pruning stale knowledge could improve agent precision.`,
                    impact: 'System Noise',
                    actionLabel: 'Open Lab',
                    actionPath: '/knowledge/maturity'
                });
            }
        }

        // 5. Throughput Latency (Anomaly Detection)
        const latencyAnomalies = await db.execute(sql`
            WITH daily_stats AS (
                SELECT 
                    job_id,
                    AVG(EXTRACT(EPOCH FROM (completed_at - executed_at))) as avg_duration
                FROM pipeline_step_executions
                WHERE status = 'success' 
                  AND executed_at > NOW() - INTERVAL '24 hours'
                GROUP BY job_id
            ),
            baseline_stats AS (
                SELECT 
                    job_id,
                    AVG(EXTRACT(EPOCH FROM (completed_at - executed_at))) as baseline_duration
                FROM pipeline_step_executions
                WHERE status = 'success' 
                  AND executed_at BETWEEN NOW() - INTERVAL '7 days' AND NOW() - INTERVAL '24 hours'
                GROUP BY job_id
            )
            SELECT ds.job_id, j.name, ds.avg_duration, bs.baseline_duration
            FROM daily_stats ds
            JOIN baseline_stats bs ON ds.job_id = bs.job_id
            JOIN jobs j ON ds.job_id = j.id
            WHERE ds.avg_duration > bs.baseline_duration * 1.3
              AND ds.avg_duration > 5
        `);

        (latencyAnomalies.rows as any[]).forEach(anomaly => {
            insights.push({
                id: `latency-${anomaly.job_id}`,
                type: 'warning',
                title: 'Throughput Latency',
                description: `Activity "${anomaly.name}" is processing 30%+ slower than its weekly baseline.`,
                impact: 'Medium',
                actionLabel: 'Analyze',
                actionPath: `/jobs/${anomaly.job_id}`
            });
        });

        if (insights.length === 0) {
            insights.push({
                id: 'system-healthy',
                type: 'success',
                title: 'System Healthy',
                description: 'All pipelines and activities are running within expected parameters.',
                impact: 'Optimal Operation'
            });
        }

        return insights;
    },

    /**
     * Get Mixed Activity Timeline (Executions + Audit Logs)
     */
    async getAuditTimeline(orgContext: { isSuperAdmin: boolean; organizationId: number | null }, limit = 20) {
        // The `&& orgContext.organizationId` guard had no else, so a
        // non-super-admin with no organization pushed nothing and read every
        // tenant's audit log. orgPredicate returns `IS NULL` for that caller.
        const auditConditions = [];
        const auditOrgFilter = orgPredicate(auditLogs.organizationId, orgContext);
        if (auditOrgFilter) auditConditions.push(auditOrgFilter);

        const recentAudits = await db.select()
            .from(auditLogs)
            .where(and(...auditConditions))
            .orderBy(desc(auditLogs.createdAt))
            .limit(limit);

        return recentAudits.map(log => {
            let title = `${log.action} ${log.entityType}`;
            let description = `${log.action} performed on ${log.entityType} ${log.entityId ? `#${log.entityId}` : ''}`;
            let type: 'job_success' | 'job_failure' | 'alert' | 'pipeline_start' | 'pipeline_end' = 'alert';
            let link: string | undefined = undefined;

            const metadata = (log.metadata as any) || {};
            const entityIdStr = log.entityId;
            const entityId = entityIdStr ? parseInt(entityIdStr, 10) : undefined;
            const validEntityId = isNaN(entityId as any) ? undefined : entityId;

            // Specialized Mapping Logic
            if (log.action === 'POST' && log.entityType === 'sync') {
                title = "System Dependencies Audited";
                description = "Automated security and license scan completed for 3rd party libraries.";
                type = "job_success";
                link = "/admin/software-audit";
            } else if (log.action === 'skill_ingested') {
                title = "New Skill Package Ingested";
                description = `Skill "${metadata.skillName || 'Unknown'}" initialized with ${metadata.count || 1} components.`;
                type = "skill_ingested" as any;
                link = metadata.collectionId ? `/jobs?collection=${metadata.collectionId}` : `/jobs/${entityIdStr}`;
            } else if (log.action === 'agent_optimization_applied') {
                title = "Agent Intelligence Optimized";
                description = `Performance tuning applied to agent instance based on historical performance ${metadata.suggestionId ? `(Suggestion #${metadata.suggestionId})` : ''}.`;
                type = "job_success";
            } else if (log.entityType === 'node' && log.action === 'POST') {
                title = "Knowledge Base Extraction";
                description = `New entity "${metadata.name || entityIdStr || 'Semantic Node'}" distilled into the Knowledge Graph.`;
                type = "pipeline_end";
                link = "/knowledge/graph";
            } else if (log.action === 'TRIGGER' && log.entityType === 'pipeline') {
                title = "Autonomous Pipeline Execution";
                description = `Pipeline #${entityIdStr} triggered ${metadata.triggerSource ? `via ${metadata.triggerSource}` : 'manually'}.`;
                type = "pipeline_start";
                link = `/pipelines/${entityIdStr}`;
            } else if (log.action === 'POST' && log.entityType === 'memory') {
                title = "Agent Synapse Recorded";
                description = "Critical observation persistent into long-term agent memory.";
                type = "alert";
            } else if (log.action === 'POST' && log.entityType === 'logout') {
                title = "Admin Session Terminated";
                description = "Security protocol: User logged out and session purged.";
                type = "alert";
            } else if (log.entityType.startsWith('agent-')) {
                title = "Direct Agent Uplink";
                description = `Active communication session with ${log.entityType.replace('-', ' #')}.`;
                type = "pipeline_start";
            } else if (log.action === 'DELETE' && log.entityType === 'workgroup') {
                title = "Mission Purged";
                description = `Operational cleanup: Workgroup #${entityIdStr} and associated context deleted.`;
                type = "alert";
                link = "/workgroups";
            } else if (log.action === 'PATCH' && log.entityType === 'dependency') {
                title = "Dependency Categorized";
                description = `Manual feature mapping updated for package #${entityIdStr}.`;
                type = "job_success";
                link = "/admin/software-audit";
            } else if (log.action === 'CREATE' || log.action === 'UPDATE' || log.action === 'DELETE') {
                const actionVerb = log.action === 'CREATE' ? 'instantiated' : log.action === 'UPDATE' ? 'modified' : 'decommissioned';
                title = `${log.entityType.charAt(0).toUpperCase() + log.entityType.slice(1)} ${actionVerb}`;
                description = `Administrative ${log.action.toLowerCase()} action on ${log.entityType} ${entityIdStr ? `#${entityIdStr}` : ''}.`;

                // Generic linking logic
                if (log.entityType === 'job') link = `/jobs/${entityIdStr}`;
                else if (log.entityType === 'pipeline') link = `/pipelines/${entityIdStr}`;
                else if (log.entityType === 'organization') link = "/account-admin/organizations";
                else if (log.entityType === 'user') link = "/account-admin/users";
                else if (log.entityType === 'credential') link = "/connections/credentials";
            }

            return {
                id: `audit-${log.id}`,
                type,
                title,
                description,
                timestamp: log.createdAt,
                entityId: validEntityId,
                link,
                meta: log.metadata
            };
        });
    }
};


