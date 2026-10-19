import { Router, Request, Response } from "express";
import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../domain/core/auth/security.service.js";
import { db } from "../database_service.js";
import { predictionPod } from "../domain/prediction-intelligence/prediction/prediction-pod.service.js";
import { hiddenStatePod } from "../domain/prediction-intelligence/hidden-state/hidden-state-pod.service.js";
import { resolveContextId } from "../domain/prediction-intelligence/context/context.service.js";
import { randomUUID } from "crypto";
import type { PredictionMode } from "../domain/prediction-intelligence/prediction/types.js";
import { predictions as predictionsTable } from "@shared/schema/prediction/predictions.js";
import { desc, eq, sql, and, isNull } from "drizzle-orm";
import { operationalCycles, knowledgeBaseQuestions } from "@shared/schema/index.js";
import { CycleAnalyticsService } from "../domain/mission/core/cycle-analytics.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { BadRequestError } from "@server/utils/errors.js";
import { knowledgeSemanticGroundingService } from "@domain/prediction-intelligence/integrations/knowledge-semantic-grounding.service.js";
import { knowledgeBaseQuestionEngineService } from "@domain/agents/core/knowledge-base-question-engine.service.js";
import { H3HexagonalSpatialEngineService } from "../domain/ai/core/h3-hexagonal-spatial-engine.service.js";
import { SpatialSurpriseEvaluatorService } from "../domain/ai/core/spatial-surprise-evaluator.service.js";
import { H3GaussianKernelEngineService } from "../domain/ai/core/h3-gaussian-kernel-engine.service.js";
import { H3EigenvalueSpectralEngineService } from "../domain/ai/core/h3-eigenvalue-spectral-engine.service.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";
const router = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function buildQuantField(contextId: string, now: string) {
    return {
        id: randomUUID(),
        contextId,
        quantCount: 0,
        fieldDensity: 0,
        fieldMomentum: [0, 0, 0],
        fieldEntropy: 0.5,
        fieldAlignment: 0.5,
        fieldDivergence: 0.5,
        fieldCoherence: 0.5,
        epistemicCenterOfMass: [0.5, 0.5, 0.5],
        dominantStatus: "known_known" as const,
        topAttractors: [],
        collapseProbability: 0.1,
        createdAt: now,
    };
}

function emptyRealmResults(contextId: string, now: string) {
    return {
        contextId,
        executionPlan: {
            id: randomUUID(),
            mode: "realtime" as const,
            orderedRealms: [],
            skippedRealms: [],
            parallelGroups: [],
            timeoutMs: 100,
            createdAt: now,
        },
        contributions: [],
        branchInfluences: [],
        hiddenStateInfluences: [],
        quantRelationships: [],
        agreement: undefined,
        conflicts: [],
        warnings: [],
        trace: {
            id: randomUUID(),
            contextId,
            startedAt: now,
            completedAt: now,
            durationMs: 0,
            realmRuns: [],
        },
    };
}

function parseMode(value: unknown): PredictionMode {
    return value === "interactive" || value === "analysis" || value === "batch" ? value : "realtime";
}

function normalizeFeature(input: any): { label: string; value: number; confidence: number } | null {
    const label = String(input?.label ?? input?.name ?? input?.feature ?? "").trim();
    if (!label) return null;

    const rawValue = Number(input?.value ?? input?.magnitude ?? input?.score ?? 0.5);
    const rawConfidence = Number(input?.confidence ?? 0.75);
    return {
        label,
        value: Number.isFinite(rawValue) ? Math.max(0, Math.min(1, rawValue)) : 0.5,
        confidence: Number.isFinite(rawConfidence) ? Math.max(0.05, Math.min(1, rawConfidence)) : 0.75,
    };
}

