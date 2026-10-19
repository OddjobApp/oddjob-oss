/**
 * Multi-Model LLM Router Service
 * Intelligent routing across providers with cost optimization and fallbacks
 */

import { db } from "@server/database_service.js";
import {
    llmProviders,
    llmModels,
    llmRoutingRules,
    llmRouterLogs,
    llmProviderHealth,
    type InsertLlmRouterLog,
} from "@shared/schema/index.js";
import { eq, and, or, desc, asc, sql, gte, isNull } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { v4 as uuidv4 } from "uuid";
import { classifyTask } from "./task-classifier.js";
import { calculateAiCost } from "./cost-registry.js";
import { scoreModel } from "./predictive-scorer.js";
import {
    applyMultiTokenPredictionRequestBody,
    buildMultiTokenPredictionMetadata,
    constrainMultiTokenPredictionPassthrough,
    isMultiTokenPredictionCapability,
    modelSupportsMultiTokenPrediction,
    requestPrefersMultiTokenPrediction,
    requestRequiresMultiTokenPrediction,
    resolveMultiTokenPrediction,
    type MultiTokenPredictionConfig,
} from "./multi-token-prediction.js";
import { hasCapability, ModelCapability } from "./capabilities.js";
import { AIClientFactory } from "./ai-client.service.js";
import { privacyRouter } from "./privacy-router.service.js";
import { resolveAiOrganization } from "./ai-org-context.js";
import { orgModelService } from "./org-model.service.js";
import { ORG_AI_KEY_MISSING } from "./organization-ai-client.js";
import type { DataClassification } from "@shared/schema/jobs/table.js";


/**
 * What a routed call cost: the price on the llm_models row when it has one, otherwise
 * the shared per-model registry.
 *
 * The fallback here used to be $0.01 and $0.03 per 1k tokens - GPT-4-era OpenAI list
 * price - charged against whatever model actually ran. No llm_models row sets a price,
 * so every routed call was billed at it: against Gemini Flash, roughly thirty times the
 * real figure, which is why llm_router_logs and cost_ledger disagreed by an order of
 * magnitude over the same calls.
 */
export function routedCallCost(
    model: { modelId: string; inputCostPer1k?: number | null; outputCostPer1k?: number | null },
    inputTokens: number,
    outputTokens: number,
): { inputCost: number; outputCost: number } {
    return {
        inputCost: model.inputCostPer1k
            ? inputTokens / 1000 * model.inputCostPer1k
            : calculateAiCost(model.modelId, inputTokens, 0),
        outputCost: model.outputCostPer1k
            ? outputTokens / 1000 * model.outputCostPer1k
            : calculateAiCost(model.modelId, 0, outputTokens),
    };
}

const logger = createLogger("LLMRouter");

/**
 * Bucket a provider error into a stable error_code for llm_router_logs. Raw
 * messages vary per provider ("resource_exhausted" vs "429" vs "credit balance");
 * the code is what dashboards and circuit-breaker audits can group by.
 */
export function classifyRouterError(error: any): string {
    const msg = (error?.message || String(error) || "").toLowerCase();
    if (msg.includes("429") || msg.includes("quota") || msg.includes("resource_exhausted")
        || msg.includes("too many requests") || msg.includes("rate limit") || msg.includes("credit balance")) {
        return "QUOTA_EXHAUSTED";
    }
    if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized")
        || msg.includes("invalid api key") || msg.includes("authentication")) {
        return "AUTH_FAILED";
    }
    if (msg.includes("404") || msg.includes("not found") || msg.includes("no such model")) {
        return "MODEL_NOT_FOUND";
    }
    if (msg.includes("econnrefused") || msg.includes("etimedout") || msg.includes("enotfound")
        || msg.includes("fetch failed") || msg.includes("network") || msg.includes("timeout")) {
        return "PROVIDER_UNREACHABLE";
    }
    return "UNKNOWN_ERROR";
}

// Request types
interface LLMRequest {
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    maxTokens?: number;
    capabilities?: string[]; // Required capabilities: ["vision", "code", "reasoning"]
    preferredProvider?: string;
    preferredModel?: string;
    routingStrategy?: "cost" | "quality" | "speed" | "specific" | "predictive";
    fallbackEnabled?: boolean;
    jsonMode?: boolean;
    stream?: boolean;
    multiTokenPrediction?: MultiTokenPredictionConfig;
    adapterPath?: string;
    /** Privacy/data-residency classification — drives local-only routing for 'restricted' */
    dataClassification?: DataClassification;
    /**
     * Gemini thinking-token budget; 0 spends the whole output budget on the
     * answer. Without it, a thinking model truncates long replies mid-sentence.
     */
    thinkingBudget?: number;
    /**
     * The tenant this call is billed to, and the mission it belongs to.
     *
     * Carried on the request because the per-provider methods
     * (unifiedComplete, unifiedStream) only receive `request` and
     * `model` — the organizationId that `complete()` is handed was dropped at
     * that hop. CachedAIClient reads `config.organizationId` to call
     * systemConfigService.trackSpend(), which is what records cost_ledger AND
     * enforces the mission and organization budget kill-switches. Without it
     * every routed call was unattributed and unbudgeted.
     */
    organizationId?: number;
    missionId?: number;
    /** Provider function declarations the model may call. */
    tools?: any[];
    /** Request timeout in milliseconds. */
    timeoutMs?: number;
}


interface LLMResponse {
    content: string;
    model: string;
    provider: string;
    usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        cost: number;
    };
    latency: {
        totalMs: number;
        timeToFirstTokenMs?: number;
    };
    metadata?: any;
}

interface ProviderAdapter {
    name: string;
    complete(request: LLMRequest, model: any): Promise<LLMResponse>;
    stream?(request: LLMRequest, model: any, onChunk: (chunk: string) => void): Promise<LLMResponse>;
}

// Provider adapters registry
const providerAdapters: Map<string, ProviderAdapter> = new Map();

// In-process fallback cache — used only if Redis is unavailable
const localPerformanceCache: Map<string, { successRate: number, avgTokens: number }> = new Map();

const PERF_CACHE_KEY = "llm_router:model_performance";
const PERF_CACHE_TTL_SECONDS = 30 * 60; // 30 minutes

type ModelPerf = Record<string, { successRate: number; avgTokens: number }>;

async function savePerformanceToRedis(data: ModelPerf): Promise<void> {
    try {
        const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
        await redis.set(PERF_CACHE_KEY, JSON.stringify(data), "EX", PERF_CACHE_TTL_SECONDS);
    } catch {
        // Non-fatal — in-process cache still works
    }
}

