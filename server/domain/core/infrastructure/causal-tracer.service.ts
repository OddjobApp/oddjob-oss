
import { graphService } from "../../knowledge/core/graph/graph-service.js";
import { type OrgContext } from "../../jobs/job.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CausalTracer");

export interface TraceContext {
    sessionId: string;
    organizationId: number;
    jobId?: number;
    missionId?: number;
    userId?: string;
}

export class CausalTracer {
    private previousNodeId: number | null = null;
    private readonly context: TraceContext;
    private readonly orgContext: OrgContext;

    constructor(context: TraceContext) {
        this.context = context;
        // Construct minimal OrgContext for graphService
        this.orgContext = {
            organizationId: context.organizationId,
            userId: context.userId,
        } as OrgContext;
    }

    /**
     * Trace a thought step (reasoning)
     */
    async traceThought(content: string, iteration: number) {
        try {
            const node = await graphService.createNode({
                name: `Reasoning: Step ${iteration}`,
                label: "AgentReasoning",
                description: content.slice(0, 200) + (content.length > 200 ? "..." : ""),
                properties: {
                    type: "thought",
                    content: content,
                    sessionId: this.context.sessionId,
                    iteration: iteration,
                    jobId: this.context.jobId
                },
                // Link to job if available for filtering
                pipelineExecutionId: undefined, // Could link to run if we had ID
                missionId: this.context.missionId,
                organizationId: this.context.organizationId,
                verificationStatus: "verified" // Auto-verified system node
            }, this.orgContext);

            await this.linkToPrevious(node.id);
            this.previousNodeId = node.id;
            return node.id;
        } catch (error) {
            logger.warn("Failed to trace thought", { error });
            return null;
        }
    }

    /**
     * Trace a tool execution
     */
    async traceToolExecution(toolName: string, params: any, output: string, iteration: number) {
        try {
            const node = await graphService.createNode({
                name: `Action: ${toolName}`,
                label: "AgentReasoning",
                description: `Executed ${toolName}`,
                properties: {
                    type: "tool_execution",
                    tool: toolName,
                    params: params,
                    outputPreview: output.slice(0, 1000),
                    sessionId: this.context.sessionId,
                    iteration: iteration,
                    jobId: this.context.jobId
                },
                missionId: this.context.missionId,
                organizationId: this.context.organizationId,
                verificationStatus: "verified"
            }, this.orgContext);

            await this.linkToPrevious(node.id);
            this.previousNodeId = node.id;
            return node.id;
        } catch (error) {
            logger.warn("Failed to trace tool execution", { error });
            return null;
        }
    }

    /**
     * Link current node to the previous one in the chain
     */
    private async linkToPrevious(currentNodeId: number) {
        if (this.previousNodeId) {
            try {
                await graphService.createEdge({
                    sourceNodeId: this.previousNodeId,
                    targetNodeId: currentNodeId,
                    relation: "FOLLOWED_BY",
                    missionId: this.context.missionId
                }, this.orgContext);
            } catch (error) {
                logger.warn("Failed to link trace nodes", { error });
            }
        }
    }
}




