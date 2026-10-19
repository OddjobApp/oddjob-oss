
import { z } from "zod";
import { SupervisorTaskSchema } from "@shared/schema/supervisor.js";
import { MoltProducer } from "@domain/governor/index.js";
import { createLogger } from "@server/utils/logger.js";
import { safeJsonParse } from "../../../utils/json-repair.js";
import { SentinelService } from "@domain/mission/core/sentinel-service.js";
import { getMonotonicTimeNs } from "../../core/infrastructure/trace-logger.service.js";
import { BudgetGovernanceService } from "@domain/governor/core/budget-governance.service.js";
import { MCTSPlannerStrategy, PromptPlannerStrategy } from "../../agents/core/speculative/planner-strategies.js";
import {
    missionCheckpointService,
    type MissionCheckpoint,
    type StepOutcomeResult,
} from "./mission-checkpoint.service.js";
import { adversarialConsensusService } from "@domain/governance/core/adversarial-consensus.service.js";

const logger = createLogger("AutonomousLifecycleManager");

export interface StepVerificationResult {
    success: boolean;
    observation: string;
    checkpoint?: MissionCheckpoint;
    circuitBreakerTripped?: boolean;
    circuitBreakerReason?: string;
}

/**
 * The Task Manifest represents the agent's internal plan before execution.
 */
export const TaskManifestSchema = z.object({
    goal: z.string(),
    strategy: z.string().describe("High-level approach"),
    successCriteria: z.array(z.string().min(1)).min(1).default(["The stated goal is satisfied with verifiable evidence."]),
    steps: z.array(z.object({
        id: z.string(),
        description: z.string(),
        tool: z.string(),
        params: z.any(),
        hypothesis: z.string().describe("What the agent expects to happen"),
        completionCriteria: z.array(z.string().min(1)).min(1).default(["The tool returns a non-error result that advances the goal."]),
        risk: z.enum(["low", "medium", "high"]).default("low"),
        status: z.enum(["pending", "alerting", "executing", "verifying", "completed", "failed"]).default("pending"),
        verificationTool: z.string().nullable().optional().describe("Tool used to verify success"),
        verificationParams: z.any().optional().describe("Inputs for the verification tool; defaults to the execution params"),
        estimatedTokens: z.number().nullable().optional().default(1000),
        dependencies: z.array(z.string()).nullable().optional().default([]),
    })),
    createdAt: z.string().datetime().default(() => new Date().toISOString()),
    riskLevel: z.enum(["low", "medium", "high"]).default("low"),
});

export type TaskManifest = z.infer<typeof TaskManifestSchema>;

export class AutonomousLifecycleManager {
    private producer: MoltProducer | null = null;
    private sessionId: string;
    private organizationId?: number;
    private missionId?: number;
    private client: any;
    private apiKey: string | undefined;
    private defaultModel: string;
    private goal?: string;
    private jobId?: number;
    private agentId: number;

    constructor(
        sessionId: string,
        agentId: number,
        client?: any,
        apiKey?: string,
        defaultModel: string = "gemini-1.5-pro",
        organizationId?: number,
        missionId?: number,
        jobId?: number
    ) {
        this.sessionId = sessionId;
        this.agentId = agentId;
        this.client = client;
        this.apiKey = apiKey;
        this.defaultModel = defaultModel;
        this.organizationId = organizationId;
        this.missionId = missionId;
        this.jobId = jobId;
    }

    private async ensureProducer() {
        if (!this.producer) {
            this.producer = new MoltProducer(this.sessionId, this.organizationId, this.missionId);
        }
        return this.producer;
    }

    /**
     * Stage 1: Plan
     * Generates a manifest based on the goal and available tools.
     */
    async plan(goal: string, tools: any[]): Promise<TaskManifest> {
        this.goal = goal;
        logger.info(`Planning manifest for goal: ${goal} using Strategy Pattern`);
        
        const context = {
            client: this.client,
            apiKey: this.apiKey,
            defaultModel: this.defaultModel,
            organizationId: this.organizationId,
            missionId: this.missionId,
            jobId: this.jobId
        };

        let manifest = null;

        // Use MCTS ONLY for background jobs. Real-time Copilot chat needs to be FAST.
        // MCTS Simulator is too slow for chat. Disabling MCTS temporarily for responsiveness.
        logger.info("Bypassing MCTS to reduce latency for agent response.");

        if (!manifest) {
            if (this.jobId) {
                logger.warn("MCTS strategy failed, falling back to Prompt Strategy");
            }
            const promptStrategy = new PromptPlannerStrategy();
            manifest = await promptStrategy.plan(goal, tools, context);
        }

        if (manifest) {
            return manifest;
        }

        return {
            goal,
            strategy: "Fallback: Linear execution",
            successCriteria: ["The stated goal is satisfied with verifiable evidence."],
            steps: [],
            createdAt: new Date().toISOString(),
            riskLevel: "low",
        };
    }