async function loadPerformanceFromRedis(): Promise<ModelPerf | null> {
    try {
        const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
        const cached = await redis.get(PERF_CACHE_KEY);
        return cached ? JSON.parse(cached) : null;
    } catch {
        return null;
    }
}

async function getModelPerformance(modelId: string): Promise<{ successRate: number; avgTokens: number } | undefined> {
    // 1. Try Redis (shared across workers)
    const redisData = await loadPerformanceFromRedis();
    if (redisData?.[modelId]) return redisData[modelId];
    // 2. Fall back to in-process cache
    return localPerformanceCache.get(modelId);
}

async function loadModelPerformance() {
    try {
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30 days
        const logs = await db.select({
            modelId: llmRouterLogs.selectedModelId,
            success: llmRouterLogs.success,
            tokens: llmRouterLogs.totalTokens
        }).from(llmRouterLogs)
          .where(gte(llmRouterLogs.createdAt, cutoff))
          .limit(10_000);

        const stats: Record<string, { total: number, success: number, totalTokens: number }> = {};

        for (const log of logs) {
            if (!log.modelId) continue;
            if (!stats[log.modelId]) {
                stats[log.modelId] = { total: 0, success: 0, totalTokens: 0 };
            }
            stats[log.modelId].total++;
            if (log.success) stats[log.modelId].success++;
            stats[log.modelId].totalTokens += log.tokens || 0;
        }

        const result: ModelPerf = {};
        for (const modelId in stats) {
            const s = stats[modelId];
            const entry = { successRate: s.success / s.total, avgTokens: s.totalTokens / s.total };
            result[modelId] = entry;
            localPerformanceCache.set(modelId, entry);
        }

        // Persist to Redis so all workers share the same view
        await savePerformanceToRedis(result);
        logger.info(`[PredictiveRouter] Loaded and cached performance data for ${Object.keys(result).length} models`);
    } catch (err: any) {
        logger.warn(`[PredictiveRouter] Failed to load model performance: ${err.message}`);
    }
}

