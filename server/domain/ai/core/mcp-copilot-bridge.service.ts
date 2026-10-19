import { createLogger } from "@server/utils/logger.js";
import { PredictionEngine, TrajectoryVector } from "./prediction-engine.service.js";
import { GoodQuestionEngine, StructuredQuestionPayload } from "./good-question-engine.js";
import { CopilotGovernanceGuard } from "../../governance/copilot-governance.guard.js";
import { LifecycleStage } from "../../agents/core/agent-lifecycle-state-machine.js";

const logger = createLogger("McpCopilotBridge");

export interface GovernedMcpToolCallRequest {
    agentId: string;
    stage: LifecycleStage;
    serverName: string;
    toolName: string;
    toolArguments: Record<string, any>;
    userRoles?: string[];
}

export interface GovernedMcpToolCallResult {
    permitted: boolean;
    serverName: string;
    toolName: string;
    trajectoryResult: ReturnType<typeof PredictionEngine.evaluateTrajectory>;
    gqeQuestion?: StructuredQuestionPayload;
    blockReason?: string;
}

/**
 * McpCopilotBridgeService:
 * Connects the 5-Layer Governed Control Plane directly to Model Context Protocol (MCP) tool execution.
 */
export class McpCopilotBridgeService {
    /**
     * Filters available MCP tools based on Stepwise HUD Lifecycle Stage.
     */
    public static filterMcpToolsForStage(stage: LifecycleStage, tools: Array<{ name: string; description?: string }>) {
        if (stage === "Observe" || stage === "Diagnose") {
            // Read-only tools allowed during observation & diagnosis
            return tools.filter(t => !t.name.toLowerCase().includes("delete") && !t.name.toLowerCase().includes("deploy"));
        }
        if (stage === "Approve" || stage === "Deploy") {
            // Restrict dangerous bulk tools unless explicit approval form is attached
            return tools;
        }
        return tools;
    }

    /**
     * Governs an MCP tool call request prior to execution.
     */
    public static governMcpToolCall(req: GovernedMcpToolCallRequest): GovernedMcpToolCallResult {
        const { agentId, stage, serverName, toolName, toolArguments, userRoles = ["operator"] } = req;
        const targetBoundary = `${serverName}/${toolName}`;

        // 1. Governance Guard Check for Restricted Side-Effects
        const restrictedAction = CopilotGovernanceGuard.detectRestrictedAction(toolName);
        if (restrictedAction) {
            const govCheck = CopilotGovernanceGuard.validateAction(restrictedAction, {
                userRoles,
                evidenceProvided: false
            });

            if (!govCheck.allowed) {
                const evalResult = PredictionEngine.evaluateTrajectory({
                    currentState: { stage, targetFileOrNode: targetBoundary },
                    candidateNextStep: { stage: "Approve", targetFileOrNode: targetBoundary, confidenceScore: 0.50 }
                });

                const gqeQuestion = GoodQuestionEngine.generateStructuredQuestion({
                    stage: "Approve",
                    targetNodeOrFile: targetBoundary,
                    evaluationResult: evalResult
                });

                logger.warn(`[McpCopilotBridge] MCP Tool call '${targetBoundary}' blocked by governance guard for agent '${agentId}'.`);

                return {
                    permitted: false,
                    serverName,
                    toolName,
                    trajectoryResult: evalResult,
                    gqeQuestion,
                    blockReason: govCheck.reason
                };
            }
        }

        // 2. Prediction Engine Trajectory Score
        const trajectoryVector: TrajectoryVector = {
            currentState: { stage, targetFileOrNode: targetBoundary },
            candidateNextStep: { stage, targetFileOrNode: targetBoundary, proposedAction: `mcp_call:${toolName}`, confidenceScore: 0.95 }
        };

        const trajectoryResult = PredictionEngine.evaluateTrajectory(trajectoryVector);

        if (trajectoryResult.recommendedAction !== "auto_execute") {
            const gqeQuestion = GoodQuestionEngine.generateStructuredQuestion({
                stage,
                targetNodeOrFile: targetBoundary,
                evaluationResult: trajectoryResult
            });

            return {
                permitted: false,
                serverName,
                toolName,
                trajectoryResult,
                gqeQuestion,
                blockReason: "Trajectory risk score below threshold"
            };
        }

        logger.info(`[McpCopilotBridge] MCP Tool call '${targetBoundary}' unblocked for agent '${agentId}'.`);

        return {
            permitted: true,
            serverName,
            toolName,
            trajectoryResult
        };
    }
}