function buildGoalFeatures(goal: string, context: Record<string, unknown> = {}): Array<{ label: string; value: number; confidence: number }> {
    const text = goal.toLowerCase();
    const words = text.split(/\s+/).filter(Boolean);
    const riskTerms = ["risk", "failure", "blocked", "budget", "approval", "security", "compliance", "uncertain", "regression"];
    const actionTerms = ["fix", "improve", "verify", "test", "implement", "launch", "review", "optimize", "reduce", "increase"];
    const contextKeys = Object.keys(context).length;

    const riskHits = riskTerms.filter(term => text.includes(term)).length;
    const actionHits = actionTerms.filter(term => text.includes(term)).length;
    const signalDensity = words.length > 0 ? Math.min(1, (riskHits + actionHits) / Math.max(3, words.length / 6)) : 0.2;

    return [
        { label: "goal_clarity", value: Math.min(1, Math.max(0.2, words.length / 28)), confidence: 0.74 },
        { label: "risk_language", value: Math.min(1, riskHits / 4), confidence: riskHits > 0 ? 0.82 : 0.58 },
        { label: "actionability", value: Math.min(1, actionHits / 4), confidence: actionHits > 0 ? 0.8 : 0.55 },
        { label: "context_richness", value: Math.min(1, (contextKeys + words.length / 20) / 4), confidence: 0.68 },
        { label: "signal_density", value: signalDensity, confidence: 0.7 },
    ];
}

function getEvaluationInputs(body: any, orgId: number) {
    const explicitFeatures = Array.isArray(body?.features)
        ? body.features.map(normalizeFeature).filter(Boolean) as Array<{ label: string; value: number; confidence: number }>
        : [];
    const goal = typeof body?.goal === "string" ? body.goal.trim() : "";
    const context = body?.context && typeof body.context === "object" ? body.context as Record<string, unknown> : {};
    const features = explicitFeatures.length > 0 ? explicitFeatures : (goal ? buildGoalFeatures(goal, context) : []);
    const rawContextId = body?.contextId ?? context.id ?? context.contextId ?? (goal ? `org-${orgId}:goal:${goal.slice(0, 160)}` : undefined);

    return {
        contextId: rawContextId ? resolveContextId(String(rawContextId)) : undefined,
        features,
        goal,
        context,
        mode: parseMode(body?.mode),
    };
}

/**
 * @route POST /api/prediction/evaluate
 * @desc Evaluate a predictive hypothesis for a context and set of features
 * @access Private
 */
router.post("/semantic-grounding", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (orgContext.organizationId == null) throw new BadRequestError("Organization context required");
    const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
    if (!query) throw new BadRequestError("query is required");
    const result = await knowledgeSemanticGroundingService.ground(query, orgContext.organizationId, Number(req.body?.limit) || 8);
    res.json(result);
}));

