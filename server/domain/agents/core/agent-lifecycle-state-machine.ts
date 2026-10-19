import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AgentLifecycleStateMachine");

export type LifecycleStage =
    | "Observe"
    | "Diagnose"
    | "Improve"
    | "Validate"
    | "Approve"
    | "Deploy"
    | "Verify";

export const STAGE_ORDER: LifecycleStage[] = [
    "Observe",
    "Diagnose",
    "Improve",
    "Validate",
    "Approve",
    "Deploy",
    "Verify"
];

export interface StageExitCondition {
    requiredEvidenceLabel: string;
    description: string;
    met: boolean;
}

export interface FormAgentPayload {
    type: "FormAgent" | "InstantApp";
    formId: string;
    title: string;
    stage: LifecycleStage;
    fields: Array<{
        id: string;
        label: string;
        type: "text" | "number" | "select" | "checkbox" | "attestation";
        required: boolean;
        options?: string[];
        description?: string;
        /** Hint shown inside an empty input. Free-text fields only. */
        placeholder?: string;
    }>;
    requiredApproverRoles?: string[];
    /**
     * Compact risk summary rendered above the form. Set by Good Question Engine
     * consumers (the spatial and telemetry engines) to explain why the operator
     * is being asked, without dragging in the full proof context.
     */
    minimalProofContext?: Record<string, string>;
    /**
     * Mutually exclusive remediation choices offered alongside the form, ordered
     * by ascending risk.
     */
    socraticDisambiguationOptions?: Array<{
        optionId: string;
        label: string;
        description: string;
        riskScore: number;
    }>;
}

export interface StateTransitionResult {
    success: boolean;
    currentStage: LifecycleStage;
    nextStage?: LifecycleStage;
    reason?: string;
    unmetConditions?: StageExitCondition[];
    formAgentPayload?: FormAgentPayload;
}

export class AgentLifecycleStateMachine {
    private currentStage: LifecycleStage;
    private stageEvidenceMap: Map<LifecycleStage, StageExitCondition[]>;

    constructor(initialStage: LifecycleStage = "Observe") {
        this.currentStage = initialStage;
        this.stageEvidenceMap = new Map();
        this.initializeDefaultExitConditions();
    }

    private initializeDefaultExitConditions(): void {
        this.stageEvidenceMap.set("Observe", [
            { requiredEvidenceLabel: "X-Ray Subgraph Context", description: "Target node 2-hop graph state loaded", met: true }
        ]);
        this.stageEvidenceMap.set("Diagnose", [
            { requiredEvidenceLabel: "Root Cause Log / Metric", description: "Failure diagnostic log attached", met: false }
        ]);
        this.stageEvidenceMap.set("Improve", [
            { requiredEvidenceLabel: "Candidate Patch / Prompt", description: "Proposed code/prompt changes compiled", met: false }
        ]);
        this.stageEvidenceMap.set("Validate", [
            { requiredEvidenceLabel: "E2E Benchmark Pass", description: "Validation score > 80%", met: false }
        ]);
        this.stageEvidenceMap.set("Approve", [
            { requiredEvidenceLabel: "Supervisor Attestation", description: "Operations supervisor signature", met: false }
        ]);
        this.stageEvidenceMap.set("Deploy", [
            { requiredEvidenceLabel: "Deployment Verification Event", description: "Deployment pipeline return state", met: false }
        ]);
        this.stageEvidenceMap.set("Verify", [
            { requiredEvidenceLabel: "Post-Deploy Audit Log", description: "Zero regressions in 15min post-deploy monitoring window", met: false }
        ]);
    }

    public getCurrentStage(): LifecycleStage {
        return this.currentStage;
    }

    public getExitConditions(stage: LifecycleStage = this.currentStage): StageExitCondition[] {
        return this.stageEvidenceMap.get(stage) || [];
    }

    public recordEvidence(stage: LifecycleStage, evidenceLabel: string): void {
        const conditions = this.stageEvidenceMap.get(stage);
        if (conditions) {
            const cond = conditions.find(c => c.requiredEvidenceLabel.toLowerCase() === evidenceLabel.toLowerCase());
            if (cond) {
                cond.met = true;
                logger.info(`[StateMachine] Recorded evidence '${evidenceLabel}' for stage [${stage}].`);
            }
        }
    }

    /**
     * Attempts to transition to the next stage in the lifecycle.
     */
    public transitionToNextStage(): StateTransitionResult {
        const currentIndex = STAGE_ORDER.indexOf(this.currentStage);
        if (currentIndex < 0 || currentIndex >= STAGE_ORDER.length - 1) {
            return {
                success: false,
                currentStage: this.currentStage,
                reason: `Already at final stage [${this.currentStage}].`
            };
        }

        const currentConditions = this.getExitConditions(this.currentStage);
        const unmet = currentConditions.filter(c => !c.met);

        if (unmet.length > 0) {
            const nextStageCandidate = STAGE_ORDER[currentIndex + 1];
            logger.warn(`[StateMachine] Transition from [${this.currentStage}] to [${nextStageCandidate}] blocked. Unmet conditions: ${unmet.map(u => u.requiredEvidenceLabel).join(", ")}`);
            
            return {
                success: false,
                currentStage: this.currentStage,
                nextStage: nextStageCandidate,
                reason: `Cannot advance to [${nextStageCandidate}]. Exit conditions for [${this.currentStage}] not met.`,
                unmetConditions: unmet,
                formAgentPayload: this.generateFormAgentPayload(this.currentStage, unmet)
            };
        }

        const nextStage = STAGE_ORDER[currentIndex + 1];
        this.currentStage = nextStage;
        logger.info(`[StateMachine] Advanced stage to [${this.currentStage}].`);

        return {
            success: true,
            currentStage: this.currentStage,
            nextStage: STAGE_ORDER[currentIndex + 1]
        };
    }

    /**
     * Emits a structured FormAgent or InstantApp payload when input/approval is required.
     */
    public generateFormAgentPayload(stage: LifecycleStage, unmetConditions: StageExitCondition[]): FormAgentPayload {
        return {
            type: "FormAgent",
            formId: `form_stage_${stage.toLowerCase()}`,
            title: `${stage} Stage Attestation Form`,
            stage,
            fields: unmetConditions.map(u => ({
                id: u.requiredEvidenceLabel.toLowerCase().replace(/[^a-z0-9]/g, "_"),
                label: u.requiredEvidenceLabel,
                type: stage === "Approve" ? "attestation" : "text",
                required: true,
                description: u.description
            })),
            requiredApproverRoles: stage === "Approve" ? ["operations-supervisor", "application-owner"] : undefined
        };
    }
}
