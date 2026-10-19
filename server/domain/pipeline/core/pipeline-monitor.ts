import { db } from "@server/database_service.js";
import { agentChatMessages, pipelineExecutions, pipelineStepExecutions } from "@shared/schema/index.js";
import { eq, and, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import type { PipelineExecution } from "@shared/schema/pipelines/pipeline-execution.js";

const logger = createLogger("PipelineMonitor");

export class PipelineMonitor {
    private static POLL_INTERVAL = 3000; // 3 seconds
    private static MAX_POLLS = 200; // ~10 minutes max monitoring

    /**
     * Start monitoring a pipeline execution in the background.
     * Inserts status updates into the agent chat history.
     */
    static startMonitoring(executionId: number, jobId: number, userId: string, _slug?: string, organizationId?: number) {
        logger.info("Starting pipeline monitoring", { executionId, jobId, userId });
        this.monitorLoop(executionId, jobId, userId, organizationId).catch(err => {
            logger.error("Error monitoring execution", { executionId, error: err });
        });
    }

    private static async monitorLoop(executionId: number, jobId: number, userId: string, organizationId?: number) {
        let polls = 0;
        let lastStatus = "pending";
        let lastStepCount = 0;

        logger.debug("Monitor loop started", { executionId, jobId, userId });

        while (polls < this.MAX_POLLS) {
            polls++;

            try {
                const execConditions: any[] = [eq(pipelineExecutions.id, executionId)];
                if (organizationId) execConditions.push(eq(pipelineExecutions.organizationId, organizationId));
                const [execution] = await db.select().from(pipelineExecutions).where(and(...execConditions)).limit(1);

                if (!execution) {
                    logger.warn("Execution not found during monitoring", { executionId, poll: polls });
                    break;
                }

                logger.debug("Poll status", { executionId, poll: polls, status: execution.status });

                if (execution.status === 'completed' || execution.status === 'failed' || execution.status === 'cancelled') {
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    await this.sendCompletionMessage(execution, jobId, userId);
                    logger.info("Execution completed", { executionId, status: execution.status });
                    break;
                }

                // Check for progress updates (step completion)
                const stepExecs = await db.select().from(pipelineStepExecutions)
                    .where(eq(pipelineStepExecutions.pipelineExecutionId, executionId));
                const completedSteps = stepExecs.filter(s => s.status === 'success' || s.status === 'failed').length;

                if (completedSteps > lastStepCount) {
                    // Found new progress
                    const latestStep = stepExecs.sort((a, b) =>
                    (b.completedAt ? b.completedAt.getTime() : 0) - (a.completedAt ? a.completedAt.getTime() : 0)
                )[0];

                    if (latestStep && latestStep.status !== 'pending') {
                        let msg = `Processing update: Step **${latestStep.stepOrder}** completed (${completedSteps}/${stepExecs.length}).`;
                        if (latestStep.output && typeof latestStep.output === 'string' && latestStep.output.length < 200) {
                            msg += `\nResult: ${latestStep.output}`;
                        }

                        await this.sendAgentMessage(jobId, userId, msg);
                        lastStepCount = completedSteps;
                    }
                }

            } catch (e) {
                logger.error("Polling error", { executionId, error: e });
            }

            await new Promise(resolve => setTimeout(resolve, this.POLL_INTERVAL));
        }
    }

    private static async sendCompletionMessage(execution: PipelineExecution, jobId: number, userId: string) {
        let message = "";
        if (execution.status === 'completed') {
            message = `✅ **Pipeline Execution Completed Successfully**\n`;

            // Fetch final output
            const stepExecs = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.pipelineExecutionId, execution.id));
            // Find last step
            const lastStep = [...stepExecs].sort((a, b) => b.stepOrder - a.stepOrder)[0];

            if (lastStep?.output) {
                let isJson = false;
                let content = "";

                if (typeof lastStep.output === 'object' && lastStep.output !== null) {
                    content = JSON.stringify(lastStep.output, null, 2);
                    isJson = true;
                } else {
                    const str = String(lastStep.output);
                    try {
                        const parsed = JSON.parse(str);
                        if (typeof parsed === 'object' && parsed !== null) {
                            content = JSON.stringify(parsed, null, 2);
                            isJson = true;
                        } else {
                            content = str;
                        }
                    } catch (e) {
                        content = str;
                    }
                }

                if (isJson) {
                    message += `\n**Final Result:**\n\`\`\`json\n${content}\n\`\`\``;
                } else {
                    // Clean up quotes if present in simple string
                    const cleanContent = content.replace(/^"|"$/g, '');
                    const truncated = cleanContent.length > 5000 ? cleanContent.substring(0, 5000) + "...(truncated)" : cleanContent;
                    message += `\n\n${truncated}`;
                }
            }
        } else if (execution.status === 'failed') {
            message = `❌ **Pipeline Execution Failed**\n\nError: ${execution.error || "Unknown error"}`;
        } else {
            message = `⚠️ **Pipeline Execution Cancelled**`;
        }

        await this.sendAgentMessage(jobId, userId, message);
    }

    private static async sendAgentMessage(jobId: number, userId: string, content: string) {
        try {
            const [result] = await db.insert(agentChatMessages).values({
                jobId,
                userId,
                role: 'agent',
                content,
                rating: 0,
                metadata: { isMonitorUpdate: true }
            }).returning({ id: agentChatMessages.id });

            logger.info("Agent message inserted", { messageId: result.id, jobId });
        } catch (err) {
            logger.error("Failed to insert agent message", { jobId, error: err });
        }
    }
}

export const pipelineMonitor = PipelineMonitor;


