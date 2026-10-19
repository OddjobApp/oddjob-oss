/**
 * Governance Sidecar REST API Routes
 *
 * Provides drop-in safety evaluation, Bayesian trajectory scoring T(S),
 * and blast radius gating for external agent frameworks (LangChain, CrewAI, AutoGen, custom Python).
 */

import { Router, Request, Response } from "express";
import { GovernanceProxyService } from "@domain/ai/core/governance-proxy.service.js";
import { createLogger } from "@server/utils/logger.js";
import { requireAuth } from "@domain/core/auth/security.service.js";

const logger = createLogger("GovernanceRouter");
const router = Router();

// Allow external agents with valid auth token
router.use(requireAuth);

/**
 * POST /api/governance/evaluate-action
 * Drop-in evaluation endpoint for external agents.
 */
router.post("/evaluate-action", async (req: Request, res: Response) => {
    try {
        const {
            actionKey,
            targetResource,
            proposedParameters,
            agentName,
            confidenceScore,
            stepStage,
            stepHistory,
        } = req.body;

        if (!actionKey || !targetResource) {
            return res.status(400).json({
                error: "Missing required fields: 'actionKey' and 'targetResource' must be provided.",
            });
        }

        const evaluation = GovernanceProxyService.evaluateAction({
            actionKey,
            targetResource,
            proposedParameters,
            agentName,
            confidenceScore,
            stepStage,
            stepHistory,
        });

        return res.json(evaluation);
    } catch (err: any) {
        logger.error(`[GovernanceRouter] Evaluation failed: ${err.message}`, err);
        return res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/governance/ratify-decision
 * Persists a ratified decision from DecisionMatrixPod into the audit log & event stream.
 */
router.post("/ratify-decision", async (req: Request, res: Response) => {
    try {
        const {
            topic,
            selectedCandidateId,
            selectedCandidateName,
            ratifiedScores,
            criteria,
            candidates,
            consensusPercentage,
            stageId,
            traceparent,
        } = req.body;

        if (!topic) {
            return res.status(400).json({ error: "Missing required field: 'topic' must be provided." });
        }

        const { auditService } = await import("@domain/audit/index.js");
        const { eventStream } = await import("@domain/core/infrastructure/event-stream.service.js");
        const { getUserOrgContext } = await import("@server/utils/auth-context.js");

        const orgContext = await getUserOrgContext(req);

        await auditService.logFromRequest(
            req,
            "decision.ratified",
            "governance_decision",
            selectedCandidateId || topic,
            {
                topic,
                selectedCandidateName,
                ratifiedScores,
                criteria,
                candidates,
                consensusPercentage,
                stageId,
                traceparent,
            }
        );

        eventStream.publish(
            "governance:decision_ratified",
            {
                topic,
                selectedCandidateId,
                selectedCandidateName,
                consensusPercentage,
                stageId,
                traceparent,
            },
            {
                organizationId: orgContext.organizationId ?? undefined,
                subject: `decision:${topic}`,
            },
            "governance-router"
        ).catch(() => {});

        logger.info(`[GovernanceRouter] Ratified decision for "${topic}": ${selectedCandidateName} (${consensusPercentage}%)`);

        return res.json({
            success: true,
            decisionId: `dec-${Date.now()}`,
            topic,
            selectedCandidateId,
            selectedCandidateName,
            consensusPercentage,
            ratifiedAt: new Date().toISOString(),
            traceparent: traceparent || null,
        });
    } catch (err: any) {
        logger.error(`[GovernanceRouter] Ratification failed: ${err.message}`, err);
        return res.status(500).json({ error: err.message });
    }
});

export default router;
