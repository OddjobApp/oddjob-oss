import { AIApiCallConfig } from "@shared/schema/index.js";
import { AIClient } from "@domain/ai/core/ai-client.service.js";
import { AgentStep, AgentContext, AgentLoopResult, TokenUsage, SupervisionLevel, GovernanceResolved, AgentTerminalReason } from "./types.js";
import { PromptBuilder } from "./prompt-builder.js";
import { ToolExecutor } from "@domain/tools/v1/tool-executor.service.js";
import { AutonomousLifecycleManager } from "@domain/ai/core/autonomous-lifecycle.service.js";
import { JanitorService } from "@domain/core/infrastructure/janitor.service.js";
import { CausalTracer } from "../../core/infrastructure/causal-tracer.service.js";
import { TraceContext as W3CTraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { logForensicEvent } from "@domain/core/infrastructure/tracing/trace-logger.service.js";
import { swarmCommunicationService } from "./swarm-communication.service.js";
import { criticService } from "./critic-service.js";
import { TaskManifest } from "@domain/ai/core/autonomous-lifecycle.service.js";
import { safeJsonParse } from "../../../utils/json-repair.js";
import { memoryService } from "@domain/mission/core/memory.service.js";
import { memoryOSService, PROMOTION_IMPORTANCE_THRESHOLD } from "./memory-os.service.js";
import { userRepresentationService } from "./user-representation.service.js";
import { roiService } from "@domain/mission/core/roi.service.js";
import { governorService } from "@domain/governor/index.js";
import { createLogger } from "@server/utils/logger.js";
import { cotService } from "./cot-self-consistency.service.js";
import { reactReflectionService } from "./react-reflection.service.js";
import { toolReceipt, type CopilotToolReceipt } from '@shared/copilot-action-receipt';

const logger = createLogger("AgentOrchestrator");

/**
 * Tool observations that are a "rich response" — a UI payload (a form, an app, an
 * instant app, a mode-switch prompt) that the chat renders as a real surface.
 *
 * These are surfaced to the user VERBATIM, bypassing synthesis, so anything the
 * loop prepends or appends to them lands on screen as visible JSON/scaffolding.
 * Every annotation site must check this first.
 */
const RICH_RESPONSE_TYPES = [
    "input_request",
    "mode_switch_request",
    "assistant_form",
    "assistant_app",
    "instant_app",
    "instant_app_surface",
    "launch_tutorial",
    // A published Form Studio form shared into the conversation (share_published_form).
    "form_studio_form",
] as const;

export function carriesRichResponse(observation: unknown): observation is string {
    if (typeof observation !== "string") return false;
    // Tolerate whitespace after the colon (`"type": "instant_app"`), which the
    // previous exact-substring checks missed whenever a tool pretty-printed.
    return RICH_RESPONSE_TYPES.some(t => new RegExp(`"type"\\s*:\\s*"${t}"`).test(observation));
}

const CONTEXT_LIMITS: Record<string, number> = {
    // Google Gemini
    'gemini-2.5-pro': 1000000,
    'gemini-2.0-flash': 1000000,
    'gemini-1.5-pro': 2000000,
    'gemini-1.5-flash': 1000000,
    // OpenAI
    'gpt-4o': 128000,
    'gpt-4': 8192,
    'gpt-3.5-turbo': 16385,
    // Anthropic
    'claude-3-5-sonnet': 200000,
    'claude-3-opus': 200000,
    // Ollama local models (conservative defaults; actual limits vary by model/hardware)
    'llama3.2:latest': 32768,
    'llama3.1:latest': 32768,
    'llama3:latest': 8192,
    'phi3:latest': 16384,
    'phi3.5:latest': 16384,
    'mistral:latest': 32768,
    'deepseek-r1:latest': 32768,
    'qwen2.5:latest': 32768,
    'default': 32768,
};

export class AgentOrchestrator {
    private history: AgentStep[] = [];
    private accumulatedUsage: TokenUsage = { totalTokens: 0 };
    private janitor: JanitorService;
    private lifecycle: AutonomousLifecycleManager;
    private causalTracer: CausalTracer;
    private recalledMemories: any[] = [];

    /**
     * Stable session key for MemoryOS working memory.
     *
     * Deliberately NOT `gen_${Date.now()}` like the lifecycle/tracer fallbacks:
     * those are computed once in the constructor, but this is read on every
     * iteration, and a key that changes per read would file each turn under a
     * different session and never consolidate any of them.
     */
    private readonly memorySessionId: string;


    constructor(
        private client: AIClient,
        private apiKey: string,
        private context: AgentContext
    ) {
        this.janitor = new JanitorService(client, apiKey);
        this.lifecycle = new AutonomousLifecycleManager(
            context.sessionId || `gen_${Date.now()}`,
            context.jobId ?? 0,
            client,
            apiKey,
            undefined,
            context.organizationId,
            context.missionId,
            context.jobId
        );
        this.causalTracer = new CausalTracer({
            sessionId: context.sessionId || `gen_${Date.now()}`,
            organizationId: context.organizationId,
            jobId: context.jobId,
            missionId: context.missionId,
            userId: context.userId
        });
        this.memorySessionId =
            context.sessionId
            || (context.jobId ? `job_${context.jobId}` : null)
            || (context.missionId ? `mission_${context.missionId}` : null)
            || `gen_${Date.now()}`;
    }

    /**
     * Best-effort progress emit for streaming clients. Never throws into the
     * loop — a broken/slow SSE sink must not affect agent execution.
     */
    private emitStatus(evt: import("./types.js").AgentStatusEvent): void {
        try {
            this.context.onStatus?.(evt);
        } catch { /* streaming is best-effort */ }
    }

    async run(
        goal: string,
        initialConfig: AIApiCallConfig,
        tools: any[],
        maxIterations: number,
        supervisionLevel: SupervisionLevel = "full",
        governorConfig?: GovernanceResolved,
        traceContext?: W3CTraceContext,
        dryRun: boolean = false
    ): Promise<AgentLoopResult> {
        // Initial setup
        // Swiss Cheese Layer 1 Input Validation & Threat Sanitization
        try {
            const { swissCheeseGuardrailService } = await import("@domain/governor/core/swiss-cheese-guardrail.service.js");
            const inputCheck = swissCheeseGuardrailService.evaluateLayer1_Input(goal);
            if (!inputCheck.passed) {
                logger.warn(`[SwissCheese] Agent goal blocked by Layer 1 Guardrail: ${inputCheck.reasoning}`);
                return {
                    output: `Execution blocked by safety guardrail: ${inputCheck.reasoning}`,
                    usage: { totalTokens: 0 },
                    history: [
                        { type: "system", content: `Execution blocked by safety guardrail: ${inputCheck.reasoning}` },
                        {
                            type: "run_outcome",
                            content: "Run ended: blocked_by_guardrail before planning.",
                            metadata: {
                                terminalReason: "blocked_by_guardrail" satisfies AgentTerminalReason,
                                iterationsUsed: 0,
                                maxIterations,
                                lastProgressIteration: 0,
                                consecutiveNoProgress: 0,
                                stallEvents: 0,
                                totalTokens: 0,
                            },
                        },
                    ]
                };
            }
        } catch {
            // Non-blocking fallback if module resolution fails
        }

        // Conversational Fast-Track: Skip planner for simple greetings or acknowledgments to save 2-3s of LLM latency
        const isConversational = goal.length < 50 && /^(hi|hello|hey|thanks|thank you|ok|okay|got it|bye|goodbye|how are you|test|ping|greet)(\s|[.!?]|$)/i.test(goal.trim());
        const isTriage = tools.some(t => t.name === "generateAssetDiagnosticQuestions") || goal.includes("Report a problem");
        
        let manifestation: any;
        if (isConversational || isTriage) {
            manifestation = { 
                goal, 
                strategy: isTriage ? "Diagnostic triage flow." : "Direct conversational response.", 
                steps: [], 
                createdAt: new Date().toISOString(), 
                riskLevel: "low" 
            };
        } else {
            this.emitStatus({ phase: "planning", label: "Planning the approach…" });
            manifestation = await this.lifecycle.plan(goal, tools);
            const manifestCheck = await this.lifecycle.verifyManifest(manifestation);
            if (!manifestCheck.valid) {
                logger.error("Generated task manifest failed pre-flight validation", {
                    blockers: manifestCheck.blockers,
                    warnings: manifestCheck.warnings,
                });
                return {
                    output: `I couldn't produce a safe, executable plan for this objective. ${manifestCheck.blockers.join(" ")}`,
                    usage: { totalTokens: 0 },
                    history: [
                        {
                            type: "system",
                            content: `Plan validation failed: ${manifestCheck.blockers.join("; ")}`,
                        },
                        {
                            type: "run_outcome",
                            content: "Run ended: plan_rejected before any iteration.",
                            metadata: {
                                terminalReason: "plan_rejected" satisfies AgentTerminalReason,
                                iterationsUsed: 0,
                                maxIterations,
                                lastProgressIteration: 0,
                                consecutiveNoProgress: 0,
                                stallEvents: 0,
                                totalTokens: 0,
                                blockers: manifestCheck.blockers,
                            },
                        },
                    ],
                };
            }
            if (manifestCheck.warnings.length > 0) {
                logger.warn("Task manifest pre-flight warnings", { warnings: manifestCheck.warnings });
            }
        }
        let internalActiveTools = [...tools];

        this.history.push({ type: "system", content: `Goal initiated: ${goal}` });

        // Open the MemoryOS working-memory record for this run. Recorded here
        // rather than in perceive() because perceive runs once per iteration and
        // would file the same goal a dozen times.
        try {
            memoryOSService.recordShortTerm({
                sessionId: this.memorySessionId,
                role: "user",
                content: goal,
                metadata: { organizationId: this.context.organizationId, role: "user" },
            });
        } catch (e) {
            logger.warn("MemoryOS short-term record failure", { error: (e as Error).message });
        }

        let currentIteration = 0;
        let criticRetries = 0;
        const MAX_CRITIC_RETRIES = 2;
        let nextAttachments: any[] = [];

        // ── Stall Detection State ─────────────────────────────────────────────
        // Tracks consecutive iterations without meaningful progress (no tool calls
        // that produce file writes or successful test runs).
        const executionStrategy = this.context.executionStrategy ?? null;
        const maxConsecutiveFailures = this.context.maxConsecutiveFailures ?? executionStrategy?.max_consecutive_failures ?? null;
        const checkpointInterval = this.context.checkpointInterval ?? executionStrategy?.checkpoint_every_n_iterations ?? null;
        let consecutiveNoProgress = 0;
        let lastProgressIteration = 0;
        let stallEvents = 0;
        const STALL_INDICATORS = ["Error:", "Error reading", "Error writing", "Command Failed", "nothing to commit"];

        /**
         * File exactly one terminal record per run.
         *
         * `agent_run_steps` recorded every step and no outcome, so a run that
         * answered the goal and a run that burned through its iteration budget
         * were indistinguishable afterwards — you could count steps per runId
         * and still not know whether any of them worked. Every number below was
         * already computed by this loop and then dropped on the way out.
         *
         * It rides the existing history → persistAgentHistory path, so it lands
         * under the same runId as the rest of the run with no new table.
         */
        const recordOutcome = (terminalReason: AgentTerminalReason) => {
            this.history.push({
                type: "run_outcome",
                content: `Run ended: ${terminalReason} after ${currentIteration}/${maxIterations} iterations.`,
                metadata: {
                    terminalReason,
                    iterationsUsed: currentIteration,
                    maxIterations,
                    // How far the run got before it last made measurable progress.
                    // Equal to iterationsUsed on a healthy run; far behind it on a
                    // run that spun.
                    lastProgressIteration,
                    consecutiveNoProgress,
                    stallEvents,
                    totalTokens: this.accumulatedUsage.totalTokens ?? 0,
                },
            });
        };

        while (currentIteration < maxIterations) {
            currentIteration++;

            // 1. PERCEPTION PHASE
            const perception = await this.perceive(goal, internalActiveTools);

            // 1.5. MODEL ROUTING — Resolve model tier based on available tools and iteration context
            let routedConfig = initialConfig;
            let routingDecision: any = null;
            try {
                const { modelRoutingService } = await import("./model-routing/index.js");
                
                // Determine dominant tool type from available tools (heuristic: 
                // if agent mostly has read tools, route to economy; if it has write tools, premium)
                const lastAction = this.history.filter(h => h.type === "observation").slice(-1)[0];
                const likelyNextToolType = lastAction?.content?.includes("Successfully wrote") ? "write_tools" 
                    : lastAction?.content?.includes("Error") ? "write_tools" // errors usually need premium to recover
                    : "read_tools"; // default to economy for exploration phases

                // Find the most representative tool definition
                const representativeTool = internalActiveTools.find((t: any) => {
                    if (likelyNextToolType === "write_tools") return t.name?.includes("write") || t.sideEffects?.includes("file-system");
                    return t.idempotency === "read-safe" || t.name?.includes("read");
                }) || internalActiveTools[0];

                routingDecision = modelRoutingService.resolveModelTier(
                    representativeTool?.name || "unknown",
                    representativeTool || null,
                    { orgId: this.context.organizationId, missionId: this.context.missionId, agentId: String(this.context.jobId) }
                );

                if (routingDecision.tier === "economy" && routingDecision.model !== initialConfig.model) {
                    routedConfig = { ...initialConfig, model: routingDecision.model };
                }
            } catch {
                // Routing failure → use original config (graceful degradation)
            }

            // Enforce model cap governance policy (NemoClaw parity)
            if (governorConfig?.enabled && governorConfig.rules?.length > 0) {
                try {
                    const modelToCheck = routedConfig.model || initialConfig.model || "default";
                    governorService.validateModel(modelToCheck, governorConfig.rules);
                } catch (govError: any) {
                    logger.error(`Governance Block: Model check failed. ${govError.message}`);
                    throw govError;
                }
            }

            // 2. COGNITIVE PHASE
            this.emitStatus({ phase: "thinking", label: "Thinking…", iteration: currentIteration });
            const thought = await this.think(
                goal, 
                perception.simulatedExperience, 
                perception.formattedMemories, 
                internalActiveTools, 
                routedConfig, 
                currentIteration, 
                manifestation, 
                governorConfig,
                nextAttachments
            );

            if (thought.isFinal) {
                // 4. SYNTHESIS PHASE (Final Answer)
                this.emitStatus({ phase: "synthesizing", label: "Composing the answer…" });
                const synthesis = await this.synthesize(
                    goal, 
                    thought.output, 
                    perception.simulatedExperience, 
                    supervisionLevel, 
                    criticRetries, 
                    MAX_CRITIC_RETRIES,
                    manifestation
                );

                if (synthesis.retryWithFeedback) {
                    criticRetries++;
                    this.history.push({ type: "system", content: synthesis.retryWithFeedback });
                    continue;
                }

                await this.recordMemoryUtilization(true);
                await this.consolidateWorkingMemory(synthesis.finalAnswer || "");
                recordOutcome("converged");
                return { output: synthesis.finalAnswer || "", usage: this.accumulatedUsage, history: this.history };
            }


            // 3. EXECUTION PHASE
            for (const block of thought.actionBlocks || []) {
                const toolName = (block as any)?.tool || (block as any)?.action;
                if (toolName) {
                    this.emitStatus({ phase: "tool", tool: toolName, label: `Using ${String(toolName).replace(/_/g, " ")}…`, iteration: currentIteration });
                }
            }
            const execution = await this.act(
                goal,
                thought.actionBlocks, 
                internalActiveTools, 
                manifestation, 
                supervisionLevel, 
                currentIteration, 
                dryRun, 
                traceContext
            );

            // Process observations
            execution.observations.forEach((observation, index) => {
                this.history.push({ type: "observation", content: observation, metadata: { receipt: execution.receipts[index] } });
                this.persistSharedMemory(observation);
            });

            // ── Model Routing Telemetry ───────────────────────────────────────
            // Record the routing decision for cost tracking
            if (routingDecision) {
                try {
                    const { db } = await import("@server/database_service.js");
                    const { routingTelemetry } = await import("@shared/schema/index.js");
                    db.insert(routingTelemetry).values({
                        missionRunId: this.context.missionId ?? null,
                        routingDecision: routingDecision.tier,
                        entropy: 0, // tool-level routing doesn't use entropy
                        modelUsed: routingDecision.model,
                        costSavings: routingDecision.tier === "economy" ? 0.01 : 0, // estimated per-call savings
                    }).catch(() => {}); // fire-and-forget
                } catch { /* non-blocking telemetry */ }
            }

            // ── Stall Detection ───────────────────────────────────────────────
            // Check if this iteration produced meaningful progress
            const hasProgress = execution.observations.some(obs => {
                const obsStr = typeof obs === "string" ? obs : JSON.stringify(obs);
                // Positive signals: successful file write, test pass, commit, etc.
                const positiveSignals = ["Successfully wrote", "Committed:", "Created and switched to branch", "Pushed"];
                const isPositive = positiveSignals.some(sig => obsStr.includes(sig));
                // Negative signals: errors, no-ops
                const isNegative = STALL_INDICATORS.some(sig => obsStr.includes(sig));
                return isPositive && !isNegative;
            });

            if (hasProgress) {
                consecutiveNoProgress = 0;
                lastProgressIteration = currentIteration;
            } else if (execution.observations.length > 0) {
                consecutiveNoProgress++;
            }

            // If we've stalled for too many iterations, inject a re-planning prompt
            if (maxConsecutiveFailures && consecutiveNoProgress >= maxConsecutiveFailures) {
                this.history.push({
                    type: "system",
                    content: `⚠️ STALL DETECTED: ${consecutiveNoProgress} consecutive iterations without progress. Last progress was at iteration ${lastProgressIteration}. STOP and RE-PLAN your approach. What is blocking you? Try a different strategy or ask for help.`
                });
                
                // Emit guardrail event for observability
                try {
                    const { crossAppEventBus, CrossAppEventType } = await import("@domain/org/core/event-bus.service.js");
                    await crossAppEventBus.publish({
                        type: CrossAppEventType.GUARDRAIL_STALL_DETECTED,
                        organizationId: this.context.organizationId,
                        sourceApp: "agent_orchestrator",
                        payload: {
                            jobId: this.context.jobId,
                            missionId: this.context.missionId,
                            iteration: currentIteration,
                            consecutiveNoProgress,
                            lastProgressIteration,
                            guardrailType: "stall_detection",
                        },
                    });
                } catch { /* best effort */ }
                
                stallEvents++;
                consecutiveNoProgress = 0; // Reset to give the new plan a chance
            }

            // Emit checkpoint at configured intervals
            if (checkpointInterval && currentIteration % checkpointInterval === 0) {
                this.history.push({
                    type: "system",
                    content: `📍 CHECKPOINT (iteration ${currentIteration}/${maxIterations}): Summarize progress so far. What has been completed? What remains?`
                });
            }

            // Check for interruptions
            if (execution.interruption) {
                recordOutcome("interrupted");
                return { output: execution.interruption, usage: this.accumulatedUsage, history: this.history };
            }

            if (execution.observations.length === 0) {
                this.history.push({ type: "system", content: "Error: No valid actions were performed. Retrying..." });
            }
        }

        // Emit guardrail event for iteration limit exhaustion
        try {
            const { crossAppEventBus, CrossAppEventType } = await import("@domain/org/core/event-bus.service.js");
            await crossAppEventBus.publish({
                type: CrossAppEventType.GUARDRAIL_ITERATION_LIMIT,
                organizationId: this.context.organizationId,
                sourceApp: "agent_orchestrator",
                payload: {
                    jobId: this.context.jobId,
                    missionId: this.context.missionId,
                    maxIterations,
                    guardrailType: "iteration_limit_exhausted",
                },
            });
        } catch { /* best effort */ }

        await this.recordMemoryUtilization(false);
        recordOutcome("iteration_limit");
        return {
            output: `Stopped after ${maxIterations} iterations.`,
            usage: this.accumulatedUsage,
            history: this.history
        };
    }

    private async perceive(goal: string, internalActiveTools: any[]) {
        let simulatedExperience = "";
        let retrievedRetrospectives = [];
        const isTriage = internalActiveTools.some(t => t.name === "generateAssetDiagnosticQuestions") || goal.includes("Report a problem");
        
        if (!isTriage) {
            try {
                const { ragService } = await import("@domain/knowledge/core/rag/rag-service.js");
                const result = await ragService.fetchRelevantExamples(
                    goal,
                    this.context.jobId || null,
                    this.context.organizationId,
                    0.7,
                    this.context.appDeploymentId
                );
                const context = result.context;
                retrievedRetrospectives = (result as any).retrospectives || [];

                if (context) {
                    simulatedExperience = `\n=== SIMULATED EXPERIENCE (PAST SUCCESSFUL PLANS) ===\n${context}\n====================================================\n`;
                }

                // Persist retrospectives
                if (this.context.jobId && retrievedRetrospectives.length > 0) {
                    const { missionRunService } = await import("@domain/mission/core/mission-run.service.js");
                    const run = await missionRunService.getById(this.context.jobId);
                    if (run && !((run.missionContext as any) || {}).retrospectives) {
                        await missionRunService.update(this.context.jobId, {
                            missionContext: { ...((run.missionContext as any) || {}), retrospectives: retrievedRetrospectives }
                        });
                    }
                }
            } catch (e) {
                logger.warn("Perception failure", { error: (e as Error).message });
            }
        }

            // Dynamic Tool Discovery
            if (this.context.missionId) {
                try {
                    const { getAgentTools } = await import("@domain/tools/v1/tool-registry.service.js");
                    const latestRegistry = getAgentTools();
                    for (const [name, def] of Object.entries(latestRegistry)) {
                        if (def.group === "External MCP" && !internalActiveTools.find(at => at.name === name)) {
                            internalActiveTools.push(def);
                            this.history.push({ type: "system", content: `NEW CAPABILITY ENROLLED: ${name}. ${def.description}` });
                        }
                    }
                } catch (e) {
                    logger.warn("Perception Tool Discovery failure", { error: (e as Error).message });
                }
            }

        let formattedMemories = "";
        if (this.context.missionId) {
            try {
                formattedMemories = await memoryService.getFormattedMemories(this.context.missionId);
            } catch (e) {
                logger.warn("Memory retrieval failure", { error: (e as Error).message });
            }

            // --- Across-Missions Memory Integration ---
            try {
                const { db } = await import("@server/database_service.js");
                const { missions } = await import("@shared/schema/index.js");
                const { eq } = await import("drizzle-orm");
                const { agentMemoryAcrossMissionsService } = await import("@domain/agents/core/agent-memory-across-missions.service.js");

                const [mission] = await db.select().from(missions).where(eq(missions.id, this.context.missionId)).limit(1);
                if (mission) {
                    const repositoryId = agentMemoryAcrossMissionsService.resolveRepositoryId(mission);
                    const planContent = mission.blackboard?.plan || mission.blackboard?.implementationPlan || mission.objective || goal;
                    
                    const { formattedMemoryContext, patterns, lessons } = await agentMemoryAcrossMissionsService.recallPriorKnowledge(
                        this.context.organizationId,
                        this.context.jobId ? String(this.context.jobId) : (this.context.agentId || "default"),
                        repositoryId,
                        planContent || goal
                    );

                    this.recalledMemories = [...patterns, ...lessons];

                    if (formattedMemoryContext) {
                        formattedMemories = formattedMemoryContext + "\n\n" + formattedMemories;
                    }
                }
            } catch (e: any) {
                logger.warn("Across-missions memory recall failure", { error: e.message });
            }
        }

        // Inject dialectic-derived user representation (preferences, goals,
        // communication style) so the agent can personalize without a
        // separate prompt. Bounded by getContextString (~600 tokens worst case).
        if (this.context.organizationId && this.context.userId) {
            try {
                const userContext = await userRepresentationService.getContextString(
                    this.context.organizationId,
                    this.context.userId,
                );
                if (userContext) {
                    formattedMemories = formattedMemories
                        ? `${formattedMemories}\n\n${userContext}`
                        : userContext;
                }
            } catch (e) {
                logger.warn("User-representation injection failure", { error: (e as Error).message });
            }
        }

        // Theory of Mind — synchronous cognitive/intent assessment + context injection.
        // Runs AFTER user-representation so the sync assessor's state is fresh
        // before we build the ToM context string. Fail-open: on any error, log
        // warning and continue without ToM context (Requirement 10.4).
        if (this.context.organizationId && this.context.userId) {
            try {
                const conversationContext: Array<{ role: string; content: string }> =
                    (this.context.previousHistory || []).map((h: any) => ({
                        role: h.role,
                        content: typeof h.content === "string" ? h.content : String(h.content ?? ""),
                    }));
                const sessionId = this.context.sessionId || `gen_${Date.now()}`;

                // 1. Run sync assessor — updates cognitive state + intent model in DB/cache
                const { tomSyncAssessor } = await import("@domain/agents/core/tom-sync-assessor.js");
                await tomSyncAssessor.assess(
                    goal,
                    conversationContext,
                    this.context.organizationId,
                    this.context.userId,
                    sessionId,
                );

                // 2. Inject ToM context string (reflects freshly assessed state)
                const { theoryOfMindService } = await import("@domain/agents/core/theory-of-mind.service.js");
                const tomContext = await theoryOfMindService.getContextString(
                    this.context.organizationId,
                    this.context.userId,
                );
                if (tomContext) {
                    formattedMemories = formattedMemories
                        ? `${formattedMemories}\n\n${tomContext}`
                        : tomContext;
                }

                // 3. Enqueue async extraction job (background deep belief/expectation extraction)
                const { enqueueExtractionJob } = await import("@domain/agents/core/tom-async-extractor.js");
                await enqueueExtractionJob({
                    organizationId: this.context.organizationId,
                    userId: this.context.userId,
                    userMessage: goal,
                    conversationTail: conversationContext.slice(-10),
                    sessionId,
                });
            } catch (e) {
                logger.warn("Theory-of-mind injection failure", { error: (e as Error).message });
            }
        }

        // MemoryOS unified recall — session working memory plus vector-ranked
        // cross-mission long-term memory. This is the only path that brings
        // `agent_long_term_memories` into an agent run; the blocks above cover
        // mission memory, the across-missions KG, user representation and ToM,
        // and none of them read it.
        //
        // limitShortTerm is 0 on purpose: the transcript is already in the
        // prompt via previousHistory, so replaying it here would only spend
        // tokens saying the same thing twice.
        if (this.context.organizationId) {
            try {
                const bundle = await memoryOSService.recallUnifiedContext({
                    sessionId: this.memorySessionId,
                    organizationId: this.context.organizationId,
                    userId: this.context.userId,
                    queryText: goal,
                    limitShortTerm: 0,
                    limitMidTerm: 4,
                    limitLongTerm: 5,
                });

                if (bundle.synthesizedContextString) {
                    formattedMemories = formattedMemories
                        ? `${formattedMemories}\n\n${bundle.synthesizedContextString}`
                        : bundle.synthesizedContextString;
                }
            } catch (e) {
                logger.warn("MemoryOS unified recall failure", { error: (e as Error).message });
            }
        }

        return { simulatedExperience, formattedMemories };
    }

    /**
     * Close out the run's working memory: record the answer, then extract any
     * durable insights and let the high-importance ones promote to long-term.
     *
     * Awaited rather than fire-and-forget. It costs one extraction call at the
     * end of a run that already took seconds, and a backgrounded version would
     * swallow its own failures — which is how the previous generation of this
     * pipeline came to hold 51 rows that all said the same thing.
     */
    private async consolidateWorkingMemory(finalAnswer: string): Promise<void> {
        if (!this.context.organizationId) return;

        try {
            if (finalAnswer) {
                memoryOSService.recordShortTerm({
                    sessionId: this.memorySessionId,
                    role: "agent",
                    content: finalAnswer,
                    metadata: { organizationId: this.context.organizationId, role: "assistant" },
                });
            }

            const insights = await memoryOSService.consolidateSession(
                this.memorySessionId,
                this.context.organizationId,
                this.context.userId,
            );

            if (insights.length > 0) {
                logger.info("MemoryOS consolidated session", {
                    sessionId: this.memorySessionId,
                    insights: insights.length,
                    promoted: insights.filter(i => i.importance >= PROMOTION_IMPORTANCE_THRESHOLD).length,
                });
            }
        } catch (e) {
            logger.warn("MemoryOS consolidation failure", { error: (e as Error).message });
        }
    }

    private async think(
        goal: string, 
        simulatedExperience: string, 
        formattedMemories: string, 
        internalActiveTools: any[], 
        initialConfig: AIApiCallConfig, 
        currentIteration: number,
        manifestation: any,
        governorConfig?: GovernanceResolved,
        nextAttachments: any[] = []
    ) {
        const toolDescriptions = internalActiveTools.map((t: any) => `${t.name}: ${t.description}`).join('\n');
        
        // Fetch past mistakes
        let pastMistakes: any[] = [];
        try {
            pastMistakes = await criticService.getRelevantCritiques(goal);
        } catch (e) { }

        const systemPrompt = PromptBuilder.buildSystemInstructions(
            goal,
            toolDescriptions,
            initialConfig.systemIdentity || "You are a helpful AI agent.",
            initialConfig.systemPrompt,
            formattedMemories || simulatedExperience,
            initialConfig.systemPromptAddition,
            undefined,
            manifestation,
            this.context.remainingBudgetUsd,
            this.context.reasoningProtocol,
            pastMistakes.length > 0 ? pastMistakes : undefined
        );

        let userPrompt = PromptBuilder.buildTurnPrompt(goal, this.history, currentIteration, this.context);

        // Apply Chain-of-Thought with Self-Consistency if enabled
        const enableCoTSC = process.env.ENABLE_COT_SELF_CONSISTENCY === "true" || 
                           (initialConfig as any).enableCoTSC === true;
        
        // Apply ReAct with Reflection if enabled
        const enableReAct = process.env.ENABLE_REACT_REFLECTION === "true" || 
                          (initialConfig as any).enableReAct === true;
        
        let res: any;
        
        if (enableReAct && currentIteration === 1) {
            // Runs on iteration 1 only: builds a reasoning chain that is injected as
            // context for all subsequent iterations rather than re-running each turn.
            logger.info(`[AgentOrchestrator] Applying ReAct with Reflection for goal: ${goal.substring(0, 50)}...`);
            
            const reactResult = await reactReflectionService.executeReActLoop(
                goal,
                internalActiveTools,
                Math.min(currentIteration, 5), // Limit ReAct iterations
                {
                    enabled: true,
                    maxReflections: 2,
                    reflectionThreshold: 0.6,
                    enableSelfCritique: true,
                    learningFromFailures: true
                },
                { provider: initialConfig.model?.includes('gemini') ? 'google' : 'google' }
            );

            // Log ReAct results
            logger.info(`[AgentOrchestrator] ReAct completed: ${reactResult.steps.length} steps, success: ${reactResult.success}`);
            this.history.push({ 
                type: "system", 
                content: `ReAct applied: ${reactResult.steps.length} reasoning steps, success: ${reactResult.success}` 
            });
            
            // Use ReAct reasoning as additional context
            const reactContext = reactResult.steps.map((step, i) => 
                `Step ${i + 1}: ${step.thought.content}${step.reflection ? ` (Reflection: ${step.reflection.critique})` : ''}`
            ).join('\n');
            
            userPrompt = `## REASONING CONTEXT (ReAct)\n${reactContext}\n\n## CURRENT TASK\n${userPrompt}`;
            
            // Proceed with standard execution using ReAct-enhanced context
            const runConfig: AIApiCallConfig = {
                ...initialConfig,
                userPrompt,
                systemPrompt,
                temperature: 0,
                attachments: [...(initialConfig.attachments || []), ...nextAttachments],
            };

            // Redaction
            if (governorConfig?.enabled && governorConfig.rules?.length > 0) {
                runConfig.userPrompt = governorService.redactSensitiveData(runConfig.userPrompt, governorConfig.rules);
                if (runConfig.systemPrompt) {
                    runConfig.systemPrompt = governorService.redactSensitiveData(runConfig.systemPrompt, governorConfig.rules);
                }
            }

            res = await this.client.execute(runConfig, undefined, this.apiKey);
        } else if (enableCoTSC && currentIteration === 1) {
            // Runs on iteration 1 only: the consensus answer seeds context for later turns.
            logger.info(`[AgentOrchestrator] Applying CoT-SC for goal: ${goal.substring(0, 50)}...`);
            
            const cotResult = await cotService.applyCoT(
                goal,
                systemPrompt + "\n\n" + userPrompt,
                {
                    enabled: true,
                    numPaths: parseInt(process.env.COT_NUM_PATHS || "3", 10),
                    temperature: 0.7,
                    votingStrategy: "majority",
                    minConfidence: 0.6
                },
                { provider: initialConfig.model?.includes('gemini') ? 'google' : 'google' }
            );

            // Log CoT-SC results
            logger.info(`[AgentOrchestrator] CoT-SC confidence: ${cotResult.confidence.toFixed(2)}`);
            this.history.push({ 
                type: "system", 
                content: `CoT-SC applied: ${cotResult.confidence.toFixed(2)}% confidence across ${cotResult.allPaths.length} paths` 
            });
            
            // Use the reasoning summary as additional context
            userPrompt = `${cotResult.reasoningSummary}\n\n${userPrompt}`;
            
            // Proceed with normal execution using enhanced context
            const runConfig: AIApiCallConfig = {
                ...initialConfig,
                userPrompt,
                systemPrompt,
                temperature: 0,
                attachments: [...(initialConfig.attachments || []), ...nextAttachments],
            };

            // Redaction
            if (governorConfig?.enabled && governorConfig.rules?.length > 0) {
                runConfig.userPrompt = governorService.redactSensitiveData(runConfig.userPrompt, governorConfig.rules);
                if (runConfig.systemPrompt) {
                    runConfig.systemPrompt = governorService.redactSensitiveData(runConfig.systemPrompt, governorConfig.rules);
                }
            }

            res = await this.client.execute(runConfig, undefined, this.apiKey);
        } else {
            // Standard execution
            const runConfig: AIApiCallConfig = {
                ...initialConfig,
                userPrompt,
                systemPrompt,
                temperature: 0,
                attachments: [...(initialConfig.attachments || []), ...nextAttachments],
            };

            // Redaction
            if (governorConfig?.enabled && governorConfig.rules?.length > 0) {
                runConfig.userPrompt = governorService.redactSensitiveData(runConfig.userPrompt, governorConfig.rules);
                if (runConfig.systemPrompt) {
                    runConfig.systemPrompt = governorService.redactSensitiveData(runConfig.systemPrompt, governorConfig.rules);
                }
            }

            res = await this.client.execute(runConfig, undefined, this.apiKey);
        }
        
        if (!res.success) throw new Error(`Agent LLM failed: ${res.error}`);

        // Track usage
        if (res.metadata?.tokensUsed) {
            this.accumulatedUsage.totalTokens += res.metadata.tokensUsed;
            this.accumulatedUsage.promptTokens = (this.accumulatedUsage.promptTokens || 0) + (res.metadata.promptTokens || 0);
            this.accumulatedUsage.completionTokens = (this.accumulatedUsage.completionTokens || 0) + (res.metadata.completionTokens || 0);
            if (this.context.jobId) {
                roiService.recordIterationCost(
                    this.context.jobId, initialConfig.model || "default", 
                    res.metadata.promptTokens || 0, res.metadata.completionTokens || 0,
                    this.context.isShadow
                ).catch(() => {});
            }
        }

        let output = res.output || "";
        let actionBlocks: any[] = [];
        let isFinal = false;

        if (this.context.reasoningProtocol === 'hermes_xml') {
            const { HermesProtocolService } = await import("./hermes-protocol.service.js");
            const parsed = HermesProtocolService.parseResponse(output);
            if (parsed.thought) this.history.push({ type: "thought", content: parsed.thought });
            
            if (parsed.toolCalls.length > 0) {
                actionBlocks = parsed.toolCalls.map(tc => ({ tool: tc.name, params: tc.arguments }));
            } else {
                isFinal = true;
                output = parsed.content;
            }
        } else {
            // Support for <thought> tags in standard JSON mode
            const thoughtMatch = output.match(/<thought>([\s\S]*?)<\/thought>/i);
            if (thoughtMatch) {
                const thoughtContent = thoughtMatch[1].trim();
                this.history.push({ type: "thought", content: thoughtContent });
                this.broadcastThought(thoughtContent, currentIteration);
                // Optionally remove thought from output before JSON extraction to avoid confusion
                output = output.replace(thoughtMatch[0], "").trim();
            } else {
                // Legacy fallback: treat entire output as thought if no tags found
                this.history.push({ type: "thought", content: output });
                this.broadcastThought(output, currentIteration);
            }

            output = this.redactTechnicalLeaks(output);
            if (governorConfig?.enabled && governorConfig.rules?.length > 0) {
                output = governorService.redactSensitiveData(output, governorConfig.rules);
            }

            this.causalTracer.traceThought(output, currentIteration).catch(() => { });

            actionBlocks = this.extractActions(output);
            const finalBlock = actionBlocks.find(b => b.final_answer || b.answer);
            if (finalBlock) {
                isFinal = true;
                output = String(finalBlock.final_answer || finalBlock.answer);
            } else if (actionBlocks.length === 0) {
                // Fallback: If no JSON blocks were extracted at all, but there is text outside of <thought> tags,
                // treat the remaining text as the final answer.
                const cleanText = output.replace(/<thought>([\s\S]*?)<\/thought>/gi, "").trim();
                if (cleanText.length > 0) {
                    isFinal = true;
                    output = cleanText;
                }
            }
        }

        return { isFinal, output, actionBlocks };
    }

    private async act(
        goal: string,
        actionBlocks: any[], 
        internalActiveTools: any[], 
        manifestation: any, 
        supervisionLevel: SupervisionLevel,
        currentIteration: number,
        dryRun: boolean,
        traceContext?: W3CTraceContext
    ) {
        const seenToolCalls = new Set<string>();
        const deduplicated = actionBlocks.filter(b => {
             const toolName = b.tool || b.action;
             if (!toolName) return false;
             const key = `${toolName}::${JSON.stringify(b.params || {})}`;
             if (seenToolCalls.has(key)) return false;
             seenToolCalls.add(key);
             return true;
        });

        const receipts: CopilotToolReceipt[] = [];
        const toolExecutions = deduplicated.map(async (block, index) => {
            const toolName = block.tool || block.action;
            const toolParams = block.params || {};

            // Risk check. Consult BOTH the plan step's risk and the tool's DECLARED
            // riskLevel — a tool marked high-risk must be gated even if the LLM plan
            // under-rated it or omitted the step.
            const step = manifestation?.steps?.find((s: any) => s.tool === toolName);
            const declaredRisk = internalActiveTools.find((t: any) => t.name === toolName)?.riskLevel;
            const isHighRisk = step?.risk === "high" || declaredRisk === "high";
            const isMediumRisk = step?.risk === "medium" || declaredRisk === "medium";
            // SAFETY: high-risk actions ALWAYS require approval — even in execute mode
            // (supervisionLevel "none"), which otherwise bypasses the gate. Medium-risk
            // is gated only under active supervision (execute mode acts directly on it).
            const needsApproval = isHighRisk || (isMediumRisk && supervisionLevel !== "none");
            if (needsApproval) {
                const alertStep = step ?? { id: toolName, tool: toolName, risk: isHighRisk ? "high" : "medium", description: `Execute ${toolName}`, params: toolParams } as any;
                const alertRes = await this.lifecycle.alert(alertStep);
                if (!alertRes.proceed) {
                    receipts[index] = { tool: toolName, status: 'blocked', verified: false };
                    return `Human denied execution of ${toolName}: ${alertRes.reason || 'No reason provided'}`;
                }
            }

            this.broadcastAction(toolName, toolParams, currentIteration);

            let observation = await ToolExecutor.execute(
                toolName, toolParams, 
                { ...this.context, supervisionLevel, allowedToolNames: internalActiveTools.map(t => t.name) }, 
                internalActiveTools, dryRun, supervisionLevel, traceContext as any
            );

            // AI Self-Correction (Temporal-style Self-Healing Retries)
            if (observation.trim().startsWith("Error:") || observation.trim().toLowerCase().includes("error executing tool")) {
                try {
                    const { SelfCorrectionService } = await import("./self-correction.service.js");
                    const correctedParams = await SelfCorrectionService.correct(
                        this.apiKey,
                        toolName,
                        toolParams,
                        observation,
                        goal
                    );
                    if (correctedParams) {
                        logger.info(`[Self-Correction] Retrying tool ${toolName} with corrected parameters: ${JSON.stringify(correctedParams)}`);
                        const retryObservation = await ToolExecutor.execute(
                            toolName, correctedParams, 
                            { ...this.context, supervisionLevel, allowedToolNames: internalActiveTools.map(t => t.name) }, 
                            internalActiveTools, dryRun, supervisionLevel, traceContext as any
                        );
                        if (!retryObservation.trim().startsWith("Error:") && !retryObservation.trim().toLowerCase().includes("error executing tool")) {
                            logger.info(`[Self-Correction] Tool ${toolName} successfully self-healed!`, {
                                originalError: observation.trim(),
                            });
                            /*
                              Hand back the clean retry result. Prefixing it with
                              "[Self-Corrected from previous error: ...]" put the swallowed
                              error into the observation, and anything that surfaces an
                              observation verbatim — the copilot renders render_* tool
                              results that way — showed the user the internal retry
                              scaffolding alongside the raw tool JSON. The correction is
                              recorded in the log line above, which is where it belongs.
                            */
                            observation = retryObservation;
                        } else {
                            logger.warn(`[Self-Correction] Retry tool execution also failed: ${retryObservation}`);
                        }
                    }
                } catch (corrError: any) {
                    logger.warn(`[Self-Correction] Exception during self-correction loop: ${corrError.message}`);
                }
            }

            let verified: boolean | undefined;
            const toolObservation = observation;
            // Verification
            if (step?.verificationTool) {
                const vRes = await this.lifecycle.verify(step, observation, async (vTool, vParams) => {
                    return await ToolExecutor.execute(
                        vTool, vParams,
                        { ...this.context, supervisionLevel, allowedToolNames: internalActiveTools.map(t => t.name) },
                        internalActiveTools, dryRun, supervisionLevel, traceContext as any
                    );
                });
                verified = vRes.success;
                /*
                  A rich-response observation is handed to the user VERBATIM as an
                  interruption (see below), so annotating it puts internal loop
                  bookkeeping on screen: a failed verification rendered
                  "[Verification: FAILED] {…} Context: Verification tool
                  render_instant_app returned failure: Error: Invalid parameters…"
                  above the app itself. Same class of bug as the self-correction
                  prefix removed above — keep the payload byte-exact and record the
                  verification result in the log instead.
                */
                if (carriesRichResponse(observation)) {
                    if (!vRes.success) {
                        logger.warn(`[Verification] FAILED for ${toolName} (rich response preserved for the user): ${vRes.observation}`);
                    }
                } else {
                    observation = `[Verification: ${vRes.success ? 'PASSED' : 'FAILED'}] ${observation}\nContext: ${vRes.observation}`;
                }
            }

            receipts[index] = toolReceipt(toolName, toolObservation, verified);
            return observation;
        });

        const observations = await Promise.all(toolExecutions);
        const interruption = observations.find(o => carriesRichResponse(o));

        return { observations, interruption, receipts };
    }

    private async synthesize(
        goal: string, 
        finalAnswer: string, 
        simulatedExperience: string, 
        supervisionLevel: SupervisionLevel,
        criticRetries: number,
        maxRetries: number,
        manifestation?: any
    ) {
        if (supervisionLevel !== "none") {
            try {
                const assessment = await criticService.assessInteraction(-1, goal, finalAnswer, simulatedExperience);
                if (assessment && assessment.score < 7 && criticRetries < maxRetries) {
                    return {
                        retryWithFeedback: `CRITIC FEEDBACK: Your answer was rated ${assessment.score}/10. Issues: ${assessment.issues.join(', ')}. Criticism: ${assessment.criticism}. ${assessment.correction ? `Correction: ${assessment.correction}` : ''}`
                    };
                }
            } catch (e) { }
        }

        if (this.context.missionId) {
            import("./persistence.js").then(({ saveSuccessfulPlanAsSkill }) => {
                saveSuccessfulPlanAsSkill(this.history, {
                    missionId: this.context.missionId!,
                    organizationId: this.context.organizationId,
                    goal
                }).catch(() => {});
            });
        }

        return { finalAnswer };
    }

    private redactTechnicalLeaks(output: string): string {
        const technicalLeakRegex = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
        const databaseIdRegex = /\b(id|uuid|key):?\s*[a-z0-9_-]{20,}\b/gi;
        let sanitized = output.replace(technicalLeakRegex, "[REDACTED-UUID]");
        sanitized = sanitized.replace(databaseIdRegex, (match) => {
            const prefix = match.split(':')[0];
            return `${prefix}: [REDACTED-ID]`;
        });
        return sanitized;
    }

    private broadcastThought(content: string, iteration: number) {
        if (!this.context.missionId) return;
        swarmCommunicationService.broadcast(`mission-${this.context.missionId}`, this.context.agentId || "agent-orchestrator", {
            type: "agent:thought", content, iteration, jobId: this.context.jobId
        }).catch(() => {});
    }

    private broadcastAction(tool: string, params: any, iteration: number) {
        if (!this.context.missionId) return;
        swarmCommunicationService.broadcast(`mission-${this.context.missionId}`, this.context.agentId || "agent-orchestrator", {
            type: "agent:action", tool, params, iteration
        }).catch(() => {});
    }

    private persistSharedMemory(observation: string) {
        if (this.context.missionId && observation.length > 150 && !observation.includes("Error:")) {
            memoryService.saveMemory({
                missionId: this.context.missionId,
                agentId: this.context.jobId as any,
                runId: this.context.sessionId,
                type: "observation",
                content: observation.slice(0, 1000),
                importance: observation.length > 500 ? 8 : 5
            }).catch(() => {});
        }
    }

    private extractActions(output: string): any[] {
        const blocks: any[] = [];
        const tryParse = (str: string) => {
            try {
                return safeJsonParse(str);
            } catch (e) { return null; }
        };

        // 1. Try markdown blocks first (multiple blocks allowed)
        const markdownMatches = output.matchAll(/```json\s*([\s\S]*?)\s*```/g);
        for (const match of markdownMatches) {
            const parsed = tryParse(match[1]);
            if (parsed) blocks.push(parsed);
        }
        if (blocks.length > 0) return blocks;

        // 2. Linear scan for top-level braces (finding all independent JSON objects)
        let braceCount = 0;
        let startIndex = -1;

        for (let i = 0; i < output.length; i++) {
            if (output[i] === '{') {
                if (braceCount === 0) startIndex = i;
                braceCount++;
            } else if (output[i] === '}') {
                braceCount--;
                if (braceCount === 0 && startIndex !== -1) {
                    const potentialJson = output.substring(startIndex, i + 1);
                    const parsed = tryParse(potentialJson);
                    if (parsed && (parsed.tool || parsed.action || parsed.final_answer || parsed.answer)) {
                        blocks.push(parsed);
                    }
                    startIndex = -1;
                }
            }
        }

        if (blocks.length > 0) return blocks;

        // 3. Fallback: Substring between first/last brace if multiple objects are nested or malformed
        const first = output.indexOf('{');
        const last = output.lastIndexOf('}');
        if (first !== -1 && last !== -1 && last > first) {
            const parsed = tryParse(output.substring(first, last + 1));
            if (parsed) blocks.push(parsed);
        }

        return blocks;
    }

    private async recordMemoryUtilization(runSuccess: boolean) {
        if (this.recalledMemories.length > 0 && this.context.missionId) {
            try {
                const { agentMemoryAcrossMissionsService } = await import("@domain/agents/core/agent-memory-across-missions.service.js");
                await agentMemoryAcrossMissionsService.recordMemoryUtilization(
                    this.context.organizationId,
                    this.recalledMemories,
                    this.history,
                    runSuccess
                );
            } catch (e: any) {
                logger.warn("Failed to record memory utilization:", { error: e.message });
            }
        }
    }
}