router.post("/evaluate", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgId = (req as any).organizationId;
    if (typeof orgId !== "number") {
        return res.status(403).json({ error: "organization scope is required" });
    }
    const { contextId, features, goal, context, mode } = getEvaluationInputs(req.body, orgId);

    if (!contextId || features.length === 0) {
        return res.status(400).json({ error: "Provide either contextId + features[] or a goal to evaluate" });
    }

    const sanitizedContextId = contextId;
    const now = new Date().toISOString();
    const predictionContext = {
        id: sanitizedContextId,
        sessionId: req.sessionID ?? "api-session",
        mode,
        createdAt: now,
        tenantId: String(orgId),
        label: goal || context.label,
        metadata: { ...context, goal },
    };

    // Construct Quants from features
    const activeQuants = features.map((f: any) => {
        const confidence = f.confidence ?? 1.0;
        const uncertainty = 1.0 - confidence;
        
        return {
            id: randomUUID(),
            contextId: sanitizedContextId,
            type: "event_signal" as const,
            label: f.label,
            magnitude: f.value,
            confidence: confidence,
            uncertainty: uncertainty,
            entropyContribution: uncertainty * 0.5, // Derived fallback
            sourceEventIds: [randomUUID()],
            sourceEpisodeIds: [],
            sourcePredictionIds: [],
            sourceQuantIds: [],
            epistemic: { 
                status: uncertainty < 0.2 ? "known_known" as const : "known_unknown" as const, 
                worldKnownness: confidence, 
                systemKnownness: confidence, 
                evidenceStrength: confidence, 
                recognitionLevel: 1, 
                resolutionLevel: 1 
            },
            position: { epistemic: [1, 0, 0] },
            trajectory: { velocity: [0, 0, 0], acceleration: [0, 0, 0], direction: [1, 0, 0] },
            realmContributions: [],
            branchInfluences: [],
            hiddenStateInfluences: [],
            relationships: [],
            lifecycle: { status: "active" as const, decayRate: 0 },
            provenance: { sourceSystem: "api", ingestedAt: now },
            createdAt: now,
            updatedAt: now
        };
    });

    // Default Quant Field
    const quantField = { ...buildQuantField(sanitizedContextId, now), quantCount: activeQuants.length };
    const realmResults = emptyRealmResults(sanitizedContextId, now);

    const domainCtx = { 
        mode, 
        now, 
        requestId: randomUUID(), 
        correlationId: randomUUID(), 
        organizationId: orgId 
    };

    // 1. Estimate Hidden State
    const stateEstimate = await hiddenStatePod.estimate({
        context: predictionContext,
        activeQuants: activeQuants,
        quantField,
        realmResults,
        memoryResults: [],
        mode
    }, domainCtx);

    // 2. Generate Predictions
    const predictionResult = await predictionPod.generatePredictions({
        mode,
        context: predictionContext,
        quantField,
        activeQuants: activeQuants,
        realmResults,
        hiddenState: stateEstimate,
        memoryMatches: []
    }, domainCtx);

    const pred = predictionResult.prediction;
    res.json({
        contextId: sanitizedContextId,
        hiddenState: {
            topLabel: stateEstimate?.topLabel ?? null,
            entropy: stateEstimate?.entropy ?? 0,
            candidates: stateEstimate?.candidates ?? [],
        },
        prediction: pred ? {
            id: pred.id,
            topPredicate: pred.topPredicate,
            confidence: pred.confidence,
            entropy: pred.entropy,
        } : null,
        branches: (predictionResult.branches ?? []).map(b => ({
            id: b.id,
            predicate: b.predicate,
            probability: b.probability,
            confidence: b.confidence,
        })),
    });
}));

/**
 * @route POST /api/prediction/causal/analyze
 * @desc Analyze root cause using causal reasoning
 * @access Private
 */
router.post("/causal/analyze", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { graph, outcome, context } = req.body;

    if (!graph || !outcome || !context) {
        return res.status(400).json({ error: "graph, outcome, and context are required" });
    }

    try {
        const { CausalReasoningService } = await import("../domain/agents/core/causal/causal-reasoning.service.js");
        const { eventStream } = await import("../domain/core/infrastructure/event-stream.service.js");
        const causalReasoningService = new CausalReasoningService(eventStream as any);
        causalReasoningService.loadGraph(graph);
        const result = await causalReasoningService.analyzeRootCause(graph.id, outcome, context);
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Causal analysis failed" });
    }
}));

/**
 * @route POST /api/prediction/neuro-symbolic/query
 * @desc Process a neuro-symbolic query
 * @access Private
 */
router.post("/neuro-symbolic/query", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { naturalLanguage, domain } = req.body;

    if (!naturalLanguage) {
        return res.status(400).json({ error: "naturalLanguage is required" });
    }

    try {
        const { systemAiService } = await import("../domain/ai/core/system-ai.service.js");
        const { AIClientFactory } = await import("../domain/ai/core/ai-client.service.js");
        const { HybridReasoningService } = await import("../domain/agents/core/neuro-symbolic/index.js");

        const config = await systemAiService.getAiConfig('copilot') || { provider: 'google', model: 'gemini-1.5-pro' };
        const apiKey = config.apiKey || developmentProviderKey();
        const aiClient = AIClientFactory.getClient({ provider: config.provider, baseUrl: config.baseUrl } as any);

        const llmClient = {
            generate: async (params: any) => {
                const result = await aiClient.execute({ 
                    model: config.model, 
                    userPrompt: params.prompt, 
                    temperature: params.temperature 
                } as any, undefined, apiKey);
                return result.output || "";
            },
            generateStructured: async (params: any) => {
                const result = await aiClient.execute({ 
                    model: config.model, 
                    userPrompt: params.prompt, 
                    temperature: params.temperature,
                    systemPrompt: `Return ONLY JSON matching this schema: ${JSON.stringify(params.schema)}`
                } as any, undefined, apiKey);
                const cleanJson = result.output?.replace(/```json|```/g, "").trim();
                return JSON.parse(cleanJson || "{}");
            }
        };

        const hybridReasoningService = new HybridReasoningService(llmClient);
        const result = await hybridReasoningService.query({
            naturalLanguage,
            domain: domain || 'general',
            id: randomUUID()
        } as any);
        
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Neuro-symbolic query failed" });
    }
}));