    /**
     * Stage 1.5: Verify Manifest
     * Checks tool health, risk, and cycle detection.
     */
    async verifyManifest(manifest: TaskManifest): Promise<{ valid: boolean; warnings: string[]; blockers: string[] }> {
        const warnings: string[] = [];
        const blockers: string[] = [];

        if (manifest.steps.length === 0) {
            warnings.push("The pre-plan has no executable steps; the live reasoning loop must construct the next action.");
        }

        if (manifest.successCriteria.length === 0) {
            blockers.push("The plan has no objective-level success criteria.");
        }

        const stepIds = new Set<string>();
        for (const step of manifest.steps) {
            if (stepIds.has(step.id)) blockers.push(`Duplicate step id: "${step.id}".`);
            stepIds.add(step.id);
        }

        for (const step of manifest.steps) {
            for (const dependency of step.dependencies ?? []) {
                if (!stepIds.has(dependency)) {
                    blockers.push(`Step "${step.id}" depends on unknown step "${dependency}".`);
                }
                if (dependency === step.id) {
                    blockers.push(`Step "${step.id}" cannot depend on itself.`);
                }
            }
            if (!step.completionCriteria.length) {
                blockers.push(`Step "${step.id}" has no completion criteria.`);
            }
        }

        // 1. Tool Health Check
        for (const step of manifest.steps) {
            const health = await SentinelService.getSkillHealth(step.tool);
            if (health.reliabilityIndex < 30 && health.totalRuns > 5) {
                blockers.push(`Tool "${step.tool}" has critical reliability issues (${health.reliabilityIndex}%). Replacement recommended.`);
            } else if (health.reliabilityIndex < 60 && health.totalRuns > 2) {
                warnings.push(`Tool "${step.tool}" is unstable (${health.reliabilityIndex}%). Proceed with caution.`);
            }
        }

        // 2. DAG Validation (Cycle Detection)
        const adj = new Map<string, string[]>();
        manifest.steps.forEach(s => adj.set(s.id, s.dependencies ?? []));

        const visited = new Set<string>();
        const recStack = new Set<string>();

        const hasCycle = (u: string): boolean => {
            visited.add(u);
            recStack.add(u);
            for (const v of (adj.get(u) || [])) {
                if (!visited.has(v)) {
                    if (hasCycle(v)) return true;
                } else if (recStack.has(v)) {
                    return true;
                }
            }
            recStack.delete(u);
            return false;
        };

        for (const step of manifest.steps) {
            if (!visited.has(step.id)) {
                if (hasCycle(step.id)) {
                    blockers.push("Cyclic dependency detected in task manifest steps.");
                    break;
                }
            }
        }

        // 3. Manifest Risk Assessment
        if (manifest.steps.some(s => s.risk === "high")) {
            warnings.push("Manifest contains high-risk operations. Executive approval required.");
        }

        return {
            valid: blockers.length === 0,
            warnings,
            blockers
        };
    }

    /**
     * Stage 2: Alert (Pre-Flight)
     * Checks risk and emits SIG_USER_ALERT if needed.
     */
    async alert(step: TaskManifest["steps"][0], timeoutMs = 300000): Promise<{ proceed: boolean; reason?: string }> {
        // 1. Check Token Budget
        const budgetResult = await BudgetGovernanceService.checkAgentSalary(this.agentId, this.sessionId, step.estimatedTokens ?? undefined);
        
        if (!budgetResult.allowed) {
            logger.warn(`Budget limit exceeded for agent ${this.agentId}: ${budgetResult.message}. Escalating to Board Approval.`);
            const producer = await this.ensureProducer();
            
            const decision = await producer.propose(`SIG_BUDGET_EXCEEDED:${step.tool}`, {
                type: "budget_intervention",
                agentId: this.agentId,
                sessionId: this.sessionId,
                estimatedTokens: step.estimatedTokens,
                currentSpend: budgetResult.currentSpend,
                budget: budgetResult.budget,
                message: budgetResult.message
            }, timeoutMs);

            if (decision.approved) {
                // If human approves, we assume they increased the budget
                logger.info(`Budget intervention approved for agent ${this.agentId}. Proceeding.`);
                return { proceed: true };
            }

            return { proceed: false, reason: decision.reason || "Budget Exceeded" };
        }

        // 2. Multi-Agent Adversarial Consensus Deliberation for high-risk operations
        if (step.risk === "high") {
            try {
                const deliberation = await adversarialConsensusService.deliberate(
                    step.tool,
                    step.params || {},
                    {
                        organizationId: this.organizationId,
                        sessionId: this.sessionId,
                    }
                );

                if (deliberation.hasVeto || deliberation.decision === "vetoed") {
                    const vetoReason = deliberation.vetoReasons.join("; ") || "Vetoed by adversarial deliberation";
                    logger.warn(`[AutonomousLifecycle] High-risk step '${step.id}' (${step.tool}) vetoed by consensus sentinel: ${vetoReason}`);
                    return {
                        proceed: false,
                        reason: `Adversarial Consensus Veto: ${vetoReason}`
                    };
                }
            } catch (err: any) {
                logger.error(`[AutonomousLifecycle] Adversarial deliberation error for step '${step.id}': ${err.message}`);
            }
        }

        // 3. Strategic Produce (Risk-based HIL)
        const producer = await this.ensureProducer();
        const decision = await producer.produce({
            id: step.id,
            tool: step.tool,
            risk: step.risk,
            description: step.description,
            params: step.params
        }, timeoutMs);

        return {
            proceed: decision.approved,
            reason: decision.reason
        };
    }

