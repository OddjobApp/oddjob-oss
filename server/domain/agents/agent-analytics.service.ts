
import { db } from "@server/database_service.js";
import { agentRunSteps, agentChatMessages, jobs, agentResponseTemplates, optimizationSuggestions } from "@shared/schema/index.js";
import { desc, sql, eq, and, gte, type SQL } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { type OrgContext } from "../../utils/auth-context.js";

const logger = createLogger('AgentAnalyticsService');

/**
 * Physical column name for `agentRunSteps.createdAt`, for the date-bucket
 * expressions that go through `sql.raw`.
 *
 * `sql.raw` takes a string, so the Drizzle column object cannot be interpolated
 * into one — it stringifies to "[object Object]". Inside a tagged `sql` template
 * the column object is correct; only these raw fragments need the literal name.
 */
const CREATED_AT_COL = 'created_at';

export class AgentAnalyticsService {
    /**
     * Group by runId, get distinct runs with metadata
     */
    async getRecentRuns(limit: number = 50) {
        return db.select({
            runId: agentRunSteps.runId,
            jobId: agentRunSteps.jobId,
            lastActive: sql<string>`MAX(${agentRunSteps.createdAt})`,
            stepCount: sql<number>`COUNT(*)::int`,
            summary: sql<string>`(array_agg(${agentRunSteps.content} ORDER BY ${agentRunSteps.createdAt} ASC))[1]`
        })
            .from(agentRunSteps)
            .groupBy(agentRunSteps.runId, agentRunSteps.jobId)
            .orderBy(desc(sql`MAX(${agentRunSteps.createdAt})`))
            .limit(limit);
    }

    /**
     * Get all steps for a specific run
     */
    async getRunSteps(runId: string) {
        return db.select()
            .from(agentRunSteps)
            .where(eq(agentRunSteps.runId, runId))
            .orderBy(agentRunSteps.createdAt);
    }

    /**
     * Get tool usage statistics
     */
    async getToolUsage(limit: number = 20) {
        return db.select({
            toolName: agentRunSteps.toolName,
            count: sql<number>`count(*)::int`
        })
            .from(agentRunSteps)
            .where(sql`${agentRunSteps.toolName} IS NOT NULL`)
            .groupBy(agentRunSteps.toolName)
            .orderBy(desc(sql`count(*)`))
            .limit(limit);
    }

    /**
     * Get consolidated performance metrics for a job
     */
    async getJobPerformanceMetrics(jobId: number, days: number = 7) {
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // 1. Summary Metrics
        const [summary] = await db.select({
            totalRated: sql<number>`count(CASE WHEN rating != 0 THEN 1 END)::int`,
            thumbsUp: sql<number>`count(CASE WHEN rating = 1 THEN 1 END)::int`,
            thumbsDown: sql<number>`count(CASE WHEN rating = -1 THEN 1 END)::int`,
            csat: sql<number>`CASE WHEN count(CASE WHEN rating != 0 THEN 1 END) > 0 
                THEN (count(CASE WHEN rating = 1 THEN 1 END) * 100 / count(CASE WHEN rating != 0 THEN 1 END))::int 
                ELSE 0 END`
        })
            .from(agentChatMessages)
            .where(eq(agentChatMessages.jobId, jobId));

        // 2. Failure Reasons
        const failures = await db.select({
            reason: agentChatMessages.feedbackReason,
            count: sql<number>`count(*)::int`
        })
            .from(agentChatMessages)
            .where(and(
                eq(agentChatMessages.jobId, jobId),
                eq(agentChatMessages.rating, -1),
                sql`${agentChatMessages.feedbackReason} IS NOT NULL`
            ))
            .groupBy(agentChatMessages.feedbackReason)
            .orderBy(desc(sql`count(*)`));

        // 3. Rating Trend
        const trend = await db.select({
            date: sql<string>`to_char(${agentChatMessages.createdAt}, 'YYYY-MM-DD')`,
            rating: agentChatMessages.rating,
            count: sql<number>`count(*)::int`
        })
            .from(agentChatMessages)
            .where(and(
                eq(agentChatMessages.jobId, jobId),
                gte(agentChatMessages.createdAt, startDate),
                sql`${agentChatMessages.rating} IN (1, -1)`
            ))
            .groupBy(sql`to_char(${agentChatMessages.createdAt}, 'YYYY-MM-DD')`, agentChatMessages.rating)
            .orderBy(sql`to_char(${agentChatMessages.createdAt}, 'YYYY-MM-DD')`);

        return {
            summary: summary || { totalRated: 0, thumbsUp: 0, thumbsDown: 0, csat: 0 },
            failures: failures || [],
            trend: trend || []
        };
    }