export const llmRouterService = {
    /**
     * Initialize with provider adapters
     */
    initialize() {
        // Register OpenAI adapter
        this.registerAdapter("openai", {
            name: "openai",
            complete: this.openAIComplete.bind(this),
            stream: this.openAIStream.bind(this),
        });
        this.registerAdapter("local_openai", {
            name: "local_openai",
            complete: this.openAIComplete.bind(this),
            stream: this.openAIStream.bind(this),
        });

        // Register Anthropic adapter
        this.registerAdapter("anthropic", {
            name: "anthropic",
            complete: this.anthropicComplete.bind(this),
            stream: this.anthropicStream.bind(this),
        });

        // Register Google/Gemini adapter
        this.registerAdapter("google", {
            name: "google",
            complete: this.googleComplete.bind(this),
            stream: this.googleStream.bind(this),
        });

        // Register Azure adapter
        this.registerAdapter("azure", {
            name: "azure",
            complete: this.azureComplete.bind(this),
            stream: this.azureStream.bind(this),
        });

        logger.info("LLM Router initialized with provider adapters");
        
        // Load model performance data for predictive routing
        loadModelPerformance();
    },

    /**
     * Register a provider adapter
     */
    registerAdapter(providerName: string, adapter: ProviderAdapter) {
        providerAdapters.set(providerName, adapter);
        logger.debug(`Registered adapter for ${providerName}`);
    },

    /**
     * Main routing method - complete a request
     */
    async complete(
        request: LLMRequest,
        organizationId?: number,
        jobId?: number,
        jobRunId?: number,
        onChunk?: (chunk: string) => void
    ): Promise<LLMResponse> {
        const requestId = uuidv4();
        const startTime = Date.now();

        const aiOrg = await resolveAiOrganization(organizationId ?? request.organizationId);
        const connection = aiOrg !== null ? await orgModelService.resolve(aiOrg) : null;
        // An org on its own key runs on its default connection whatever provider
        // the request prefers: a routing hint must not move its work onto
        // platform keys. Production has no platform keys to fall back to.
        if (connection || process.env.NODE_ENV === "production") {
            if (aiOrg === null || !connection) throw new Error(ORG_AI_KEY_MISSING);
            if (request.dataClassification) privacyRouter.enforce(request.dataClassification, {
                provider: connection.provider, model: connection.model,
            });
            const result = await AIClientFactory.getClient({ provider: connection.provider } as any).execute({
                organizationId: aiOrg, model: connection.model, messages: request.messages,
                temperature: request.temperature, maxTokens: request.maxTokens,
                missionId: request.missionId, tools: request.tools, timeoutMs: request.timeoutMs,
                thinkingBudget: request.thinkingBudget, requestType: request.jsonMode ? "json" : undefined,
            } as any, undefined, connection.apiKey);
            if (!result.success) {
                await this.logFailure(requestId, request, new Error(result.error || "AI request failed"), aiOrg);
                throw new Error(result.error || "AI request failed");
            }
            const inputTokens = result.metadata?.promptTokens ?? 0;
            const outputTokens = result.metadata?.completionTokens ?? 0;
            const totalMs = Date.now() - startTime;
            const cost = calculateAiCost(connection.model, inputTokens, outputTokens);
            try {
                await db.insert(llmRouterLogs).values({
                    requestId,
                    organizationId: aiOrg,
                    jobId,
                    jobRunId,
                    routingStrategy: request.routingStrategy || `direct_${connection.provider}`,
                    success: true,
                    inputTokens,
                    outputTokens,
                    totalTokens: result.metadata?.tokensUsed ?? inputTokens + outputTokens,
                    cost,
                    latencyMs: totalMs,
                    requestParams: {
                        temperature: request.temperature,
                        maxTokens: request.maxTokens,
                        messageCount: request.messages.length,
                    },
                } as InsertLlmRouterLog);
            } catch (err: any) {
                logger.warn(`Failed to log direct ${connection.provider} execution for request ${requestId}: ${err?.message}`);
            }
            if (onChunk && result.output) onChunk(result.output);
            return {
                content: result.output || "", model: connection.model, provider: connection.provider,
                usage: { inputTokens, outputTokens, totalTokens: result.metadata?.tokensUsed ?? inputTokens + outputTokens,
                    cost },
                latency: { totalMs }, metadata: result.metadata,
            };
        }

        // Stamp the caller's tenant onto the request so it survives the hop into
        // the per-provider methods, which receive only `request` and `model`.
        // Reassigns the local binding rather than mutating the caller's object.
        if (organizationId !== undefined && request.organizationId === undefined) {
            request = { ...request, organizationId };
        }

        try {
            // Select model and provider
            const selection = await this.selectModel(request, organizationId);

            // ---------------------------------------------------------------
            // Privacy enforcement: ensure data classification is respected
            // ---------------------------------------------------------------
            if (request.dataClassification && request.dataClassification !== 'public') {
                const candidate = {
                    model: selection.model.modelId as string,
                    provider: selection.provider.name as string,
                };
                try {
                    privacyRouter.enforce(request.dataClassification, candidate);
                } catch {
                    // Restricted data was about to go to a cloud model — retry with local filter
                    logger.warn(
                        `[PrivacyRouter] Redirecting ${request.dataClassification} request ` +
                        `away from ${candidate.provider}/${candidate.model} to a local model.`
                    );
                    const localRequest = { ...request, capabilities: [...(request.capabilities ?? []), 'local'] };
                    const localSelection = await this.selectModel(localRequest, organizationId);
                    // If the fallback is also cloud, enforce will throw — propagate as ForbiddenError
                    privacyRouter.enforce(request.dataClassification, {
                        model: localSelection.model.modelId as string,
                        provider: localSelection.provider.name as string,
                    });
                    // Use local selection from here.
                    // await, not a bare return: a returned promise settles after
                    // this frame leaves the try, so a rejection would skip the
                    // catch below entirely and never reach the fallback.
                    return await this.executeSelection(localRequest, localSelection, requestId, startTime, jobId, jobRunId, organizationId, onChunk);
                }
            }

            // await is load-bearing here. Returning the promise unawaited meant
            // every provider failure escaped this try, so logFailure never ran,
            // updateProviderHealth never recorded the outage, and attemptFallback
            // was unreachable — fallbackEnabled did nothing at all.
            return await this.executeSelection(request, selection, requestId, startTime, jobId, jobRunId, organizationId, onChunk);

        } catch (error: any) {
            // Log failure
            await this.logFailure(requestId, request, error, organizationId);

            // Attempt fallback if enabled
            if (request.fallbackEnabled !== false) {
                return this.attemptFallback(request, requestId, organizationId, jobId, jobRunId, error, 1, onChunk);
            }

            throw error;
        }
    },

    /**
     * Internal: execute a pre-selected model+provider combination
     */
    async executeSelection(
        request: LLMRequest,
        selection: { provider: any; model: any; rule?: any; strategy: string },
        requestId: string,
        startTime: number,
        jobId?: number,
        jobRunId?: number,
        organizationId?: number,
        onChunk?: (chunk: string) => void
    ): Promise<LLMResponse> {
            // Log the routing decision
            await this.logRoutingDecision(requestId, selection, request, jobId, jobRunId, organizationId);

            // Get adapter
            const adapter = providerAdapters.get(selection.provider.name);
            if (!adapter) {
                throw new Error(`No adapter found for provider: ${selection.provider.name}`);
            }

            // Execute request
            let response: LLMResponse;
            if (request.stream && adapter.stream) {
                response = await adapter.stream(request, selection.model, onChunk || (() => {}));
            } else {
                response = await adapter.complete(request, selection.model);
            }

            // Calculate latency
            const totalMs = Date.now() - startTime;
            response.latency = {
                totalMs,
                timeToFirstTokenMs: response.latency?.timeToFirstTokenMs,
            };

            // Log success
            await this.logSuccess(requestId, selection, response, totalMs);
            await this.updateProviderHealth(selection.provider.id, true, totalMs);

            // Track token usage if job context exists
            if (jobId) {
                await this.trackTokenUsage(jobId, jobRunId, selection, response.usage, organizationId);
            }

            return response;
    },

    /**
     * Select best model based on request requirements
     */
    async selectModel(request: LLMRequest, organizationId?: number): Promise<{
        provider: any;
        model: any;
        rule?: any;
        strategy: string;
    }> {
        // If specific model requested, use it
        if (request.preferredModel && request.preferredProvider) {
            const specific = await this.getSpecificModel(request.preferredProvider, request.preferredModel, organizationId);
            if (specific) {
                return { ...specific, strategy: "specific" };
            }
        }

        // Get all active providers and models
        const providers = await this.getActiveProviders(organizationId);
        const models = await this.getActiveModels(organizationId);

        // Filter by capabilities
        let eligibleModels = models;
        const requestedCaps = [...(request.capabilities || [])];
        if (requestedCaps.length > 0) {
            eligibleModels = models.filter(m => {
                const caps = m.capabilities as string[] || [];
                const provider = providers.find(p => p.id === m.providerId);
                const providerName = provider ? provider.name : "";

                return requestedCaps.every(reqCap => {
                    switch (reqCap) {
                        case "json":
                            return m.supportsJsonMode || caps.includes("json") || hasCapability(m.modelId, ModelCapability.JSON);
                        case "vision":
                            return m.supportsVision || caps.includes("vision") || hasCapability(m.modelId, ModelCapability.VISION);
                        case "tools":
                            return m.supportsFunctions || caps.includes("tools") || hasCapability(m.modelId, ModelCapability.TOOLS);
                        case "mtp":
                            return modelSupportsMultiTokenPrediction(m) || caps.includes("mtp");
                        case "local":
                            return caps.includes("local") || providerName === "local_openai" || providerName === "ollama" || hasCapability(m.modelId, ModelCapability.LOCAL);
                        case "cheap":
                            return (m.costScore || 0) >= 80 || caps.includes("cheap") || (m.inputCostPer1k || 0) < 0.5 || hasCapability(m.modelId, ModelCapability.CHEAP);
                        case "fast":
                            return (m.speedScore || 0) >= 80 || caps.includes("fast") || hasCapability(m.modelId, ModelCapability.FAST);
                        default:
                            return caps.includes(reqCap) || hasCapability(m.modelId, reqCap as ModelCapability);
                    }
                });
            });
        }

        // Filter by JSON mode support if needed
        if (request.jsonMode) {
            eligibleModels = eligibleModels.filter(m => m.supportsJsonMode);
        }

        // Filter by streaming if needed
        if (request.stream) {
            eligibleModels = eligibleModels.filter(m => m.supportsStreaming);
        }

        if (requestRequiresMultiTokenPrediction(request)) {
            eligibleModels = eligibleModels.filter(modelSupportsMultiTokenPrediction);
        } else if (requestPrefersMultiTokenPrediction(request)) {
            const mtpModels = eligibleModels.filter(modelSupportsMultiTokenPrediction);
            if (mtpModels.length > 0) {
                eligibleModels = mtpModels;
            }
        }

        if (eligibleModels.length === 0) {
            throw new Error("No models available matching requirements");
        }

        // Apply routing strategy
        const strategy = request.routingStrategy || "cost";
        let selectedModel: any;

        switch (strategy) {
            case "cost":
                selectedModel = this.selectByCost(eligibleModels);
                break;
            case "quality":
                selectedModel = this.selectByQuality(eligibleModels);
                break;
            case "speed":
                selectedModel = this.selectBySpeed(eligibleModels);
                break;
            case "predictive":
                selectedModel = await this.selectByPrediction(eligibleModels, request.messages);
                break;
            default:
                selectedModel = eligibleModels[0];
        }

        // Get provider for selected model
        const provider = providers.find(p => p.id === selectedModel.providerId);
        if (!provider) {
            throw new Error("Provider not found for selected model");
        }

        return { provider, model: selectedModel, strategy };
    },

    /**
     * Select cheapest capable model
     */
    selectByCost(models: any[]): any {
        return models.reduce((cheapest, current) => {
            const currentCost = (current.inputCostPer1k || 0) + (current.outputCostPer1k || 0);
            const cheapestCost = (cheapest.inputCostPer1k || 0) + (cheapest.outputCostPer1k || 0);
            return currentCost < cheapestCost ? current : cheapest;
        });
    },

    /**
     * Select highest quality model
     */
    selectByQuality(models: any[]): any {
        return models.reduce((best, current) => {
            return (current.qualityScore || 0) > (best.qualityScore || 0) ? current : best;
        });
    },

    /**
     * Select fastest model
     */
    selectBySpeed(models: any[]): any {
        return models.reduce((fastest, current) => {
            return (current.speedScore || 0) > (fastest.speedScore || 0) ? current : fastest;
        });
    },

    /**
     * Select model based on predicted task complexity and historical performance
     */
    async selectByPrediction(models: any[], messages: any[]): Promise<any> {
        const classification = classifyTask(messages);
        const { isComplex, isCoding, isResearch, isCreative } = classification;

        // Load the full performance map once to avoid N serial Redis round-trips
        const redisData = await loadPerformanceFromRedis();

        let bestModel = null;
        let bestScore = -Infinity;

        for (const model of models) {
            const perf = redisData?.[model.modelId] ?? localPerformanceCache.get(model.modelId);
            const score = scoreModel(model, perf, classification);
            
            if (score > bestScore) {
                bestScore = score;
                bestModel = model;
            }
        }
        
        if (bestModel) {
            logger.info(`[PredictiveRouter] Selected ${bestModel.modelId} with score ${bestScore.toFixed(4)} (Complex: ${isComplex}, Coding: ${isCoding}, Research: ${isResearch})`);
            return bestModel;
        }
        
        // Fallback
        if (isComplex || isCoding) {
            return this.selectByQuality(models);
        } else {
            return this.selectByCost(models);
        }
    },

    /**
     * Get specific model by provider and model ID
     */
    async getSpecificModel(providerName: string, modelId: string, organizationId?: number): Promise<any> {
        const providerOrgCondition = organizationId
            ? or(eq(llmProviders.organizationId, organizationId), isNull(llmProviders.organizationId))
            : isNull(llmProviders.organizationId);

        const providerResult = await db
            .select()
            .from(llmProviders)
            .where(and(
                eq(llmProviders.name, providerName),
                eq(llmProviders.isActive, true),
                providerOrgCondition
            ))
            .orderBy(desc(llmProviders.organizationId))
            .limit(1);

        if (providerResult.length === 0) return null;
        const provider = providerResult[0];

        const modelOrgCondition = organizationId
            ? or(eq(llmModels.organizationId, organizationId), isNull(llmModels.organizationId))
            : isNull(llmModels.organizationId);

        const modelResult = await db
            .select()
            .from(llmModels)
            .where(and(
                eq(llmModels.providerId, provider.id),
                eq(llmModels.modelId, modelId),
                eq(llmModels.isActive, true),
                modelOrgCondition
            ))
            .orderBy(desc(llmModels.organizationId))
            .limit(1);

        if (modelResult.length === 0) return null;

        return { provider, model: modelResult[0] };
    },

    /**
     * Attempt fallback to alternative models
     */
    async attemptFallback(
        request: LLMRequest,
        originalRequestId: string,
        organizationId?: number,
        jobId?: number,
        jobRunId?: number,
        previousError?: any,
        attempt: number = 1,
        onChunk?: (chunk: string) => void
    ): Promise<LLMResponse> {
        if (attempt > 3) {
            throw new Error(`All fallback attempts failed. Original error: ${previousError?.message}`);
        }

        logger.info(`Attempting fallback #${attempt} for request ${originalRequestId}`);

        // Get fallback candidates (exclude the failed one)
        const providers = await this.getActiveProviders(organizationId);
        
        // Try next provider in priority order
        const fallbackProvider = providers[attempt];
        if (!fallbackProvider) {
            // Rethrow what actually failed. Replacing it with "No fallback
            // providers available" hid the real cause for every org with a
            // single provider row — which is all of them — so a CREW round
            // whose speakers all failed reported a routing problem when the
            // organization had simply never connected a Gemini key.
            if (previousError instanceof Error) throw previousError;
            throw new Error(
                previousError
                    ? `No fallback providers available. Original error: ${previousError?.message ?? previousError}`
                    : "No fallback providers available",
            );
        }

        // Get default model for this provider
        const fallbackModel = await db
            .select()
            .from(llmModels)
            .where(and(
                eq(llmModels.providerId, fallbackProvider.id),
                eq(llmModels.isActive, true),
                eq(llmModels.isDefault, true)
            ))
            .limit(1);

        let model = fallbackModel[0];
        if (!model) {
            // Try any model from this provider
            const anyModel = await db
                .select()
                .from(llmModels)
                .where(and(
                    eq(llmModels.providerId, fallbackProvider.id),
                    eq(llmModels.isActive, true)
                ))
                .limit(1);

            if (anyModel.length === 0) {
                return this.attemptFallback(request, originalRequestId, organizationId, jobId, jobRunId, previousError, attempt + 1, onChunk);
            }
            model = anyModel[0];
        }

        try {
            const adapter = providerAdapters.get(fallbackProvider.name);
            if (!adapter) {
                throw new Error(`No adapter for fallback provider: ${fallbackProvider.name}`);
            }

            const startTime = Date.now();
            let response: LLMResponse;
            if (request.stream && adapter.stream) {
                response = await adapter.stream(request, model, onChunk || (() => {}));
            } else {
                response = await adapter.complete(request, model);
            }
            const totalMs = Date.now() - startTime;

            // Log as fallback
            await this.logFallbackSuccess(originalRequestId, attempt, fallbackProvider, model, response, totalMs, organizationId);
            await this.updateProviderHealth(fallbackProvider.id, true, totalMs);

            return response;

        } catch (error: any) {
            await this.updateProviderHealth(fallbackProvider.id, false, 0, error.message);
            return this.attemptFallback(request, originalRequestId, organizationId, jobId, jobRunId, error, attempt + 1, onChunk);
        }
    },

    /**
     * Get active providers
     */
    /**
     * All providers configured for an organization, active or not — what the
     * provider-management screen lists. getActiveProviders() is not a substitute:
     * it filters to isActive. Org id is required here so the query can never fall
     * through to an unscoped read across tenants.
     */
    async listProviders(organizationId: number): Promise<any[]> {
        return await db
            .select()
            .from(llmProviders)
            .where(eq(llmProviders.organizationId, organizationId))
            .orderBy(asc(llmProviders.priority));
    },

    async getActiveProviders(organizationId?: number): Promise<any[]> {
        const conditions = [eq(llmProviders.isActive, true)];
        if (organizationId) {
            conditions.push(or(eq(llmProviders.organizationId, organizationId), isNull(llmProviders.organizationId))!);
        } else {
            conditions.push(isNull(llmProviders.organizationId));
        }

        return await db
            .select()
            .from(llmProviders)
            .where(and(...conditions))
            .orderBy(asc(llmProviders.priority));
    },

    /**
     * Get active models
     */
    async getActiveModels(organizationId?: number): Promise<any[]> {
        const conditions = [eq(llmModels.isActive, true)];
        if (organizationId) {
            conditions.push(or(eq(llmModels.organizationId, organizationId), isNull(llmModels.organizationId))!);
        } else {
            conditions.push(isNull(llmModels.organizationId));
        }

        return await db
            .select()
            .from(llmModels)
            .where(and(...conditions));
    },

    /**
     * Log routing decision
     */
    async logRoutingDecision(
        requestId: string,
        selection: any,
        request: LLMRequest,
        jobId?: number,
        jobRunId?: number,
        organizationId?: number
    ): Promise<void> {
        try {
            await db.insert(llmRouterLogs).values({
                requestId,
                // Without this every row was unattributed, so anything that meters spend
                // per organization from llm_router_logs - the crew budget guard - measured
                // zero for every tenant and could never stop a room.
                organizationId: organizationId ?? request.organizationId,
                jobId,
                jobRunId,
                selectedProviderId: selection?.provider?.id,
                selectedModelId: selection?.model?.id,
                routingStrategy: selection?.strategy ?? "unknown",
                requestParams: {
                    temperature: request.temperature,
                    maxTokens: request.maxTokens,
                    messageCount: request.messages?.length ?? 0,
                    multiTokenPrediction: request.multiTokenPrediction,
                },
                requiredCapabilities: request.capabilities,
            } as InsertLlmRouterLog);
        } catch (err: any) {
            logger.warn(`Failed to insert routing decision log for request ${requestId}: ${err?.message}`);
        }
    },

    /**
     * Log successful request
     */
    async logSuccess(requestId: string, selection: any, response: LLMResponse, latencyMs: number): Promise<void> {
        try {
            // A call can succeed while being served by a different backend than
            // selected: withResilience() answers quota-exhausted cloud calls
            // from local Ollama and marks it metadata.fallback. Without this
            // check the log reads "gemini-flash-latest, success" for a turn
            // actually answered by qwen2.5 - which is exactly the lie that made
            // a dead quota key look like healthy Gemini output.
            const meta = (response.metadata ?? {}) as Record<string, unknown>;
            const servedProvider = typeof meta.provider === "string" ? meta.provider : undefined;
            const servedModel = typeof meta.model === "string" ? meta.model : undefined;
            const servedByFallback = meta.fallback != null
                || (servedProvider != null && selection?.provider?.name != null && servedProvider !== selection.provider.name)
                || (servedModel != null && selection?.model?.modelId != null && servedModel !== selection.model.modelId);

            await db.update(llmRouterLogs)
                .set({
                    success: true,
                    inputTokens: response.usage.inputTokens,
                    outputTokens: response.usage.outputTokens,
                    totalTokens: response.usage.totalTokens,
                    cost: response.usage.cost,
                    latencyMs,
                    timeToFirstTokenMs: response.latency?.timeToFirstTokenMs,
                    ...(servedByFallback
                        ? {
                            wasFallback: true,
                            requestParams: sql`coalesce(${llmRouterLogs.requestParams}, '{}'::jsonb) || ${JSON.stringify({
                                servedProvider,
                                servedModel,
                                fallbackVia: typeof meta.fallback === "string" ? meta.fallback : "provider_substitution",
                            })}::jsonb`,
                        }
                        : {}),
                })
                .where(eq(llmRouterLogs.requestId, requestId));
        } catch (err: any) {
            logger.warn(`Failed to update success log for request ${requestId}: ${err?.message}`);
        }
    },

    /**
     * Log failed request
     */
    async logFailure(requestId: string, request: LLMRequest, error: any, organizationId?: number): Promise<void> {
        try {
            const existing = await db
                .select({ id: llmRouterLogs.id })
                .from(llmRouterLogs)
                .where(eq(llmRouterLogs.requestId, requestId))
                .limit(1);

            const errorCode = error?.code || classifyRouterError(error);
            const failureFields = {
                success: false,
                errorMessage: error?.message || String(error),
                errorCode,
            };

            if (existing.length === 0) {
                await db.insert(llmRouterLogs).values({
                    requestId,
                    organizationId: organizationId ?? request.organizationId,
                    routingStrategy: request.routingStrategy || "unknown",
                    ...failureFields,
                    requestParams: {
                        temperature: request.temperature,
                        maxTokens: request.maxTokens,
                        messageCount: request.messages?.length ?? 0,
                    },
                    requiredCapabilities: request.capabilities,
                } as InsertLlmRouterLog);
            } else {
                await db.update(llmRouterLogs)
                    .set({
                        ...failureFields,
                        ...(organizationId ? { organizationId } : {}),
                    })
                    .where(eq(llmRouterLogs.requestId, requestId));
            }
        } catch (err: any) {
            logger.warn(`Failed to log failure for request ${requestId}: ${err?.message}`);
        }
    },

    /**
     * Log fallback success
     */
    async logFallbackSuccess(
        originalRequestId: string,
        attempt: number,
        provider: any,
        model: any,
        response: LLMResponse,
        latencyMs: number,
        organizationId?: number
    ): Promise<void> {
        try {
            await db.insert(llmRouterLogs).values({
                requestId: `${originalRequestId}_fallback_${attempt}`,
                organizationId,
                selectedProviderId: provider.id,
                selectedModelId: model.id,
                routingStrategy: "fallback",
                wasFallback: true,
                fallbackAttempt: attempt,
                previousAttemptIds: [originalRequestId],
                success: true,
                inputTokens: response.usage.inputTokens,
                outputTokens: response.usage.outputTokens,
                totalTokens: response.usage.totalTokens,
                cost: response.usage.cost,
                latencyMs,
            } as InsertLlmRouterLog);
        } catch (err: any) {
            logger.warn(`Failed to log fallback success for request ${originalRequestId}: ${err?.message}`);
        }
    },

    /**
     * Update provider health metrics
     */
    async updateProviderHealth(providerId: number, success: boolean, latencyMs: number, errorMessage?: string): Promise<void> {
        const [health] = await db
            .select()
            .from(llmProviderHealth)
            .where(eq(llmProviderHealth.providerId, providerId))
            .limit(1);

        if (!health) {
            // Create initial health record
            await db.insert(llmProviderHealth).values({
                providerId,
                successRate: success ? 100 : 0,
                avgLatencyMs: latencyMs,
                consecutiveFailures: success ? 0 : 1,
                requestsCount: 1,
                errorsCount: success ? 0 : 1,
            });
            return;
        }

        // Update rolling metrics
        const newRequestsCount = (health.requestsCount ?? 0) + 1;
        const newErrorsCount = (health.errorsCount ?? 0) + (success ? 0 : 1);
        const newSuccessRate = ((newRequestsCount - newErrorsCount) / newRequestsCount) * 100;
        const newConsecutiveFailures = success ? 0 : (health.consecutiveFailures ?? 0) + 1;
        const newAvgLatency = Math.round(((health.avgLatencyMs ?? 0) * (health.requestsCount ?? 0) + latencyMs) / newRequestsCount);

        let status = "healthy";
        if (newConsecutiveFailures >= 5) status = "down";
        else if (newConsecutiveFailures >= 3) status = "degraded";
        else if (newSuccessRate < 95) status = "degraded";

        await db.update(llmProviderHealth)
            .set({
                successRate: newSuccessRate,
                avgLatencyMs: newAvgLatency,
                errorRate: (newErrorsCount / newRequestsCount) * 100,
                status,
                consecutiveFailures: newConsecutiveFailures,
                lastCheckedAt: new Date(),
                lastErrorAt: success ? health.lastErrorAt : new Date(),
                lastErrorMessage: success ? health.lastErrorMessage : errorMessage,
                circuitOpen: status === "down",
                circuitOpenUntil: status === "down" ? new Date(Date.now() + 5 * 60 * 1000) : null, // 5 min cooldown
                requestsCount: newRequestsCount,
                errorsCount: newErrorsCount,
            })
            .where(eq(llmProviderHealth.id, health.id));
    },

    /**
     * Track token usage with existing system
     */
    async trackTokenUsage(
        jobId: number,
        jobRunId: number | undefined,
        selection: any,
        usage: any,
        organizationId?: number
    ): Promise<void> {
        try {
            const { tokenTrackingService } = await import("@domain/jobs/core/token-tracking.service.js");
            
            await tokenTrackingService.recordUsage({
                jobId,
                jobRunId,
                organizationId,
                modelProvider: selection.provider.name,
                modelName: selection.model.modelId,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
            });
        } catch (err: any) {
            logger.warn("Failed to track token usage:", err.message);
        }
    },

    // ============== Provider Adapters ==============

    /**
     * OpenAI completion
     */
    async openAIComplete(request: LLMRequest, model: any): Promise<LLMResponse> {
        return this.unifiedComplete(request, model, "openai");
    },


    /**
     * OpenAI streaming
     */
    async openAIStream(request: LLMRequest, model: any, onChunk: (chunk: string) => void): Promise<LLMResponse> {
        return this.unifiedStream(request, model, "openai", onChunk);
    },

    /**
     * Anthropic completion
     */
    async anthropicComplete(request: LLMRequest, model: any): Promise<LLMResponse> {
        return this.unifiedComplete(request, model, "anthropic");
    },

    /**
     * Anthropic streaming
     */
    async anthropicStream(request: LLMRequest, model: any, onChunk: (chunk: string) => void): Promise<LLMResponse> {
        return this.unifiedStream(request, model, "anthropic", onChunk);
    },

    /**
     * Google/Gemini completion
     */
    async googleComplete(request: LLMRequest, model: any): Promise<LLMResponse> {
        return this.unifiedComplete(request, model, "google");
    },

    /**
     * Google streaming
     */
    async googleStream(request: LLMRequest, model: any, onChunk: (chunk: string) => void): Promise<LLMResponse> {
        return this.unifiedStream(request, model, "google", onChunk);
    },

    /**
     * Azure OpenAI completion
     */
    async azureComplete(request: LLMRequest, model: any): Promise<LLMResponse> {
        return this.unifiedComplete(request, model, "azure");
    },

    /**
     * Azure streaming
     */
    async azureStream(request: LLMRequest, model: any, onChunk: (chunk: string) => void): Promise<LLMResponse> {
        return this.unifiedStream(request, model, "azure", onChunk);
    },

    /**
     * Unified completion handler using AIClientFactory
     */
    async unifiedComplete(request: LLMRequest, model: any, providerName: string): Promise<LLMResponse> {
        const provider = await db
            .select()
            .from(llmProviders)
            .where(eq(llmProviders.id, model.providerId))
            .limit(1);

        if (provider.length === 0) throw new Error(`${providerName} provider not found`);

        const apiKey = provider[0].apiKey;

        const client = AIClientFactory.getClient({
            ...provider[0],
            provider: provider[0].name,
        } as any);

        const startTime = Date.now();
        const apiResponse = await client.execute({
            model: model.modelId,
            // Tenant context: CachedAIClient reads these to call trackSpend(),
            // which records the ledger and enforces the budget kill-switches.
            organizationId: request.organizationId,
            missionId: request.missionId,
            temperature: request.temperature ?? 0.7,
            maxTokens: request.maxTokens,
            messages: request.messages as any,
            requestType: request.jsonMode ? "json" : "text",
            useCache: false,
            saveOutputToFile: false,
            userPrompt: "",
            adapterPath: request.adapterPath,
            thinkingBudget: request.thinkingBudget,
            timeoutMs: request.timeoutMs,
            tools: request.tools,
            multiTokenPrediction: request.multiTokenPrediction ? {
                enabled: request.multiTokenPrediction.enabled ?? false,
                requestPassthrough: request.multiTokenPrediction.requestPassthrough ?? false,
                backend: request.multiTokenPrediction.backend as any,
                numSpeculativeTokens: request.multiTokenPrediction.numSpeculativeTokens,
            } : undefined,
            isPriority: true,
        }, undefined, apiKey);

        if (!apiResponse.success) {
            throw new Error(apiResponse.error || `${providerName} execution failed`);
        }

        const inputTokens = apiResponse.metadata?.promptTokens || Math.max(10, Math.ceil(JSON.stringify(request.messages).length / 4));
        const outputTokens = apiResponse.metadata?.completionTokens || Math.max(10, Math.ceil((apiResponse.output || "").length / 4));

        const { inputCost, outputCost } = routedCallCost(model, inputTokens, outputTokens);

        return {
            content: apiResponse.output || "",
            model: model.modelId,
            provider: provider[0].name,
            usage: {
                inputTokens,
                outputTokens,
                totalTokens: inputTokens + outputTokens,
                cost: inputCost + outputCost,
            },
            latency: { totalMs: Date.now() - startTime },
            metadata: apiResponse.metadata,
        };
    },

    /**
     * Unified streaming handler using AIClientFactory
     */
    async unifiedStream(request: LLMRequest, model: any, providerName: string, onChunk: (chunk: string) => void): Promise<LLMResponse> {
        const provider = await db
            .select()
            .from(llmProviders)
            .where(eq(llmProviders.id, model.providerId))
            .limit(1);

        if (provider.length === 0) throw new Error(`${providerName} provider not found`);

        const apiKey = provider[0].apiKey;

        const client = AIClientFactory.getClient({
            ...provider[0],
            provider: provider[0].name,
        } as any);

        const startTime = Date.now();
        let content = "";
        let outputTokens = 0;

        const inputTokens = Math.max(10, Math.ceil(JSON.stringify(request.messages).length / 4));

        let streamMetadata: Record<string, unknown> | undefined;

        if (client.executeStream) {
            const stream = client.executeStream({
                model: model.modelId,
                // Same tenant/thinking fields as unifiedComplete — without
                // organizationId CachedAIClient skips trackSpend(), and without
                // thinkingBudget Claude 5.x spends the output cap on hidden
                // reasoning and streams nothing.
                organizationId: request.organizationId,
                missionId: request.missionId,
                temperature: request.temperature ?? 0.7,
                maxTokens: request.maxTokens,
                messages: request.messages as any,
                requestType: request.jsonMode ? "json" : "text",
                useCache: false,
                saveOutputToFile: false,
                userPrompt: "",
                adapterPath: request.adapterPath,
                thinkingBudget: request.thinkingBudget,
                timeoutMs: request.timeoutMs,
                tools: request.tools,
                multiTokenPrediction: request.multiTokenPrediction ? {
                    enabled: request.multiTokenPrediction.enabled ?? false,
                    requestPassthrough: request.multiTokenPrediction.requestPassthrough ?? false,
                    backend: request.multiTokenPrediction.backend as any,
                    numSpeculativeTokens: request.multiTokenPrediction.numSpeculativeTokens,
                } : undefined,
                isPriority: true,
            }, undefined, apiKey);

            for await (const chunk of stream) {
                content += chunk;
                onChunk(chunk);
                outputTokens += Math.max(1, Math.ceil(chunk.length / 4));
            }
        } else {
            const apiResponse = await client.execute({
                model: model.modelId,
                // Tenant context: CachedAIClient reads these to call trackSpend(),
                // which records the ledger and enforces the budget kill-switches.
                organizationId: request.organizationId,
                missionId: request.missionId,
                temperature: request.temperature ?? 0.7,
                maxTokens: request.maxTokens,
                messages: request.messages as any,
                requestType: request.jsonMode ? "json" : "text",
                useCache: false,
                saveOutputToFile: false,
                userPrompt: "",
                adapterPath: request.adapterPath,
                multiTokenPrediction: request.multiTokenPrediction ? {
                    enabled: request.multiTokenPrediction.enabled ?? false,
                    requestPassthrough: request.multiTokenPrediction.requestPassthrough ?? false,
                    backend: request.multiTokenPrediction.backend as any,
                    numSpeculativeTokens: request.multiTokenPrediction.numSpeculativeTokens,
                } : undefined,
                isPriority: true,
            }, undefined, apiKey);

            if (!apiResponse.success) {
                throw new Error(apiResponse.error || `${providerName} execution failed`);
            }
            content = apiResponse.output || "";
            onChunk(content);
            outputTokens = apiResponse.metadata?.completionTokens || Math.max(10, Math.ceil(content.length / 4));
            streamMetadata = apiResponse.metadata;
        }

        const { inputCost, outputCost } = routedCallCost(model, inputTokens, outputTokens);

        return {
            content,
            model: model.modelId,
            provider: provider[0].name,
            usage: {
                inputTokens,
                outputTokens,
                totalTokens: inputTokens + outputTokens,
                cost: inputCost + outputCost,
            },
            latency: { totalMs: Date.now() - startTime },
            metadata: streamMetadata,
        };
    },

    /**
     * Get routing statistics
     */
    async getRoutingStats(organizationId?: number, days: number = 7): Promise<any> {
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const logs = await db
            .select()
            .from(llmRouterLogs)
            .where(and(
                organizationId ? eq(llmRouterLogs.organizationId, organizationId) : undefined,
                sql`${llmRouterLogs.createdAt} >= ${startDate}`
            ))
            .orderBy(desc(llmRouterLogs.createdAt));

        const total = logs.length;
        const successful = logs.filter(l => l.success).length;
        const fallbackCount = logs.filter(l => l.wasFallback).length;

        const totalCost = logs.reduce((acc, l) => acc + (l.cost || 0), 0);
        const avgLatency = total > 0
            ? logs.reduce((acc, l) => acc + (l.latencyMs || 0), 0) / total
            : 0;

        // By provider
        const byProvider = logs.reduce((acc: any, l) => {
            const key = `${l.selectedProviderId}`;
            if (!acc[key]) acc[key] = { count: 0, success: 0, cost: 0 };
            acc[key].count++;
            if (l.success) acc[key].success++;
            acc[key].cost += l.cost || 0;
            return acc;
        }, {});

        return {
            total,
            successful,
            failed: total - successful,
            successRate: total > 0 ? (successful / total) * 100 : 0,
            fallbackCount,
            totalCost,
            avgLatency,
            byProvider,
        };
    },

    async createProvider(values: any) {
        const [provider] = await db.insert(llmProviders).values(values).returning();
        return provider;
    },

    async updateProvider(providerId: number, orgId: number, updates: any) {
        const [provider] = await db.update(llmProviders)
            .set({ ...updates, updatedAt: new Date() })
            .where(and(
                eq(llmProviders.id, providerId),
                eq(llmProviders.organizationId, orgId)
            ))
            .returning();
        return provider ?? null;
    },

    async deactivateProvider(providerId: number, orgId: number) {
        await db.update(llmProviders)
            .set({ isActive: false, updatedAt: new Date() })
            .where(and(
                eq(llmProviders.id, providerId),
                eq(llmProviders.organizationId, orgId)
            ));
    },

    async getProviderHealth(providerId: number) {
        const [health] = await db
            .select()
            .from(llmProviderHealth)
            .where(eq(llmProviderHealth.providerId, providerId))
            .limit(1);

        if (!health) {
            return {
                providerId,
                status: "unknown",
                successRate: 100,
                consecutiveFailures: 0,
            };
        }
        return health;
    },

    async listModels(orgId: number, providerName?: string) {
        let conditions = [eq(llmModels.organizationId, orgId)];
        if (providerName) {
            const providerResult = await db
                .select({ id: llmProviders.id })
                .from(llmProviders)
                .where(and(
                    eq(llmProviders.name, providerName),
                    eq(llmProviders.organizationId, orgId)
                ))
                .limit(1);
            
            if (providerResult.length > 0) {
                conditions.push(eq(llmModels.providerId, providerResult[0].id));
            }
        }

        const models = await db
            .select({
                model: llmModels,
                provider: llmProviders,
            })
            .from(llmModels)
            .innerJoin(llmProviders, eq(llmModels.providerId, llmProviders.id))
            .where(and(...conditions))
            .orderBy(asc(llmProviders.priority));

        return models.map(m => ({
            ...m.model,
            provider: m.provider.name,
        }));
    },

    async createModel(values: any) {
        const [model] = await db.insert(llmModels).values(values).returning();
        return model;
    },

    async updateModel(modelId: number, orgId: number, updates: any) {
        const [model] = await db.update(llmModels)
            .set({ ...updates, updatedAt: new Date() })
            .where(and(
                eq(llmModels.id, modelId),
                eq(llmModels.organizationId, orgId)
            ))
            .returning();
        return model ?? null;
    },

    async deactivateModel(modelId: number, orgId: number) {
        await db.update(llmModels)
            .set({ isActive: false, updatedAt: new Date() })
            .where(and(
                eq(llmModels.id, modelId),
                eq(llmModels.organizationId, orgId)
            ));
    },

    async listRoutingRules(orgId: number) {
        return await db
            .select()
            .from(llmRoutingRules)
            .where(eq(llmRoutingRules.organizationId, orgId))
            .orderBy(asc(llmRoutingRules.priority));
    },

    async createRoutingRule(values: any) {
        const [rule] = await db.insert(llmRoutingRules).values(values).returning();
        return rule;
    },

    async updateRoutingRule(ruleId: number, orgId: number, updates: any) {
        const [rule] = await db.update(llmRoutingRules)
            .set({ ...updates, updatedAt: new Date() })
            .where(and(
                eq(llmRoutingRules.id, ruleId),
                eq(llmRoutingRules.organizationId, orgId)
            ))
            .returning();
        return rule ?? null;
    },

    async deleteRoutingRule(ruleId: number, orgId: number) {
        await db.delete(llmRoutingRules)
            .where(and(
                eq(llmRoutingRules.id, ruleId),
                eq(llmRoutingRules.organizationId, orgId)
            ));
    },

    async getLogs(orgId: number, options: { limit?: number; offset?: number; jobId?: number; success?: boolean } = {}) {
        let conditions = [eq(llmRouterLogs.organizationId, orgId)];
        
        if (options.jobId) {
            conditions.push(eq(llmRouterLogs.jobId, options.jobId));
        }
        if (options.success !== undefined) {
            conditions.push(eq(llmRouterLogs.success, options.success));
        }

        return await db
            .select()
            .from(llmRouterLogs)
            .where(and(...conditions))
            .orderBy(desc(llmRouterLogs.createdAt))
            .limit(options.limit || 50)
            .offset(options.offset || 0);
    },

    async estimateCost(orgId: number, modelId?: string, providerName?: string, inputTokens = 0, outputTokens = 0) {
        let modelData: any;
        
        if (modelId) {
            const [m] = await db
                .select()
                .from(llmModels)
                .where(and(
                    eq(llmModels.modelId, modelId),
                    eq(llmModels.organizationId, orgId)
                ))
                .limit(1);
            modelData = m;
        }

        if (!modelData && providerName) {
            const [p] = await db
                .select()
                .from(llmProviders)
                .where(and(
                    eq(llmProviders.name, providerName),
                    eq(llmProviders.organizationId, orgId)
                ))
                .limit(1);
            
            if (p) {
                modelData = {
                    inputCostPer1k: p.defaultInputCostPer1k,
                    outputCostPer1k: p.defaultOutputCostPer1k,
                };
            }
        }

        const inputCost = (inputTokens / 1000) * (modelData?.inputCostPer1k || 0.01);
        const outputCost = (outputTokens / 1000) * (modelData?.outputCostPer1k || 0.03);

        return {
            inputCost: Math.round(inputCost * 10000) / 10000,
            outputCost: Math.round(outputCost * 10000) / 10000,
            totalCost: Math.round((inputCost + outputCost) * 10000) / 10000,
            currency: "USD",
        };
    },
};

// Initialize on module load
llmRouterService.initialize();