/**
 * @route POST /api/prediction/ebm/optimize
 * @desc Optimize configuration using Energy-Based Model
 * @access Private
 */
router.post("/ebm/optimize", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { complexity, contextRichness } = req.body;

    if (complexity === undefined || contextRichness === undefined) {
        return res.status(400).json({ error: "complexity and contextRichness are required" });
    }

    try {
        const { ebmReasoner } = await import("../domain/agents/core/ebm/ebm-reasoner.service.js");
        
        const result = ebmReasoner.optimizeTokens(
            parseFloat(String(complexity)), 
            parseFloat(String(contextRichness))
        );
        
        res.json(result);
    } catch (error: any) {
        res.status(500).json({ error: error.message || "EBM optimization failed" });
    }
}));

/**
 * @route GET /api/prediction/execution/flow/:sessionId
 * @desc Get execution flow for a session
 * @access Private
 */
router.get("/execution/flow/:sessionId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const { format } = req.query;

    try {
        const { executionFlowService } = await import("../domain/agents/core/execution-visualizer/execution-flow.service.js");
        
        const flow = executionFlowService.getFlow(sessionId);
        if (!flow) {
            return res.status(404).json({ error: "Flow not found for session" });
        }
        
        if (format === 'mermaid') {
            const mermaid = executionFlowService.exportFlow(flow.id, 'mermaid');
            return res.send(mermaid);
        }
        
        res.json(flow);
    } catch (error: any) {
        res.status(500).json({ error: error.message || "Failed to get execution flow" });
    }
}));