    /**
     * Get sessions with negative feedback for review
     */
    async getReviewQueue(jobId: number, options: { page: number; pageSize: number; reason?: string }) {
        const offset = (options.page - 1) * options.pageSize;

        // 1. Get Session Summaries
        const baseQuery = db.select({
            sessionId: agentChatMessages.userId,
            messageCount: sql<number>`count(*)::int`,
            negativeCount: sql<number>`count(CASE WHEN rating = -1 THEN 1 END)::int`,
            lastMessage: sql<string>`(array_agg(${agentChatMessages.content} ORDER BY ${agentChatMessages.createdAt} DESC))[1]`,
            lastActivity: sql<string>`MAX(${agentChatMessages.createdAt}::text)`,
            reasons: sql<string[]>`array_agg(DISTINCT ${agentChatMessages.feedbackReason}) FILTER (WHERE ${agentChatMessages.feedbackReason} IS NOT NULL)`
        })
            .from(agentChatMessages)
            .where(and(
                eq(agentChatMessages.jobId, jobId),
                options.reason && options.reason !== 'all' ? eq(agentChatMessages.feedbackReason, options.reason) : undefined
            ))
            .groupBy(agentChatMessages.userId)
            .having(sql`count(CASE WHEN rating = -1 THEN 1 END) > 0`);

        const conversations = await baseQuery
            .orderBy(desc(sql`MAX(${agentChatMessages.createdAt})`))
            .limit(options.pageSize)
            .offset(offset);

        // 2. Get Total Count for Pagination (using execute as original)
        const countResult: any = await db.execute(sql`
            SELECT COUNT(*)::int as count FROM (
                SELECT user_id FROM agent_chat_messages 
                WHERE job_id = ${jobId} 
                GROUP BY user_id 
                HAVING COUNT(CASE WHEN rating = -1 THEN 1 END) > 0
            ) as subquery
        `);
        const totalCount = countResult.rows?.[0]?.count || 0;

        return {
            conversations: conversations || [],
            totalCount
        };
    }

    /**
     * Get full conversation history for a session
     */
    async getConversationHistory(jobId: number, sessionId: string) {
        return db.select()
            .from(agentChatMessages)
            .where(and(
                eq(agentChatMessages.jobId, jobId),
                eq(agentChatMessages.userId, sessionId)
            ))
            .orderBy(agentChatMessages.createdAt);
    }

    /**
     * Identify knowledge gaps based on negative feedback
     */
    async identifyKnowledgeGaps(jobId: number) {
        const gaps = await db.select({
            topic: agentChatMessages.feedbackReason,
            failureCount: sql<number>`count(*)::int`,
            sampleQueries: sql<string[]>`(array_agg(
                (SELECT content FROM agent_chat_messages u 
                 WHERE u.job_id = ${jobId} AND u.user_id = ${agentChatMessages.userId} 
                 AND u.created_at < ${agentChatMessages.createdAt} AND u.role = 'user'
                 ORDER BY u.created_at DESC LIMIT 1)
            ) FILTER (WHERE feedback_reason IS NOT NULL))[1:3]`
        })
            .from(agentChatMessages)
            .where(and(
                eq(agentChatMessages.jobId, jobId),
                eq(agentChatMessages.rating, -1),
                sql`${agentChatMessages.feedbackReason} IS NOT NULL`
            ))
            .groupBy(agentChatMessages.feedbackReason)
            .orderBy(desc(sql`count(*)`));

        return gaps;
    }

