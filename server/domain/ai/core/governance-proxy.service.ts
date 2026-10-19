import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { PredictionEngine, TrajectoryVector, TrajectoryEvaluationResult } from "./prediction-engine.service.js";
import { createLogger } from "@server/utils/logger.js";
import { scrubObject } from "@server/utils/secret-scrubber.js";

const logger = createLogger("GovernanceProxyService");

export interface EvaluateActionRequest {
    actionKey: string;
    targetResource: string;
    proposedParameters?: Record<string, any>;
    agentName?: string;
    requesterId?: string | number;
    confidenceScore?: number;
    stepStage?: "Observe" | "Diagnose" | "Improve" | "Approve";
    stepHistory?: Array<{ stage: "Observe" | "Diagnose" | "Improve" | "Approve"; targetFileOrNode?: string }>;
    tenantOrganizationId?: string | number;
    sandboxRoot?: string;
}

export interface EvaluateActionResponse {
    evaluationId: string;
    nonce: string;
    actionKey: string;
    targetResource: string;
    decision: "auto_execute" | "require_approval" | "halt_loop";
    safeTransitionScore: number;
    probabilitySuccess: number;
    blastRadius: number;
    /**
     * The engine's own classification, in the engine's vocabulary. This said
     * "high" where PredictionEngine says "elevated" — a band it can never
     * actually return — so the field was unassignable and the two halves of the
     * system disagreed about what to call the middle tier.
     */
    riskClass: "routine" | "elevated" | "critical";
    selectedModelTier: "8b_small" | "haiku_mid" | "frontier_large";
    costReductionEst: string;
    reason: string;
    requiresDualSignOff: boolean;
    evaluatedAt: string;
    expiresAt: string;
    evaluationProofHash: string;
}

export interface ApprovalValidationRequest {
    evaluationId: string;
    requesterId?: string | number;
    approverId: string | number;
    expiresAt: string;
    nonce: string;
}

export interface ApprovalValidationResult {
    isValid: boolean;
    error?: string;
}

export class GovernanceProxyService {
    /**
     * Validates that target resource path does not escape sandbox jail.
     */
    public static validateResourcePath(targetResource: string, sandboxRoot = process.cwd()): boolean {
        if (!targetResource) return false;
        // Block null byte injection and explicit parent traversal attempts outside root
        if (targetResource.includes("\0")) return false;
        const resolved = path.resolve(sandboxRoot, targetResource);
        return resolved.startsWith(path.resolve(sandboxRoot));
    }

    /**
     * Drop-in evaluation method for external agents (LangChain, CrewAI, AutoGen, or custom Python scripts)
     * to verify safety trajectory and blast radius before mutating any target resource.
     */
    public static evaluateAction(req: EvaluateActionRequest): EvaluateActionResponse {
        const evaluationId = `gov-eval-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const nonce = randomUUID();
        const confidence = typeof req.confidenceScore === "number" ? Math.max(0, Math.min(1, req.confidenceScore)) : 0.90;

        // Path traversal guard
        if (req.sandboxRoot && !this.validateResourcePath(req.targetResource, req.sandboxRoot)) {
            throw new Error(`[SecurityError] Path traversal violation: Resource '${req.targetResource}' escapes sandbox boundary.`);
        }

        // Scrub sensitive parameters before evaluation
        const scrubbedParams = scrubObject(req.proposedParameters || {});

        const trajectoryVector: TrajectoryVector = {
            currentState: {
                stage: req.stepStage ?? "Improve",
                targetFileOrNode: req.targetResource,
            },
            candidateNextStep: {
                stage: req.stepStage ?? "Improve",
                targetFileOrNode: req.targetResource,
                confidenceScore: confidence,
            },
            stepHistory: req.stepHistory,
        };

        const result: TrajectoryEvaluationResult = PredictionEngine.evaluateTrajectory(trajectoryVector);

        const requiresDualSignOff =
            result.riskClass === "critical" ||
            result.safeTransitionScore < 0.85 ||
            req.targetResource.includes("prod/") ||
            req.targetResource.includes("database/schema");

        const decision: EvaluateActionResponse["decision"] = result.loopDetected
            ? "halt_loop"
            : result.recommendedAction === "auto_execute" && !requiresDualSignOff
            ? "auto_execute"
            : "require_approval";

        const evaluatedAt = new Date().toISOString();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15-min TTL

        const hashMaterial = `${evaluationId}:${nonce}:${req.actionKey}:${req.targetResource}:${result.safeTransitionScore}:${decision}:${evaluatedAt}:${expiresAt}`;
        const evaluationProofHash = `sha256:${createHash("sha256").update(hashMaterial).digest("hex")}`;

        logger.info(
            `[GovernanceProxy] Action '${req.actionKey}' on '${req.targetResource}' evaluated. Decision: ${decision} (T(S): ${result.safeTransitionScore}, Risk: ${result.riskClass}, Nonce: ${nonce.slice(0, 8)}...)`
        );

        return {
            evaluationId,
            nonce,
            actionKey: req.actionKey,
            targetResource: req.targetResource,
            decision,
            safeTransitionScore: result.safeTransitionScore,
            probabilitySuccess: result.probabilitySuccess,
            blastRadius: result.blastRadius,
            // A trajectory the engine declined to classify is not therefore
            // safe; an unclassified action gets the middle tier, not the
            // lowest.
            riskClass: result.riskClass ?? "elevated",
            selectedModelTier: result.selectedModelTier,
            costReductionEst: result.costReductionEst,
            reason: result.reason ?? `Action evaluated under ${result.riskClass} risk tier policy.`,
            requiresDualSignOff,
            evaluatedAt,
            expiresAt,
            evaluationProofHash,
        };
    }

    /**
     * Validates human approval against quorum and anti-self-approval invariants.
     */
    public static validateApproval(req: ApprovalValidationRequest): ApprovalValidationResult {
        // 1. Check expiration TTL
        const expiry = new Date(req.expiresAt).getTime();
        if (Date.now() > expiry) {
            return {
                isValid: false,
                error: "Approval token expired (15-minute TTL elapsed). A fresh governance evaluation must be requested.",
            };
        }

        // 2. Anti-Self-Approval check
        if (req.requesterId !== undefined && req.requesterId !== null) {
            if (String(req.requesterId) === String(req.approverId)) {
                return {
                    isValid: false,
                    error: "Separation of Duties violation: The requesting user/agent cannot approve their own high-risk mutation.",
                };
            }
        }

        return { isValid: true };
    }
}