router.get("/operational-summary", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgId = (req as any).organizationId;
    if (typeof orgId !== "number") {
        return res.status(403).json({ error: "organization scope is required" });
    }

    const countsResult: any = await db.execute(sql`
        select
            (select count(*)::int from operational_cycles where organization_id = ${orgId} and deleted_at is null) as cycles,
            (select count(*)::int from operational_cycles where organization_id = ${orgId} and deleted_at is null and status in ('planning', 'pending_approval', 'active', 'paused', 'reviewing')) as active_cycles,
            (select count(*)::int from mission_runs where organization_id = ${orgId} and deleted_at is null) as mission_runs,
            (select count(*)::int from mission_runs where organization_id = ${orgId} and deleted_at is null and status = 'failed') as failed_runs,
            (select count(*)::int from predictions where organization_id = ${orgId}) as predictions,
            (select count(*)::int from prediction_branches where organization_id = ${orgId}) as branches,
            (select count(*)::int from prediction_contracts where organization_id = ${orgId}) as contracts,
            (select count(*)::int from prediction_contexts where tenant_id = ${String(orgId)}) as contexts,
            (select count(*)::int from canonical_events where tenant_id = ${String(orgId)}) as canonical_events,
            (select count(*)::int from quants q inner join canonical_events e on e.context_id = q.context_id where e.tenant_id = ${String(orgId)}) as event_quants
    `);
    const counts = countsResult.rows?.[0] ?? {};

    const recentPredictions = await db.select({
        id: predictionsTable.id,
        contextId: predictionsTable.contextId,
        topPredicate: predictionsTable.topPredicate,
        confidence: predictionsTable.confidence,
        entropy: predictionsTable.entropy,
        createdAt: predictionsTable.createdAt,
    })
        .from(predictionsTable)
        .where(eq(predictionsTable.organizationId, orgId))
        .orderBy(desc(predictionsTable.createdAt))
        .limit(8);

    const activeCyclesList = await db.select({
        id: operationalCycles.id,
        name: operationalCycles.name,
        status: operationalCycles.status,
        priority: operationalCycles.priority,
        objective: operationalCycles.objective,
        budgetLimitUsd: operationalCycles.budgetLimitUsd,
        currentSpendUsd: operationalCycles.currentSpendUsd,
    })
        .from(operationalCycles)
        .where(
            and(
                eq(operationalCycles.organizationId, orgId),
                isNull(operationalCycles.deletedAt),
                sql`${operationalCycles.status} in ('planning', 'pending_approval', 'active', 'paused', 'reviewing')`
            )
        );

    const activeCyclesWithPredictions = [];
    for (const cycle of activeCyclesList) {
        const contextId = resolveContextId(`org-${orgId}:cycle:${cycle.id}`);
        const [latestPred] = await db.select({
            id: predictionsTable.id,
            topPredicate: predictionsTable.topPredicate,
            confidence: predictionsTable.confidence,
            entropy: predictionsTable.entropy,
            createdAt: predictionsTable.createdAt,
        })
            .from(predictionsTable)
            .where(
                and(
                    eq(predictionsTable.organizationId, orgId),
                    eq(predictionsTable.contextId, contextId)
                )
            )
            .orderBy(desc(predictionsTable.createdAt))
            .limit(1);

        const metrics = await CycleAnalyticsService.calculateCycleMetrics(cycle.id, orgId);

        const [pendingQuestion] = await db.select({
            id: knowledgeBaseQuestions.id,
            questionText: knowledgeBaseQuestions.questionText,
            proposedAnswer: knowledgeBaseQuestions.proposedAnswer,
            createdAt: knowledgeBaseQuestions.createdAt,
        })
            .from(knowledgeBaseQuestions)
            .where(
                and(
                    eq(knowledgeBaseQuestions.organizationId, orgId),
                    eq(knowledgeBaseQuestions.repositoryId, `cycle:${cycle.id}`),
                    eq(knowledgeBaseQuestions.status, "pending"),
                    eq(knowledgeBaseQuestions.triggerSource, "predictive_failure")
                )
            )
            .limit(1);

        activeCyclesWithPredictions.push({
            ...cycle,
            metrics: {
                successRate: metrics.successRate,
                riskScore: metrics.riskScore,
                alignmentScore: metrics.alignmentScore,
            },
            latestPrediction: latestPred ? {
                id: latestPred.id,
                topPredicate: latestPred.topPredicate,
                confidence: latestPred.confidence,
                entropy: latestPred.entropy,
                createdAt: latestPred.createdAt,
            } : null,
            pendingQuestion: pendingQuestion || null,
        });
    }

    const missionRuns = Number(counts.mission_runs ?? 0);
    const failedRuns = Number(counts.failed_runs ?? 0);
    const activeCycles = Number(counts.active_cycles ?? 0);
    const predictionCount = Number(counts.predictions ?? 0);
    const canonicalEventCount = Number(counts.canonical_events ?? 0);
    const failureRate = missionRuns > 0 ? failedRuns / missionRuns : 0;
    const activeCyclesWithPredCount = activeCyclesWithPredictions.filter(c => c.latestPrediction !== null).length;
    const predictionCoverage = activeCycles > 0 ? activeCyclesWithPredCount / activeCycles : 0;

    const gaps: string[] = [];
    if (predictionCount === 0) gaps.push("No persisted predictions exist for this organization yet.");
    if (canonicalEventCount === 0) gaps.push("Mission event telemetry is not yet feeding canonical prediction events for this organization.");
    if (activeCycles > activeCyclesWithPredCount) gaps.push("Active cycles outnumber persisted predictions; cycle forecasts should be generated or refreshed.");
    if (failureRate > 0.4) gaps.push("Mission failure pressure is high enough that the prediction engine should drive intervention recommendations.");

    const recommendedActions = [
        canonicalEventCount === 0 ? "Run a mission phase transition or cycle forecast to seed canonical prediction telemetry." : null,
        activeCycles > activeCyclesWithPredCount ? "Generate local cycle forecasts for pending and active cycles before approval decisions." : null,
        failureRate > 0.4 ? "Prioritize failed-run clusters in the prediction UI and require review on high-risk cycles." : null,
        predictionCount > 0 ? "Use recent prediction contracts as the audit trail for why an Oddjob action is suggested." : null,
    ].filter(Boolean);

    res.json({
        organizationId: orgId,
        generatedAt: new Date().toISOString(),
        counts: {
            cycles: Number(counts.cycles ?? 0),
            activeCycles,
            missionRuns,
            failedRuns,
            predictions: predictionCount,
            branches: Number(counts.branches ?? 0),
            contracts: Number(counts.contracts ?? 0),
            contexts: Number(counts.contexts ?? 0),
            canonicalEvents: canonicalEventCount,
            eventQuants: Number(counts.event_quants ?? 0),
        },
        valueSignals: {
            failureRate,
            predictionCoverage,
            hasGovernedPredictionContracts: Number(counts.contracts ?? 0) > 0,
            hasMissionEventBridgeData: canonicalEventCount > 0,
        },
        gaps,
        recommendedActions,
        recentPredictions,
        activeCyclesList: activeCyclesWithPredictions,
    });
}));