    /**
     * Tool usage heatmap
     */
    async getToolHeatmap(options: { startDate: Date; endDate: Date; groupBy: 'hour' | 'day' }) {
        /*
          Use the literal column name, not the Drizzle column object. These strings
          are handed to `sql.raw`, and a plain template literal stringifies a column
          object as "[object Object]" — Postgres then rejected every query with
          `to_char([object Object], ...)`, so the endpoint 500'd and the Tool Usage
          Heatmap rendered its "no data" state no matter how much data existed.
        */
        const dateFormat = options.groupBy === 'hour'
            ? `to_char(${CREATED_AT_COL}, 'YYYY-MM-DD HH24:00')`
            : `to_char(${CREATED_AT_COL}, 'YYYY-MM-DD')`;

        return db.select({
            toolName: agentRunSteps.toolName,
            timeSlot: sql<string>`${sql.raw(dateFormat)}`,
            count: sql<number>`count(*)::int`,
            /*
              No avgDuration. `agent_run_steps` records no per-step duration — the
              column here computed `created_at - created_at`, which is 0 by
              construction, so the field was always 0 and nothing rendered it.
              Reporting a real figure needs a duration column (or deriving the gap
              to the next step in the run); until then, omit rather than publish a
              metric that can only ever say zero.
            */
        })
            .from(agentRunSteps)
            .where(and(
                sql`${agentRunSteps.toolName} IS NOT NULL`,
                gte(agentRunSteps.createdAt, options.startDate),
                sql`${agentRunSteps.createdAt} <= ${options.endDate}`
            ))
            .groupBy(agentRunSteps.toolName, sql.raw(dateFormat))
            .orderBy(sql.raw(dateFormat), agentRunSteps.toolName);
    }

    /**
     * Cost efficiency trends
     */
    async getCostTrends(startDate: Date, groupBy: 'day' | 'week' | 'month' = 'day') {
        // Literal column name — see the note in getToolHeatmap; the same
        // "[object Object]" interpolation broke Cost Efficiency Trends.
        const dateFormat = groupBy === 'week'
            ? `to_char(date_trunc('week', ${CREATED_AT_COL}), 'YYYY-MM-DD')`
            : groupBy === 'month'
                ? `to_char(date_trunc('month', ${CREATED_AT_COL}), 'YYYY-MM-DD')`
                : `to_char(${CREATED_AT_COL}, 'YYYY-MM-DD')`;

        return db.select({
            period: sql<string>`${sql.raw(dateFormat)}`,
            totalRuns: sql<number>`count(DISTINCT ${agentRunSteps.runId})::int`,
            totalSteps: sql<number>`count(*)::int`,
            avgStepsPerRun: sql<number>`(count(*)::float / count(DISTINCT ${agentRunSteps.runId}))::numeric(10,2)`,
            estimatedCost: sql<number>`(count(*) * 0.001)::numeric(10,4)`
        })
            .from(agentRunSteps)
            .where(gte(agentRunSteps.createdAt, startDate))
            .groupBy(sql.raw(dateFormat))
            .orderBy(sql.raw(dateFormat));
    }

    /**
     * Compare multiple agents
     */
    async compareAgents(jobIds: number[], days: number = 30) {
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        return Promise.all(jobIds.map(async (jobId) => {
            const [job] = await db.select({ id: jobs.id, name: jobs.name, type: jobs.type })
                .from(jobs)
                .where(eq(jobs.id, jobId))
                .limit(1);

            if (!job) return null;

            const [runStats] = await db.select({
                totalRuns: sql<number>`count(DISTINCT ${agentRunSteps.runId})::int`,
                totalSteps: sql<number>`count(*)::int`,
                avgStepsPerRun: sql<number>`(count(*)::float / NULLIF(count(DISTINCT ${agentRunSteps.runId}), 0))::numeric(10,2)`,
                uniqueTools: sql<number>`count(DISTINCT ${agentRunSteps.toolName})::int`
            })
                .from(agentRunSteps)
                .where(and(
                    eq(agentRunSteps.jobId, jobId),
                    gte(agentRunSteps.createdAt, startDate)
                ));

            const [chatStats] = await db.select({
                totalMessages: sql<number>`count(*)::int`,
                thumbsUp: sql<number>`count(CASE WHEN rating = 1 THEN 1 END)::int`,
                thumbsDown: sql<number>`count(CASE WHEN rating = -1 THEN 1 END)::int`,
                avgRating: sql<number>`avg(CASE WHEN rating != 0 THEN rating ELSE NULL END)::numeric(3,2)`
            })
                .from(agentChatMessages)
                .where(and(
                    eq(agentChatMessages.jobId, jobId),
                    gte(agentChatMessages.createdAt, startDate)
                ));

            const totalRated = (chatStats?.thumbsUp || 0) + (chatStats?.thumbsDown || 0);
            const successRate = totalRated > 0
                ? ((chatStats?.thumbsUp || 0) / totalRated * 100).toFixed(1)
                : 'N/A';

            return {
                agentId: jobId,
                agentName: job.name,
                agentType: job.type,
                metrics: {
                    totalRuns: runStats?.totalRuns || 0,
                    totalSteps: runStats?.totalSteps || 0,
                    avgStepsPerRun: runStats?.avgStepsPerRun || 0,
                    uniqueTools: runStats?.uniqueTools || 0,
                    totalMessages: chatStats?.totalMessages || 0,
                    thumbsUp: chatStats?.thumbsUp || 0,
                    thumbsDown: chatStats?.thumbsDown || 0,
                    successRate,
                    avgRating: chatStats?.avgRating || 0
                }
            };
        }));
    }

