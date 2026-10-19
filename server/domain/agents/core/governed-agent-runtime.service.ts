import { createLogger } from "@server/utils/logger.js";
import { AgentLifecycleStateMachine, LifecycleStage } from "./agent-lifecycle-state-machine.js";
import { PredictionEngine, TrajectoryVector } from "../../ai/core/prediction-engine.service.js";
import { GoodQuestionEngine, StructuredQuestionPayload } from "../../ai/core/good-question-engine.js";
import { ScopedTopicIndexer, AgentSubgraphView } from "../../ai/core/scoped-topic-indexer.js";

const logger = createLogger("GovernedAgentRuntime");

export interface AgentRuntimeExecutionStep {
    agentId: string;
    assignedTopicKey: string;
    stage: LifecycleStage;
    targetFileOrNode: string;
    proposedAction: string;
    confidenceScore?: number;
}

export interface AgentRuntimeExecutionResult {
    agentId: string;
    subgraphView: AgentSubgraphView;
    stateMachineStage: LifecycleStage;
    trajectoryResult: ReturnType<typeof PredictionEngine.evaluateTrajectory>;
    gqeQuestion?: StructuredQuestionPayload;
    executionPermitted: boolean;
}

/**
 * Governed Agent Runtime Service:
 * Binds the 5-Layer AI Control Plane directly to Oddjob's agent orchestrator & execution loop.
 */
export class GovernedAgentRuntime {
    private stateMachine: AgentLifecycleStateMachine;

    constructor(initialStage: LifecycleStage = "Observe") {
        this.stateMachine = new AgentLifecycleStateMachine(initialStage);
    }

    /**
     * Executes a governed step in the agent runtime lifecycle.
     */
    public executeStep(step: AgentRuntimeExecutionStep): AgentRuntimeExecutionResult {
        const { agentId, assignedTopicKey, stage, targetFileOrNode, proposedAction } = step;

        // 1. Fetch O(1) Scoped Agent Subgraph View (<2ms warm-up)
        const subgraphView = ScopedTopicIndexer.getAgentSubgraphView(agentId, assignedTopicKey);

        // 2. Evaluate trajectory vector (S_{t-1}, S_t, S_{t+1}) with Prediction Engine
        const trajectoryVector: TrajectoryVector = {
            currentState: { stage: this.stateMachine.getCurrentStage(), targetFileOrNode },
            candidateNextStep: { stage, targetFileOrNode, proposedAction, confidenceScore: step.confidenceScore ?? 0.88 }
        };

        const trajectoryResult = PredictionEngine.evaluateTrajectory(trajectoryVector);

        // 3. If high risk or loop detected, emit GQE FormAgent payload and block execution
        if (trajectoryResult.recommendedAction !== "auto_execute") {
            const gqeQuestion = GoodQuestionEngine.generateStructuredQuestion({
                stage,
                targetNodeOrFile: targetFileOrNode,
                evaluationResult: trajectoryResult
            });

            logger.warn(`[GovernedAgentRuntime] Step execution blocked by control plane for agent '${agentId}'.`);

            return {
                agentId,
                subgraphView,
                stateMachineStage: this.stateMachine.getCurrentStage(),
                trajectoryResult,
                gqeQuestion,
                executionPermitted: false
            };
        }

        // 4. Record evidence & transition state machine
        this.stateMachine.recordEvidence(this.stateMachine.getCurrentStage(), targetFileOrNode);

        logger.info(`[GovernedAgentRuntime] Governed step unblocked for agent '${agentId}' in stage [${stage}].`);

        return {
            agentId,
            subgraphView,
            stateMachineStage: stage,
            trajectoryResult,
            executionPermitted: true
        };
    }
}