/**
 * @route POST /api/prediction/questions/:id/resolve
 * @desc Address a pending escalation (knowledge-gap) question for a cycle. action
 *       'approve' accepts the engine's proposed answer, 'edit' submits a custom
 *       answerText, 'ignore' dismisses it. approve/edit sync the answer into the
 *       Knowledge Graph, raising the cycle's prediction confidence on next forecast.
 * @access Private
 */
router.post("/questions/:id/resolve", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    if (orgContext.organizationId == null) throw new BadRequestError("Organization context required");
    const questionId = Number(req.params.id);
    if (!Number.isFinite(questionId)) throw new BadRequestError("Invalid question id");
    const action = req.body?.action;
    if (!["approve", "edit", "ignore"].includes(action)) throw new BadRequestError("action must be 'approve', 'edit', or 'ignore'");
    const answerText = typeof req.body?.answerText === "string" ? req.body.answerText.trim() : "";
    if (action === "edit" && !answerText) throw new BadRequestError("answerText is required when action is 'edit'");
    const answeredBy = String((orgContext as any).userId ?? (req as any).user?.id ?? (req as any).user?.username ?? "operator");

    await knowledgeBaseQuestionEngineService.resolveQuestion(orgContext.organizationId, questionId, answerText, answeredBy, action);
    res.json({ success: true, questionId, action });
}));

/**
 * @route POST /api/prediction/forecast-cycles
 * @desc Generate or refresh predictions for all or a single active cycle
 * @access Private
 */
