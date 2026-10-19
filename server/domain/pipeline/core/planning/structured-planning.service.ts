/**
 * Structured Planning Service for Mission/Pipeline Orchestration
 *
 * Research backing (AAAI 2026, WMAC): Formal joint intention theory and
 * distributed planning frameworks for multi-agent coordination.
 *
 * Implements:
 * - Planning scripts ("Routine" from Zeng et al. 2025)
 * - Task-Decoupled Planning (TDP) for specialized agents
 * - Shared goal models with mutual awareness
 * - Dependency tracking with rollback capabilities
 */

import { db } from "@server/database_service.js";
import { missions, missionRuns, pipelineSteps, pipelines } from "@shared/schema/index.js";
import { eq, and, sql, inArray, asc, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { aiRateLimiter, type AIProvider } from "@server/utils/ai-rate-limiter.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { orgJsonCompletion } from "@domain/ai/core/org-json-completion.js";

const logger = createLogger("StructuredPlanning");

/**
 * Planning Script ("Routine") - Structured plan representation
 * Bridges LLM output and execution engine
 */
export interface PlanningScript {
    id: string;
    missionId: number;
    version: number;
    goals: SharedGoal[];
    steps: PlannedStep[];
    dependencies: StepDependency[];
    agents: AgentAssignment[];
    rollbackPoints: RollbackPoint[];
    createdAt: Date;
    status: "draft" | "active" | "completed" | "failed";
}

/**
 * Shared Goal - Joint intention between agents
 */
export interface SharedGoal {
    id: string;
    description: string;
    parentGoalId?: string;
    subGoals: string[];
    assignedAgents: string[];
    successCriteria: string;
    priority: number;
    status: "pending" | "in_progress" | "achieved" | "failed";
    mutualAwareness: {
        knownBy: string[];
        acknowledgedAt: Date;
    };
}

/**
 * Planned Step with explicit dependencies
 */
export interface PlannedStep {
    id: string;
    goalId: string;
    sequence: number;
    description: string;
    agentType: "knowledge" | "code" | "data" | "orchestrator";
    action: string;
    inputs: Record<string, unknown>;
    expectedOutputs: string[];
    estimatedDuration: number; // seconds
    retryPolicy: {
        maxRetries: number;
        backoffStrategy: "fixed" | "exponential";
    };
    status: "pending" | "ready" | "executing" | "completed" | "failed";
}

/**
 * Step Dependency - Explicit coordination protocol
 */
export interface StepDependency {
    from: string;
    to: string;
    type: "sequential" | "parallel" | "conditional";
    condition?: string; // For conditional deps
}

/**
 * Agent Assignment - Task-Decoupled Planning
 */
export interface AgentAssignment {
    agentId: string;
    agentType: string;
    assignedGoals: string[];
    assignedSteps: string[];
    capabilities: string[];
    currentLoad: number;
    maxLoad: number;
}

/**
 * Rollback Point - Recovery strategy
 */
export interface RollbackPoint {
    id: string;
    stepId: string;
    snapshot: Record<string, unknown>;
    recoverySteps: string[];
}

/**
 * Plan Execution State
 */
export interface ExecutionState {
    scriptId: string;
    currentStepId: string | null;
    completedSteps: string[];
    failedSteps: string[];
    activeAgents: string[];
    sharedContext: Record<string, unknown>;
    startTime: Date;
    estimatedCompletion: Date;
}

/**
 * Structured Planning Service
 */
export const structuredPlanningService = {
    /**
     * Generate a structured planning script for a mission
     */
    async generatePlanningScript(
        missionId: number,
        orgContext: OrgContext,
        options: {
            useTDP?: boolean; // Task-Decoupled Planning
            maxAgents?: number;
        } = {}
    ): Promise<PlanningScript> {
        const startTime = Date.now();
        const { useTDP = true, maxAgents = 3 } = options;

        logger.info("Generating planning script", { missionId, useTDP, maxAgents });

        // Fetch mission details
        const [mission] = await db.select()
            .from(missions)
            .where(and(
                eq(missions.id, missionId),
                eq(missions.organizationId, orgContext.organizationId ?? 0)
            ))
            .limit(1);

        if (!mission) throw new Error(`Mission ${missionId} not found`);

        // Generate structured plan using AI
        const plan = await this.generatePlanWithAI(mission, orgContext, useTDP, maxAgents);

        // Store plan
        await this.storePlanningScript(plan);

        const duration = Date.now() - startTime;
        logger.info("Planning script generated", {
            missionId,
            scriptId: plan.id,
            steps: plan.steps.length,
            goals: plan.goals.length,
            durationMs: duration
        });

        return plan;
    },

    /**
     * Generate plan using AI with structured output
     */
    async generatePlanWithAI(
        mission: { id: number; name: string; description: string | null; objective: string | null },
        orgContext: OrgContext,
        useTDP: boolean,
        maxAgents: number
    ): Promise<PlanningScript> {
        const systemPrompt = `You are a mission planning expert using the WMAC (Weighted Multi-Agent Collaboration) framework.

${useTDP ? `
Use Task-Decoupled Planning (TDP):
- Assign specialized agents to specific domains:
  * "knowledge" agent: document extraction, semantic analysis, RAG queries
  * "code" agent: code generation, refactoring, validation
  * "data" agent: data transformation, pipeline execution, ETL
  * "orchestrator" agent: coordination, dependency management, monitoring
- Each agent handles their domain with explicit handoff protocols
` : `
Use centralized planning with a single orchestrator agent.
`}

Generate a structured planning script with:
1. Shared goals with mutual awareness requirements
2. Sequential and parallel step dependencies
3. Agent assignments based on capabilities
4. Rollback points for recovery

Output as JSON:
{
    "goals": [
        {
            "id": "goal_1",
            "description": "What to achieve",
            "subGoals": ["goal_2", "goal_3"],
            "assignedAgents": ["agent_1"],
            "successCriteria": "How we know it's done",
            "priority": 8
        }
    ],
    "steps": [
        {
            "id": "step_1",
            "goalId": "goal_1",
            "sequence": 1,
            "description": "What to do",
            "agentType": "knowledge|code|data|orchestrator",
            "action": "specific action name",
            "inputs": {},
            "expectedOutputs": ["output1"],
            "estimatedDuration": 60,
            "retryPolicy": { "maxRetries": 3, "backoffStrategy": "exponential" }
        }
    ],
    "dependencies": [
        { "from": "step_1", "to": "step_2", "type": "sequential|parallel|conditional", "condition": "optional" }
    ],
    "agents": [
        {
            "agentId": "agent_1",
            "agentType": "knowledge|code|data|orchestrator",
            "assignedGoals": ["goal_1"],
            "assignedSteps": ["step_1"],
            "capabilities": ["extraction", "embedding"],
            "currentLoad": 0,
            "maxLoad": 5
        }
    ],
    "rollbackPoints": [
        { "id": "rp_1", "stepId": "step_2", "recoverySteps": ["step_1"] }
    ]
}`;

        const userPrompt = `Create a planning script for this mission:
Name: ${mission.name}
Description: ${mission.description || "N/A"}
Goal: ${mission.objective || "N/A"}

Maximum agents: ${maxAgents}
Use Task-Decoupled Planning: ${useTDP ? "Yes" : "No"}`;

        try {
            const orgId = orgContext.organizationId ?? 0;

            // Gemini through the org-aware client, on the organization's own key
            // and inside its budget. This called OpenAI directly with a platform
            // key, which strict BYOK production does not have.
            const result = await aiRateLimiter.execute(
                "google" as AIProvider,
                orgId,
                async () => orgJsonCompletion({
                    organizationId: orgContext.organizationId,
                    systemPrompt,
                    userPrompt,
                    temperature: 0.2,
                }),
                {
                    priority: 1,
                    estimatedTokens: { input: 1500, output: 2000 },
                    model: "gemini-2.5-flash"
                }
            );

            const scriptId = `plan_${mission.id}_${Date.now()}`;

            // Enrich goals with mutual awareness
            const goals: SharedGoal[] = (result.goals || []).map((g: any) => ({
                ...g,
                status: "pending",
                mutualAwareness: {
                    knownBy: g.assignedAgents || [],
                    acknowledgedAt: new Date()
                }
            }));

            // Enrich steps with initial status
            const steps: PlannedStep[] = (result.steps || []).map((s: any) => ({
                ...s,
                status: "pending",
                retryPolicy: s.retryPolicy || { maxRetries: 3, backoffStrategy: "exponential" }
            }));

            return {
                id: scriptId,
                missionId: mission.id,
                version: 1,
                goals,
                steps,
                dependencies: result.dependencies || [],
                agents: result.agents || [],
                rollbackPoints: result.rollbackPoints || [],
                createdAt: new Date(),
                status: "draft"
            };

        } catch (error) {
            logger.error("Plan generation failed, using fallback", { error, missionId: mission.id });

            // Fallback: Simple sequential plan
            return {
                id: `plan_${mission.id}_${Date.now()}`,
                missionId: mission.id,
                version: 1,
                goals: [{
                    id: "fallback_goal",
                    description: mission.objective || "Complete mission",
                    subGoals: [],
                    assignedAgents: ["orchestrator_1"],
                    successCriteria: "Mission completed",
                    priority: 5,
                    status: "pending",
                    mutualAwareness: { knownBy: ["orchestrator_1"], acknowledgedAt: new Date() }
                }],
                steps: [{
                    id: "step_1",
                    goalId: "fallback_goal",
                    sequence: 1,
                    description: "Execute mission",
                    agentType: "orchestrator",
                    action: "execute_mission",
                    inputs: { missionId: mission.id },
                    expectedOutputs: ["result"],
                    estimatedDuration: 300,
                    retryPolicy: { maxRetries: 3, backoffStrategy: "exponential" },
                    status: "pending"
                }],
                dependencies: [],
                agents: [{
                    agentId: "orchestrator_1",
                    agentType: "orchestrator",
                    assignedGoals: ["fallback_goal"],
                    assignedSteps: ["step_1"],
                    capabilities: ["coordination"],
                    currentLoad: 0,
                    maxLoad: 5
                }],
                rollbackPoints: [],
                createdAt: new Date(),
                status: "draft"
            };
        }
    },

    /**
     * Store planning script
     */
    async storePlanningScript(_script: PlanningScript): Promise<void> {
        throw new Error("Not implemented: storePlanningScript requires a planning_scripts table");
    },

    /**
     * Execute a planning script with coordination
     */
    async executeScript(
        script: PlanningScript,
        orgContext: OrgContext,
        onStepComplete?: (step: PlannedStep, result: unknown) => void
    ): Promise<ExecutionState> {
        logger.info("Executing planning script", { scriptId: script.id, steps: script.steps.length });

        // Build execution DAG
        const stepMap = new Map(script.steps.map(s => [s.id, s]));
        const dependencyGraph = this.buildDependencyGraph(script.dependencies);

        // Initialize execution state
        const state: ExecutionState = {
            scriptId: script.id,
            currentStepId: null,
            completedSteps: [],
            failedSteps: [],
            activeAgents: script.agents.map(a => a.agentId),
            sharedContext: {},
            startTime: new Date(),
            estimatedCompletion: this.calculateETA(script)
        };

        // Execute steps respecting dependencies
        const readySteps = this.findReadySteps(state, dependencyGraph, stepMap);

        while (readySteps.length > 0) {
            // Execute ready steps (respecting max parallel)
            const executing = readySteps.splice(0, 3); // Max 3 parallel

            const results = await Promise.allSettled(
                executing.map(step => this.executeStep(step, state, orgContext))
            );

            // Process results
            results.forEach((result, index) => {
                const step = executing[index];
                if (result.status === "fulfilled") {
                    state.completedSteps.push(step.id);
                    onStepComplete?.(step, result.value);
                } else {
                    state.failedSteps.push(step.id);
                    logger.error("Step failed", { stepId: step.id, error: result.reason });

                    // Check for rollback point
                    const rollback = script.rollbackPoints.find(rp => rp.stepId === step.id);
                    if (rollback) {
                        logger.info("Initiating rollback", { rollbackPoint: rollback.id });
                        // Would execute recovery steps
                    }
                }
            });

            // Update ready queue
            readySteps.push(...this.findReadySteps(state, dependencyGraph, stepMap));
        }

        logger.info("Script execution complete", {
            scriptId: script.id,
            completed: state.completedSteps.length,
            failed: state.failedSteps.length
        });

        return state;
    },

    /**
     * Execute a single step with retry logic
     */
    async executeStep(
        step: PlannedStep,
        state: ExecutionState,
        orgContext: OrgContext
    ): Promise<unknown> {
        logger.info("Executing step", { stepId: step.id, agentType: step.agentType });

        let lastError: Error | undefined;

        for (let attempt = 0; attempt <= step.retryPolicy.maxRetries; attempt++) {
            try {
                // Update step status
                step.status = "executing";
                state.currentStepId = step.id;

                // Execute based on agent type
                const result = await this.executeByAgentType(step, state, orgContext);

                // Success
                step.status = "completed";
                state.sharedContext[step.id] = result;

                return result;

            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                step.status = "failed";

                if (attempt < step.retryPolicy.maxRetries) {
                    const delay = step.retryPolicy.backoffStrategy === "exponential"
                        ? Math.pow(2, attempt) * 1000
                        : 1000;
                    logger.warn(`Step failed, retrying after ${delay}ms`, { stepId: step.id, attempt });
                    await this.sleep(delay);
                }
            }
        }

        throw lastError || new Error(`Step ${step.id} failed after ${step.retryPolicy.maxRetries} retries`);
    },

    /**
     * Execute step based on agent type
     */
    async executeByAgentType(
        step: PlannedStep,
        state: ExecutionState,
        orgContext: OrgContext
    ): Promise<unknown> {
        switch (step.agentType) {
            case "knowledge":
            case "code":
            case "data":
                throw new Error(`Not implemented: executeByAgentType for agent type "${step.agentType}"`);

            case "orchestrator":
                return { status: "completed", agentType: "orchestrator", context: state.sharedContext };

            default:
                throw new Error(`Unknown agent type: ${step.agentType}`);
        }
    },

    /**
     * Build dependency graph from step dependencies
     */
    buildDependencyGraph(dependencies: StepDependency[]): Map<string, Set<string>> {
        const graph = new Map<string, Set<string>>();

        for (const dep of dependencies) {
            if (!graph.has(dep.to)) {
                graph.set(dep.to, new Set());
            }
            graph.get(dep.to)!.add(dep.from);
        }

        return graph;
    },

    /**
     * Find steps that are ready to execute (all dependencies completed)
     */
    findReadySteps(
        state: ExecutionState,
        dependencyGraph: Map<string, Set<string>>,
        stepMap: Map<string, PlannedStep>
    ): PlannedStep[] {
        const ready: PlannedStep[] = [];

        for (const [stepId, step] of stepMap) {
            // Skip if already completed or failed
            if (state.completedSteps.includes(stepId) || state.failedSteps.includes(stepId)) {
                continue;
            }

            // Check if all dependencies are satisfied
            const deps = dependencyGraph.get(stepId) || new Set();
            const allDepsCompleted = Array.from(deps).every(d =>
                state.completedSteps.includes(d)
            );

            if (allDepsCompleted && step.status === "pending") {
                step.status = "ready";
                ready.push(step);
            }
        }

        // Sort by sequence
        return ready.sort((a, b) => a.sequence - b.sequence);
    },

    /**
     * Calculate estimated completion time
     */
    calculateETA(script: PlanningScript): Date {
        const totalDuration = script.steps.reduce((sum, s) => sum + s.estimatedDuration, 0);
        return new Date(Date.now() + totalDuration * 1000);
    },

    /**
     * Update mutual awareness - agents acknowledge shared goals
     */
    async updateMutualAwareness(
        script: PlanningScript,
        agentId: string,
        goalId: string
    ): Promise<void> {
        const goal = script.goals.find(g => g.id === goalId);
        if (!goal) return;

        if (!goal.mutualAwareness.knownBy.includes(agentId)) {
            goal.mutualAwareness.knownBy.push(agentId);
            goal.mutualAwareness.acknowledgedAt = new Date();

            logger.info("Mutual awareness updated", {
                scriptId: script.id,
                agentId,
                goalId,
                knownBy: goal.mutualAwareness.knownBy
            });
        }
    },

    /**
     * Check if all agents have mutual awareness of critical goals
     */
    hasFullMutualAwareness(script: PlanningScript): boolean {
        const criticalGoals = script.goals.filter(g => g.priority >= 7);
        return criticalGoals.every(g =>
            g.assignedAgents.every(agentId =>
                g.mutualAwareness.knownBy.includes(agentId)
            )
        );
    },

    sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
};

export default structuredPlanningService;
