import { validateIdParam } from "@server/utils/api-utils.js";
/**
 * LLM Router API Routes
 */

import { Router } from "express";
import { llmRouterService } from "@domain/ai/core/llm-router.service.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../../utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("LLMRouterRoutes");
const router = Router();

// ═══════════════════════════════════════════════════════════════════════════════
// CHAT COMPLETION
// ═══════════════════════════════════════════════════════════════════════════════

router.post("/chat/completions", requireAuth, async (req: any, res) => {
    try {
        const orgContext = await getUserOrgContext(req);
        const {
            messages,
            temperature,
            max_tokens,
            model,
            stream,
            capabilities,
            multiTokenPrediction,
            multi_token_prediction,
            routingStrategy,
            routing_strategy,
        } = req.body;

        if (stream) {
            res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            });

            try {
                const response = await llmRouterService.complete(
                    {
                        messages,
                        temperature,
                        maxTokens: max_tokens,
                        preferredModel: model,
                        capabilities,
                        stream: true,
                        routingStrategy: routingStrategy ?? routing_strategy,
                        multiTokenPrediction: multiTokenPrediction ?? multi_token_prediction,
                    },
                    orgContext.organizationId ?? undefined,
                    req.body.jobId,
                    req.body.jobRunId,
                    (chunk) => {
                        res.write(`data: ${JSON.stringify({
                            choices: [{
                                index: 0,
                                delta: { content: chunk },
                                finish_reason: null
                            }]
                        })}\n\n`);
                    }
                );

                res.write(`data: [DONE]\n\n`);
                res.end();
            } catch (err: any) {
                logger.error("Streaming failed:", err);
                res.write(`data: ${JSON.stringify({ error: { message: err.message, type: "api_error" } })}\n\n`);
                res.end();
            }
        } else {
            const response = await llmRouterService.complete(
                {
                    messages,
                    temperature,
                    maxTokens: max_tokens,
                    preferredModel: model,
                    capabilities,
                    stream: false,
                    routingStrategy: routingStrategy ?? routing_strategy,
                    multiTokenPrediction: multiTokenPrediction ?? multi_token_prediction,
                },
                orgContext.organizationId ?? undefined,
                req.body.jobId,
                req.body.jobRunId
            );

            res.json({
                id: response.metadata?.id,
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: response.model,
                choices: [{
                    index: 0,
                    message: {
                        role: "assistant",
                        content: response.content,
                    },
                    finish_reason: "stop",
                }],
                usage: response.usage,
                provider: response.provider,
                latency: response.latency,
                inferenceAcceleration: response.metadata?.inferenceAcceleration,
            });
        }
    } catch (err: any) {
        logger.error("Chat completion failed:", err);
        res.status(500).json({
            error: {
                message: err.message,
                type: "api_error",
            },
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PROVIDER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/ai/providers - List configured providers
router.get("/providers", requireAuth, async (req: any, res) => {
    try {
        const orgContext = await getUserOrgContext(req);
        
        const providers = await llmRouterService.listProviders(orgContext.organizationId as number);

        // Hide API keys in response
        const safeProviders = providers.map(p => ({
            ...p,
            apiKey: p.apiKey ? "***" : null,
        }));

        res.json(safeProviders);
    } catch (err: any) {
        logger.error("Failed to list providers:", err);
        res.status(500).json({ message: err.message });
    }
});

// POST /api/ai/providers - Add new provider
router.post("/providers", requireAuth, async (req: any, res) => {
    try {
        const orgContext = await getUserOrgContext(req);
        const { name, displayName, apiKey, apiEndpoint, ...config } = req.body;

        const provider = await llmRouterService.createProvider({
            organizationId: orgContext.organizationId as number,
            name,
            displayName,
            apiKey,
            apiEndpoint,
            ...config,
        });

        res.json({ ...provider, apiKey: "***" });
    } catch (err: any) {
        logger.error("Failed to add provider:", err);
        res.status(500).json({ message: err.message });
    }
});

// PUT /api/ai/providers/:id - Update provider
router.put("/providers/:id", requireAuth, async (req: any, res) => {
    try {
        const providerId = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);

        const updates = req.body;
        if (updates.apiKey === "***") delete updates.apiKey; // Don't update if masked

        const provider = await llmRouterService.updateProvider(providerId, orgContext.organizationId as number, updates);

        if (!provider) {
            return res.status(404).json({ message: "Provider not found" });
        }

        res.json({ ...provider, apiKey: "***" });
    } catch (err: any) {
        logger.error("Failed to update provider:", err);
        res.status(500).json({ message: err.message });
    }
});

// DELETE /api/ai/providers/:id - Deactivate provider
router.delete("/providers/:id", requireAuth, async (req: any, res) => {
    try {
        const providerId = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);

        await llmRouterService.deactivateProvider(providerId, orgContext.organizationId as number);

        res.json({ success: true });
    } catch (err: any) {
        logger.error("Failed to deactivate provider:", err);
        res.status(500).json({ message: err.message });
    }
});

// GET /api/ai/providers/:id/health - Get provider health status
router.get("/providers/:id/health", requireAuth, async (req: any, res) => {
    try {
        const providerId = validateIdParam(req.params.id);
        
        const health = await llmRouterService.getProviderHealth(providerId);
        res.json(health);
    } catch (err: any) {
        logger.error("Failed to get provider health:", err);
        res.status(500).json({ message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// MODEL MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/ai/models - List available models
router.get("/models", requireAuth, async (req: any, res) => {
    try {
        const orgContext = await getUserOrgContext(req);
        const { provider } = req.query;

        const models = await llmRouterService.listModels(orgContext.organizationId as number, provider as string | undefined);
        res.json(models);
    } catch (err: any) {
        logger.error("Failed to list models:", err);
        res.status(500).json({ message: err.message });
    }
});

// POST /api/ai/models - Add new model
router.post("/models", requireAuth, async (req: any, res) => {
    try {
        const orgContext = await getUserOrgContext(req);
        const { providerId, modelId, displayName, ...config } = req.body;

        const model = await llmRouterService.createModel({
            providerId,
            organizationId: orgContext.organizationId as number,
            modelId,
            displayName,
            ...config,
        });

        res.json(model);
    } catch (err: any) {
        logger.error("Failed to add model:", err);
        res.status(500).json({ message: err.message });
    }
});

// PUT /api/ai/models/:id - Update model
router.put("/models/:id", requireAuth, async (req: any, res) => {
    try {
        const modelId = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);

        const updates = req.body;

        const model = await llmRouterService.updateModel(modelId, orgContext.organizationId as number, updates);

        if (!model) {
            return res.status(404).json({ message: "Model not found" });
        }

        res.json(model);
    } catch (err: any) {
        logger.error("Failed to update model:", err);
        res.status(500).json({ message: err.message });
    }
});

// DELETE /api/ai/models/:id - Deactivate model
router.delete("/models/:id", requireAuth, async (req: any, res) => {
    try {
        const modelId = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);

        await llmRouterService.deactivateModel(modelId, orgContext.organizationId as number);

        res.json({ success: true });
    } catch (err: any) {
        logger.error("Failed to deactivate model:", err);
        res.status(500).json({ message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTING RULES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/ai/routing/rules - List routing rules
router.get("/routing/rules", requireAuth, async (req: any, res) => {
    try {
        const orgContext = await getUserOrgContext(req);
        
        const rules = await llmRouterService.listRoutingRules(orgContext.organizationId as number);
        res.json(rules);
    } catch (err: any) {
        logger.error("Failed to list routing rules:", err);
        res.status(500).json({ message: err.message });
    }
});

// POST /api/ai/routing/rules - Create routing rule
router.post("/routing/rules", requireAuth, async (req: any, res) => {
    try {
        const orgContext = await getUserOrgContext(req);
        
        const rule = await llmRouterService.createRoutingRule({
            organizationId: orgContext.organizationId as number,
            ...req.body,
        });

        res.json(rule);
    } catch (err: any) {
        logger.error("Failed to create routing rule:", err);
        res.status(500).json({ message: err.message });
    }
});

// PUT /api/ai/routing/rules/:id - Update routing rule
router.put("/routing/rules/:id", requireAuth, async (req: any, res) => {
    try {
        const ruleId = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);

        const rule = await llmRouterService.updateRoutingRule(ruleId, orgContext.organizationId as number, req.body);

        if (!rule) {
            return res.status(404).json({ message: "Rule not found" });
        }

        res.json(rule);
    } catch (err: any) {
        logger.error("Failed to update routing rule:", err);
        res.status(500).json({ message: err.message });
    }
});

// DELETE /api/ai/routing/rules/:id - Delete routing rule
router.delete("/routing/rules/:id", requireAuth, async (req: any, res) => {
    try {
        const ruleId = validateIdParam(req.params.id);
        const orgContext = await getUserOrgContext(req);

        await llmRouterService.deleteRoutingRule(ruleId, orgContext.organizationId as number);

        res.json({ success: true });
    } catch (err: any) {
        logger.error("Failed to delete routing rule:", err);
        res.status(500).json({ message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ANALYTICS & LOGS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/ai/analytics - Get routing statistics
router.get("/analytics", requireAuth, async (req: any, res) => {
    try {
        const orgContext = await getUserOrgContext(req);
        const days = parseInt(req.query.days as string) || 7;

        const stats = await llmRouterService.getRoutingStats(orgContext.organizationId ?? undefined, days);

        res.json(stats);
    } catch (err: any) {
        logger.error("Failed to get analytics:", err);
        res.status(500).json({ message: err.message });
    }
});

// GET /api/ai/logs - Get request logs
router.get("/logs", requireAuth, async (req: any, res) => {
    try {
        const orgContext = await getUserOrgContext(req);
        const { limit = 50, offset = 0, jobId, success } = req.query;

        const logs = await llmRouterService.getLogs(orgContext.organizationId as number, {
            limit: parseInt(limit),
            offset: parseInt(offset),
            jobId: jobId ? parseInt(jobId) : undefined,
            success: success !== undefined ? success === "true" : undefined,
        });

        res.json(logs);
    } catch (err: any) {
        logger.error("Failed to get logs:", err);
        res.status(500).json({ message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COST ESTIMATION
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/ai/cost-estimate - Estimate cost for request
router.post("/cost-estimate", requireAuth, async (req: any, res) => {
    try {
        const { model, inputTokens, outputTokens, provider } = req.body;
        const orgContext = await getUserOrgContext(req);

        const estimate = await llmRouterService.estimateCost(
            orgContext.organizationId as number,
            model,
            provider,
            inputTokens,
            outputTokens
        );

        res.json(estimate);
    } catch (err: any) {
        logger.error("Failed to estimate cost:", err);
        res.status(500).json({ message: err.message });
    }
});

export default router;