router.post("/forecast-cycles", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgId = (req as any).organizationId;
    if (typeof orgId !== "number") {
        return res.status(403).json({ error: "organization scope is required" });
    }

    const cycleId = req.body?.cycleId ? Number(req.body.cycleId) : undefined;

    const cycleConditions = [
        eq(operationalCycles.organizationId, orgId),
        isNull(operationalCycles.deletedAt),
        sql`${operationalCycles.status} in ('planning', 'pending_approval', 'active', 'paused', 'reviewing')`
    ];
    if (cycleId !== undefined) {
        cycleConditions.push(eq(operationalCycles.id, cycleId));
    }

    const activeCycles = await db.select()
        .from(operationalCycles)
        .where(and(...cycleConditions));

    const results = [];
    for (const cycle of activeCycles) {
        const contextId = resolveContextId(`org-${orgId}:cycle:${cycle.id}`);
        const now = new Date().toISOString();
        
        // 1. Calculate metrics
        const metrics = await CycleAnalyticsService.calculateCycleMetrics(cycle.id, orgId);

        // 2. Build goal/context
        const goal = cycle.objective || cycle.name;
        const features = buildGoalFeatures(goal, {
            priority: cycle.priority,
            budgetLimitUsd: cycle.budgetLimitUsd,
            currentSpendUsd: cycle.currentSpendUsd,
            successRate: metrics.successRate,
            riskScore: metrics.riskScore,
            alignmentScore: metrics.alignmentScore,
        });

        // 3. Construct prediction context
        const predictionContext = {
            id: contextId,
            sessionId: "bulk-forecast",
            mode: "realtime" as const,
            createdAt: now,
            tenantId: String(orgId),
            label: cycle.name,
            metadata: { goal, cycleId: cycle.id },
        };

        // 4. Build active quants from features
        const activeQuants = features.map((f: any) => {
            const confidence = f.confidence ?? 1.0;
            const uncertainty = 1.0 - confidence;
            return {
                id: randomUUID(),
                contextId,
                type: "event_signal" as const,
                label: f.label,
                magnitude: f.value,
                confidence: confidence,
                uncertainty: uncertainty,
                entropyContribution: uncertainty * 0.5,
                sourceEventIds: [randomUUID()],
                sourceEpisodeIds: [],
                sourcePredictionIds: [],
                sourceQuantIds: [],
                epistemic: {
                    status: uncertainty < 0.2 ? "known_known" as const : "known_unknown" as const,
                    worldKnownness: confidence,
                    systemKnownness: confidence,
                    evidenceStrength: confidence,
                    recognitionLevel: 1,
                    resolutionLevel: 1
                },
                position: { epistemic: [1, 0, 0] },
                trajectory: { velocity: [0, 0, 0], acceleration: [0, 0, 0], direction: [1, 0, 0] },
                realmContributions: [],
                branchInfluences: [],
                hiddenStateInfluences: [],
                relationships: [],
                lifecycle: { status: "active" as const, decayRate: 0 },
                provenance: { sourceSystem: "bulk-forecast", ingestedAt: now },
                createdAt: now,
                updatedAt: now
            };
        });

        // 5. Run Hidden State Pod
        const quantField = { ...buildQuantField(contextId, now), quantCount: activeQuants.length };
        const realmResults = emptyRealmResults(contextId, now);
        const domainCtx = {
            mode: "realtime" as const,
            now,
            requestId: randomUUID(),
            correlationId: randomUUID(),
            organizationId: orgId
        };

        const stateEstimate = await hiddenStatePod.estimate({
            context: predictionContext,
            activeQuants,
            quantField,
            realmResults,
            memoryResults: [],
            mode: "realtime"
        }, domainCtx);

        // 6. Run Prediction Pod (which automatically persists to DB)
        const predictionResult = await predictionPod.generatePredictions({
            mode: "realtime",
            context: predictionContext,
            quantField,
            activeQuants,
            realmResults,
            hiddenState: stateEstimate,
            memoryMatches: []
        }, domainCtx);

        // Escalate to Knowledge Base Question Engine if risk is high or success is low
        if (metrics.riskScore > 50 || metrics.successRate < 60) {
            try {
                const { knowledgeBaseQuestionEngineService } = await import("../domain/agents/core/knowledge-base-question-engine.service.js");
                await knowledgeBaseQuestionEngineService.createQuestion(
                    orgId,
                    `cycle:${cycle.id}`,
                    "predictive_failure",
                    {
                        cycleId: cycle.id,
                        cycleName: cycle.name,
                        objective: cycle.objective,
                        riskScore: metrics.riskScore,
                        successRate: metrics.successRate,
                        alignmentScore: metrics.alignmentScore,
                        budgetLimitUsd: String(cycle.budgetLimitUsd),
                        currentSpendUsd: String(cycle.currentSpendUsd),
                        errorCategory: "High Cycle Failure Risk",
                        problemDescription: `Cycle "${cycle.name}" has a high failure risk of ${Math.round(metrics.riskScore)}% and a low success rate of ${Math.round(metrics.successRate)}%.`,
                    }
                );
            } catch (err: any) {
                console.warn(`[Prediction] Question engine escalation failed for cycle ${cycle.id}: ${err.message}`);
            }
        }

        results.push({
            cycleId: cycle.id,
            name: cycle.name,
            predictionId: predictionResult.prediction?.id,
            topPredicate: predictionResult.prediction?.topPredicate,
            confidence: predictionResult.prediction?.confidence,
        });
    }

    res.json({
        success: true,
        processedCount: activeCycles.length,
        results
    });
}));