    /**
     * Stage 2.5: Manifest Approval Gate
     * High-risk manifests require human approval before execution proceeds.
     */
    async proposeManifest(manifest: TaskManifest, timeoutMs = 3600000): Promise<{ proceed: boolean; reason?: string }> {
        if (manifest.riskLevel !== 'high') return { proceed: true };

        const producer = await this.ensureProducer();
        const decision = await producer.propose("SIG_MANIFEST_APPROVAL", {
            goal: manifest.goal,
            strategy: manifest.strategy,
            stepCount: manifest.steps.length,
            riskLevel: manifest.riskLevel
        }, timeoutMs);

        return {
            proceed: decision.approved,
            reason: decision.reason
        };
    }

    /**
     * Stage 3 & 4: Execute & Verify
     * Handled within the agent loop, with active verification, durable state checkpointing,
     * and 3-strike circuit-breaker detection.
     */
    async verify(
        step: TaskManifest["steps"][0],
        toolOutput: string,
        executeTool: (name: string, params: any) => Promise<string>,
        tokensUsed: number = 0,
        stepIndex: number = 0,
        totalSteps: number = 1
    ): Promise<StepVerificationResult> {
        const startNs = getMonotonicTimeNs();
        
        // Record actual token spend
        if (tokensUsed > 0) {
            await BudgetGovernanceService.recordSpend(this.agentId, this.sessionId, tokensUsed);
        }

        const logResult = async (success: boolean, error?: string) => {
            const durationNs = getMonotonicTimeNs() - startNs;
            if (success) {
                await SentinelService.logSuccess(step.tool, durationNs, { organizationId: this.organizationId });
            } else {
                await SentinelService.logFailure(step.tool, error || "Unknown Error", durationNs, { organizationId: this.organizationId });
            }
        };

        const recordCheckpoint = (success: boolean, observation: string): StepVerificationResult => {
            const checkpointOutcome = missionCheckpointService.recordStepOutcome({
                sessionId: this.sessionId,
                missionId: this.missionId,
                agentId: this.agentId,
                stepId: step.id,
                stepIndex,
                totalSteps,
                success,
                memorySnapshot: {
                    tool: step.tool,
                    hypothesis: step.hypothesis,
                    observation: observation.slice(0, 500),
                },
            });

            return {
                success,
                observation,
                checkpoint: checkpointOutcome.checkpoint,
                circuitBreakerTripped: checkpointOutcome.circuitBreakerTripped,
                circuitBreakerReason: checkpointOutcome.reason,
            };
        };

        if (!step.verificationTool) {
            // Even without a verification tool, check if the main tool output itself is an error string.
            if (typeof toolOutput === 'string' && (toolOutput.toLowerCase().startsWith('error') || toolOutput.toLowerCase().startsWith('file not found'))) {
                await logResult(false, toolOutput);
                return recordCheckpoint(false, `Tool reported error: ${toolOutput.slice(0, 500)}`);
            }
            await logResult(true);
            return recordCheckpoint(true, "No active verification required.");
        }

        logger.info(`Performing Active Verification for ${step.tool} using ${step.verificationTool}`);

        try {
            const verificationOutput = await executeTool(
                step.verificationTool,
                step.verificationParams ?? step.params,
            );
            
            // Check if the verification tool itself returned an error string
            if (typeof verificationOutput === 'string' && (verificationOutput.toLowerCase().startsWith('error') || verificationOutput.toLowerCase().startsWith('file not found'))) {
                await logResult(false, verificationOutput);
                return recordCheckpoint(false, `Verification tool ${step.verificationTool} returned failure: ${verificationOutput.slice(0, 500)}`);
            }

            await logResult(true);
            return recordCheckpoint(true, `Verification tool ${step.verificationTool} returned: ${verificationOutput.slice(0, 500)}`);
        } catch (e: any) {
            await logResult(false, e.message);
            return recordCheckpoint(false, `Verification failed: ${e.message}`);
        }
    }

    /**
     * Resolves remaining steps for an interrupted mission manifest based on verified checkpoints.
     */
    public getResumePlan(manifest: TaskManifest) {
        return missionCheckpointService.getResumePlan(this.sessionId, manifest.steps);
    }

    /**
     * Rolls back session execution to the latest verified checkpoint.
     */
    public rollbackToLastCleanCheckpoint() {
        return missionCheckpointService.rollbackToLastClean(this.sessionId);
    }

    /**
     * Retrieves the latest durable checkpoint for this session.
     */
    public getLatestCheckpoint(): MissionCheckpoint | null {
        return missionCheckpointService.getLatestCheckpoint(this.sessionId);
    }
}


