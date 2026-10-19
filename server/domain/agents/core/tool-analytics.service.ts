import { db } from "@server/database_service.js";
import { agentToolUsage, agentToolExamples } from "@shared/schema/agent/tool-analytics.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ToolAnalytics");

export interface ToolUsageLog {
    agentRunId?: number;
    executionId?: number;
    toolName: string;
    taskType?: string;
    taskDescription?: string;
    status: "success" | "error" | "timeout";
    executionTimeMs: number;
    errorType?: string;
    errorMessage?: string;
    inputParams?: any;
    outputData?: any;
    reasoning?: string;
    organizationId: number;
}

export interface ToolAnalytics {
    toolName: string;
    taskType: string;
    totalCalls: number;
    successRate: number;
    avgExecutionTimeMs: number;
    commonErrors: Array<{ error: string; count: number }>;
}

export interface ToolExample {
    examplePrompt: string;
    exampleOutput: string;
    successScore: number;
}

export const toolAnalyticsService = {
    /**
     * Log a tool usage event
     */
    async logToolUsage(log: ToolUsageLog): Promise<void> {
        try {
            await db.insert(agentToolUsage).values({
                agentRunId: log.agentRunId,
                executionId: log.executionId,
                toolName: log.toolName,
                taskType: log.taskType,
                taskDescription: log.taskDescription,
                status: log.status,
                executionTimeMs: log.executionTimeMs,
                errorType: log.errorType,
                errorMessage: log.errorMessage,
                inputParams: log.inputParams,
                outputData: log.outputData,
                reasoning: log.reasoning,
                organizationId: log.organizationId,
            });

            logger.debug("Tool usage logged", {
                toolName: log.toolName,
                status: log.status,
                executionTimeMs: log.executionTimeMs
            });

            // Autonomous self-healing loop: evaluate agent if error occurred
            if (log.status === "error" && log.agentRunId && log.organizationId) {
                setImmediate(async () => {
                    try {
                        const { performanceManagerService } = await import("./performance-manager.service.js");
                        const { fetchAgentMissionHistory } = await import("./performance-evaluation-jobs.js");
                        const agentId = String(log.agentRunId);
                        const history = await fetchAgentMissionHistory(agentId, log.organizationId);
                        if (history.length >= 5) {
                            const evalResult = await performanceManagerService.evaluateAgent(agentId, log.organizationId, history);
                            if (evalResult.actionRequired === "pip") {
                                const activePIP = performanceManagerService.getActivePIP(agentId, log.organizationId);
                                if (!activePIP) {
                                    const pip = await performanceManagerService.createPIP(
                                        agentId,
                                        log.organizationId,
                                        evalResult.reasons[0] || "Autonomous error threshold triggered",
                                        "tool_error_spike"
                                    );
                                    await performanceManagerService.startPIP(pip.id);
                                    logger.info(`🚨 Autonomous PIP self-healing triggered for Agent ${agentId} after tool error`);
                                }
                            }
                        }
                    } catch (err) {
                        logger.debug("Telemetry evaluation check skipped", { error: err });
                    }
                });
            }
        } catch (error) {
            logger.error("Failed to log tool usage", { error, toolName: log.toolName });
            // Don't throw - analytics failures shouldn't break execution
        }
    },

    /**
     * Get analytics for a specific tool
     */
    async getToolAnalytics(
        toolName: string,
        organizationId: number,
        taskType?: string
    ): Promise<ToolAnalytics> {
        const conditions: any[] = [
            eq(agentToolUsage.toolName, toolName),
            eq(agentToolUsage.organizationId, organizationId)
        ];

        if (taskType) {
            conditions.push(eq(agentToolUsage.taskType, taskType));
        }

        // Get main statistics
        const result = await db
            .select({
                toolName: agentToolUsage.toolName,
                taskType: agentToolUsage.taskType,
                totalCalls: sql<number>`COUNT(*)`,
                successRate: sql<number>`AVG(CASE WHEN ${agentToolUsage.status} = 'success' THEN 1.0 ELSE 0.0 END)`,
                avgExecutionTimeMs: sql<number>`AVG(${agentToolUsage.executionTimeMs})`,
            })
            .from(agentToolUsage)
            .where(and(...conditions))
            .groupBy(agentToolUsage.toolName, agentToolUsage.taskType)
            .limit(1);

        // Get common errors
        const errors = await db
            .select({
                error: agentToolUsage.errorType,
                count: sql<number>`COUNT(*)`,
            })
            .from(agentToolUsage)
            .where(and(...conditions, eq(agentToolUsage.status, "error")))
            .groupBy(agentToolUsage.errorType)
            .orderBy(desc(sql`COUNT(*)`))
            .limit(5);

        const stats = result[0];

        return {
            toolName,
            taskType: taskType || "all",
            totalCalls: stats ? Number(stats.totalCalls) : 0,
            successRate: stats ? Number(stats.successRate) : 0,
            avgExecutionTimeMs: stats ? Number(stats.avgExecutionTimeMs) : 0,
            commonErrors: errors.map((e) => ({
                error: e.error || "Unknown",
                count: Number(e.count),
            })),
        };
    },

    /**
     * Get all tools analytics for an organization
     */
    async getAllToolsAnalytics(organizationId: number): Promise<ToolAnalytics[]> {
        const result = await db
            .select({
                toolName: agentToolUsage.toolName,
                taskType: agentToolUsage.taskType,
                totalCalls: sql<number>`COUNT(*)`,
                successRate: sql<number>`AVG(CASE WHEN ${agentToolUsage.status} = 'success' THEN 1.0 ELSE 0.0 END)`,
                avgExecutionTimeMs: sql<number>`AVG(${agentToolUsage.executionTimeMs})`,
            })
            .from(agentToolUsage)
            .where(eq(agentToolUsage.organizationId, organizationId))
            .groupBy(agentToolUsage.toolName, agentToolUsage.taskType)
            .orderBy(desc(sql`COUNT(*)`));

        return result.map((row) => ({
            toolName: row.toolName,
            taskType: row.taskType || "all",
            totalCalls: Number(row.totalCalls),
            successRate: Number(row.successRate),
            avgExecutionTimeMs: Number(row.avgExecutionTimeMs),
            commonErrors: [], // Would need separate query per tool
        }));
    },

    /**
     * Get successful examples for few-shot prompting
     */
    async getSuccessfulExamples(
        toolName: string,
        taskType: string,
        limit: number = 3
    ): Promise<ToolExample[]> {
        const examples = await db
            .select({
                id: agentToolExamples.id,
                examplePrompt: agentToolExamples.examplePrompt,
                exampleOutput: agentToolExamples.exampleOutput,
                successScore: agentToolExamples.successScore,
            })
            .from(agentToolExamples)
            .where(
                and(
                    eq(agentToolExamples.toolName, toolName),
                    eq(agentToolExamples.taskType, taskType)
                )
            )
            .orderBy(
                desc(agentToolExamples.successScore),
                agentToolExamples.usageCount // Prefer less-used examples to balance distribution
            )
            .limit(limit);

        // Increment usage count for returned examples
        if (examples.length > 0) {
            const ids = examples.map((e) => e.id);
            await db
                .update(agentToolExamples)
                .set({ usageCount: sql`${agentToolExamples.usageCount} + 1` })
                .where(sql`${agentToolExamples.id} = ANY(${ids})`);
        }

        return examples.map((e) => ({
            examplePrompt: e.examplePrompt,
            exampleOutput: e.exampleOutput,
            successScore: e.successScore || 1.0,
        }));
    },

    /**
     * Add a new example for few-shot learning
     */
    async addExample(
        toolName: string,
        taskType: string,
        examplePrompt: string,
        exampleOutput: string,
        successScore: number = 1.0
    ): Promise<void> {
        try {
            await db.insert(agentToolExamples).values({
                toolName,
                taskType,
                examplePrompt,
                exampleOutput,
                successScore,
                usageCount: 0,
            });

            logger.info("Tool example added", { toolName, taskType });
        } catch (error) {
            logger.error("Failed to add tool example", { error, toolName });
        }
    },

    /**
     * Infer task type from goal/description
     */
    inferTaskType(goal: string): string {
        const lowerGoal = goal.toLowerCase();

        if (lowerGoal.includes("analyze") || lowerGoal.includes("data") || lowerGoal.includes("pattern")) {
            return "data_analysis";
        }
        if (lowerGoal.includes("search") || lowerGoal.includes("web") || lowerGoal.includes("find")) {
            return "web_research";
        }
        if (lowerGoal.includes("create") || lowerGoal.includes("generate") || lowerGoal.includes("write")) {
            return "content_creation";
        }
        if (lowerGoal.includes("debug") || lowerGoal.includes("fix") || lowerGoal.includes("error")) {
            return "debugging";
        }
        if (lowerGoal.includes("test") || lowerGoal.includes("verify") || lowerGoal.includes("validate")) {
            return "testing";
        }
        if (lowerGoal.includes("extract") || lowerGoal.includes("transform") || lowerGoal.includes("load")) {
            return "etl";
        }

        return "general";
    },

    /**
     * Get recommended tools for a goal based on past successful usage (AI_AGENT_ENHANCEMENTS_SPEC).
     * Uses inferTaskType and aggregates success rates from agent_tool_usage.
     */
    async getRecommendedTools(
        goal: string,
        organizationId: number,
        limit: number = 8
    ): Promise<Array<{ toolName: string; successRate: number; totalCalls: number; taskType: string }>> {
        if (!goal || goal.trim().length < 3) return [];
        const taskType = this.inferTaskType(goal);

        const rows = await db
            .select({
                toolName: agentToolUsage.toolName,
                successRate: sql<number>`AVG(CASE WHEN ${agentToolUsage.status} = 'success' THEN 1.0 ELSE 0.0 END)`,
                totalCalls: sql<number>`COUNT(*)`,
            })
            .from(agentToolUsage)
            .where(
                and(
                    eq(agentToolUsage.organizationId, organizationId),
                    eq(agentToolUsage.taskType, taskType)
                )
            )
            .groupBy(agentToolUsage.toolName)
            .orderBy(desc(sql`AVG(CASE WHEN ${agentToolUsage.status} = 'success' THEN 1.0 ELSE 0.0 END)`), desc(sql`COUNT(*)`))
            .limit(limit);

        if (rows.length > 0) {
            return rows.map((r) => ({
                toolName: r.toolName,
                successRate: Number(r.successRate),
                totalCalls: Number(r.totalCalls),
                taskType,
            }));
        }

        // Fallback: tools with few-shot examples for this task type
        const examples = await db
            .select({ toolName: agentToolExamples.toolName })
            .from(agentToolExamples)
            .where(eq(agentToolExamples.taskType, taskType))
            .groupBy(agentToolExamples.toolName)
            .limit(limit);
        return examples.map((e) => ({
            toolName: e.toolName,
            successRate: 1,
            totalCalls: 0,
            taskType,
        }));
    },
};