/**
 * @route GET /api/prediction/telemetry
 * @desc Query recent PI telemetry events from the in-memory buffer
 * @access Private
 */
router.get("/telemetry", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const contextId = req.query.contextId as string | undefined;
    const orgId = (req as any).organizationId;
    const { observabilityPod } = await import("../domain/prediction-intelligence/observability/observability-pod.service.js");
    const result = await observabilityPod.query(
        { contextId, limit },
        { requestId: randomUUID(), correlationId: randomUUID(), now: new Date().toISOString(), mode: "analysis", organizationId: orgId }
    );
    const bufferedEvents = result.events ?? [];
    const events = typeof orgId === "number"
        ? bufferedEvents.filter(event => Number((event.payload as any)?.organizationId) === orgId)
        : bufferedEvents;
    res.json({ events });
}));

/**
 * @route POST /api/prediction/governance/evaluate
 * @desc Run a governance evaluation with given confidence and action level
 * @access Private
 */
router.post("/governance/evaluate", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { confidence = 0.7, requestedActionLevel = "suggest", mode = "realtime" } = req.body;
    const now = new Date().toISOString();
    const contextId = randomUUID();
    const domainCtx = { requestId: randomUUID(), correlationId: randomUUID(), now, mode };
    const { governancePod } = await import("../domain/prediction-intelligence/governance/governance-pod.service.js");
    const decision = await governancePod.evaluate({
        context: { id: contextId, mode, createdAt: now },
        confidence,
        requestedActionLevel,
        mode,
    } as any, domainCtx);
    res.json({
        allowed: decision.allowed,
        maxActionLevel: decision.maxActionLevel,
        riskClass: decision.riskClass,
        requiresHumanConfirmation: decision.requiresHumanConfirmation,
        reason: decision.reason,
    });
}));

/**
 * @route POST /api/prediction/spatial/evaluate
 * @desc Evaluates Eulerian H3 spatial state, Gaussian kernel decay, and spatial surprise error
 * @access Private
 */
router.post("/spatial/evaluate", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const lat = Number(req.body?.lat) || 34.0522;
    const lng = Number(req.body?.lng) || -118.2437;
    const resolution = Number(req.body?.resolution) || 8;
    const riskFluxDensity = Number(req.body?.riskFluxDensity) || 0.65;
    const expectedRiskPhi = Number(req.body?.expectedRiskPhi) || 0.50;

    const spatialState = H3HexagonalSpatialEngineService.latLngToH3Index(lat, lng, resolution);
    const gaussianKernel = H3GaussianKernelEngineService.computeGaussianGeneralization(spatialState.h3Index, riskFluxDensity, 2, 500);

    const surpriseResult = SpatialSurpriseEvaluatorService.evaluateSurprise(
        { h3Index: spatialState.h3Index, expectedRiskPhi, confidenceScore: 0.85, timeWindowMs: 60000 },
        { h3Index: spatialState.h3Index, observedRiskPhi: riskFluxDensity, timestamp: new Date().toISOString() }
    );

    res.json({
        spatialState,
        gaussianKernel,
        surpriseResult,
        timestamp: new Date().toISOString()
    });
}));

/**
 * @route POST /api/prediction/spatial/eigenvalues
 * @desc Computes Principal Component Analysis (PCA) eigenvalues and spatial drift direction
 * @access Private
 */
router.post("/spatial/eigenvalues", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const points = Array.isArray(req.body?.points) ? req.body.points : [];
    const spectralResult = H3EigenvalueSpectralEngineService.computeSpatialEigenvalues(points);
    res.json(spectralResult);
}));

export default router;
