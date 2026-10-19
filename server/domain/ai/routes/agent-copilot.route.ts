import { Router } from "express";
import { handleCopilotChatRequest } from "../core/copilot-service.js";
import { CopilotGovernanceGuard } from "../../governance/copilot-governance.guard.js";
import { PredictionEngine } from "../core/prediction-engine.service.js";
import { GoodQuestionEngine } from "../core/good-question-engine.js";
import { ScopedTopicIndexer } from "../core/scoped-topic-indexer.js";
import { copilotPromptManager } from "../core/copilot-prompt-manager.service.js";

const router = Router();

/**
 * POST /api/agent-copilot/chat
 * Handles 5-Layer AI Control Plane chat requests.
 */
router.post("/chat", async (req, res) => {
    try {
        const { userId = "user_default", userMessage, appId = "oddjob_app", mode = "plan", audience = "developer" } = req.body;

        if (!userMessage) {
            return res.status(400).json({ error: "userMessage is required" });
        }

        // 1. Detect if intent attempts restricted high-risk side effect
        const restrictedAction = CopilotGovernanceGuard.detectRestrictedAction(userMessage);
        if (restrictedAction) {
            const userRoles = (req as any).user?.roles || ["operator"];
            const govCheck = CopilotGovernanceGuard.validateAction(restrictedAction, {
                userRoles,
                evidenceProvided: false
            });

            if (!govCheck.allowed) {
                const evalResult = PredictionEngine.evaluateTrajectory({
                    currentState: { stage: "Diagnose", targetFileOrNode: restrictedAction },
                    candidateNextStep: { stage: "Approve", targetFileOrNode: restrictedAction, confidenceScore: 0.60 }
                });

                const gqeQuestion = GoodQuestionEngine.generateStructuredQuestion({
                    stage: "Approve",
                    targetNodeOrFile: restrictedAction,
                    evaluationResult: evalResult
                });

                return res.json({
                    status: "governance_block",
                    reason: govCheck.reason,
                    gqeQuestion
                });
            }
        }

        // 2. Dispatch to Dynamic Prompt Assembly Layer (<2ms cache fetch)
        const response = await handleCopilotChatRequest({
            userId,
            userMessage,
            appId,
            mode,
            audience
        });

        return res.json(response);
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/agent-copilot/state
 * Returns live Control Plane state, readiness score, gaps, and graph fingerprint.
 */
router.get("/state", (_req, res) => {
    const fingerprint = copilotPromptManager.getFingerprint();
    return res.json({
        readinessScore: fingerprint.readinessScore,
        readinessGapsCount: fingerprint.readinessGapsCount,
        subgraphNodesCount: fingerprint.subgraphNodesCount,
        subgraphEdgesCount: fingerprint.subgraphEdgesCount,
        indexedDate: fingerprint.indexedDate,
        readinessGaps: fingerprint.readinessGaps,
        activeAgents: fingerprint.activeAgents
    });
});

/**
 * POST /api/agent-copilot/evaluate-trajectory
 * Evaluates a trajectory vector (S_{t-1}, S_t, S_{t+1}) with the Prediction Engine.
 */
router.post("/evaluate-trajectory", (req, res) => {
    try {
        const { previousStep, currentState, candidateNextStep } = req.body;
        if (!currentState || !candidateNextStep) {
            return res.status(400).json({ error: "currentState and candidateNextStep are required" });
        }

        const evaluation = PredictionEngine.evaluateTrajectory({
            previousStep,
            currentState,
            candidateNextStep
        });

        return res.json(evaluation);
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/agent-copilot/attestation
 * Submits a FormAgent HIL attestation response to unblock trajectory execution.
 */
router.post("/attestation", (req, res) => {
    try {
        const { formId, decision, attestationSignature, approverRole = "operations-supervisor" } = req.body;
        if (!formId || !decision || !attestationSignature) {
            return res.status(400).json({ error: "formId, decision, and attestationSignature are required" });
        }

        loggerInfo(`[AgentCopilotRoute] Attestation received for form '${formId}' by role '${approverRole}'. Decision: ${decision}`);

        return res.json({
            success: true,
            formId,
            decision,
            unblockedStatus: "unblocked_for_execution",
            timestamp: new Date().toISOString()
        });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/agent-copilot/subgraph/:agentId
 * Returns the O(1) scoped Agent Subgraph view for a specialized agent role.
 */
router.get("/subgraph/:agentId", (req, res) => {
    const { agentId } = req.params;
    const topicKey = (req.query.topicKey as string) || "topic::dispatch_and_routing";
    const subgraphView = ScopedTopicIndexer.getAgentSubgraphView(agentId, topicKey);
    return res.json(subgraphView);
});

function loggerInfo(msg: string) {
    console.log(msg);
}

export default router;