    /**
     * List response templates for organization
     */
    async listResponseTemplates(orgContext: OrgContext) {
        return db.select()
            .from(agentResponseTemplates)
            .where(eq(agentResponseTemplates.organizationId, orgContext.organizationId!))
            .orderBy(desc(agentResponseTemplates.createdAt));
    }

    /**
     * Create a response template
     */
    async createResponseTemplate(orgContext: OrgContext, data: any) {
        const [template] = await db.insert(agentResponseTemplates)
            .values({
                ...data,
                organizationId: orgContext.organizationId!,
            })
            .returning();
        return template;
    }

    /**
     * Update a response template
     */
    async updateResponseTemplate(orgContext: OrgContext, id: number, data: any) {
        const [updated] = await db.update(agentResponseTemplates)
            .set(data)
            .where(and(
                eq(agentResponseTemplates.id, id),
                eq(agentResponseTemplates.organizationId, orgContext.organizationId!)
            ))
            .returning();
        return updated;
    }

    /**
     * Delete a response template
     */
    async deleteResponseTemplate(orgContext: OrgContext, id: number) {
        return db.delete(agentResponseTemplates)
            .where(and(
                eq(agentResponseTemplates.id, id),
                eq(agentResponseTemplates.organizationId, orgContext.organizationId!)
            ));
    }

    /**
     * Get template by ID
     */
    async getTemplateById(orgContext: OrgContext, id: number) {
        const [template] = await db.select()
            .from(agentResponseTemplates)
            .where(and(
                eq(agentResponseTemplates.id, id),
                eq(agentResponseTemplates.organizationId, orgContext.organizationId!)
            ))
            .limit(1);
        return template;
    }

    /**
     * Update template effectiveness score
     */
    /**
     * Update template effectiveness score
     */
    async updateTemplateScore(id: number, score: number) {
        return db.update(agentResponseTemplates)
            .set({ effectivenessScore: score })
            .where(eq(agentResponseTemplates.id, id));
    }

    /**
     * Get metadata for a run, including jobId and confirmation of steps existence
     */
    async getRunMetadata(runId: string): Promise<{ jobId: number | null; hasSteps: boolean }> {
        const steps = await db.select({ jobId: agentRunSteps.jobId })
            .from(agentRunSteps)
            .where(eq(agentRunSteps.runId, runId))
            .limit(1);

        if (steps.length === 0) {
            return { jobId: null, hasSteps: false };
        }

        return {
            jobId: steps[0].jobId || null,
            hasSteps: true
        };
    }

    /**
     * Get jobId from a runId by looking at steps
     */
    async getJobIdFromRunId(runId: string): Promise<number | null> {
        const meta = await this.getRunMetadata(runId);
        return meta.jobId;
    }

    /**
     * Get job configuration
     */
    async getJobConfig(jobId: number) {
        const [job] = await db.select({ config: jobs.config })
            .from(jobs)
            .where(eq(jobs.id, jobId));
        return job?.config || null;
    }

    /**
     * Save a human correction as a "Gold Standard" example
     */
    async saveCorrectionAsExample(jobId: number, messageId: number, content: string, originalPrompt: string, feedback: string) {
        return db.insert(agentChatMessages).values({
            jobId,
            userId: 'system-training',
            role: 'agent',
            content,
            rating: 1, // Mark as Good
            metadata: {
                isCorrection: true,
                correctedMessageId: messageId,
                originalPrompt,
                originalFeedback: feedback
            }
        });
    }

    /**
     * Get a step by ID
     */
    async getStepById(stepId: number) {
        const [step] = await db.select()
            .from(agentRunSteps)
            .where(eq(agentRunSteps.id, stepId))
            .limit(1);
        return step;
    }

    /**
     * Save an optimization suggestion
     */
    async saveOptimizationSuggestion(data: any) {
        const [suggestion] = await db.insert(optimizationSuggestions)
            .values(data)
            .returning();
        return suggestion;
    }
}

export const agentAnalyticsService = new AgentAnalyticsService();


