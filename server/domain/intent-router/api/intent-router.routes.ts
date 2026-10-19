/**
 * Intent Router REST API Routes
 * Classification endpoint for routing user prompts to the optimal agent and model.
 *
 * POST /api/intent-router/classify — Classify a prompt along Topic × Intent axes
 *
 * Requirements: 6.5, 8.5, 8.6, 9.4
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";
import { ValidationError } from "@server/utils/errors.js";
import { intentRouterService } from "../core/intent-router.service.js";
import { agentCardService } from "@domain/agent-cards/core/agent-card.service.js";
import { crewGenerationService } from "@domain/crew/core/crew-generation.service.js";
import { crewPersonaService } from "@domain/crew/core/crew-persona.service.js";
import { crewMemoryService } from "@domain/crew/core/crew-memory.service.js";
import { ForbiddenError, NotFoundError } from "@server/utils/errors.js";

const logger = createLogger("IntentRouterRoutes");
const router = Router();

// All intent-router routes require authentication
router.use(requireAuth);

/**
 * POST /api/intent-router/classify
 * Classify a user prompt along Topic × Intent axes, select the optimal agent,
 * and resolve the model binding.
 *
 * Body:
 *   - prompt (string, required): The user prompt to classify
 *   - sessionId (string, required): Session identifier for caching
 *   - bypassCache (boolean, optional): Skip cache lookup if true
 *
 * Returns 200 with full ClassificationResult on success.
 * Returns 400 if prompt is empty or missing required fields.
 * Returns 503 if no model provider is available.
 */
router.post("/classify", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);

    const { prompt, sessionId, bypassCache } = req.body;

    // Validate required fields
    if (!prompt || (typeof prompt === "string" && prompt.trim().length === 0)) {
        throw new ValidationError(
            "Prompt content is required and cannot be empty or whitespace", { field: "prompt" },
        );
    }

    if (!sessionId || typeof sessionId !== "string") {
        throw new ValidationError(
            "Session ID is required", { field: "sessionId" },
        );
    }

    try {
        const result = await intentRouterService.classify({
            prompt,
            organizationId: orgId,
            sessionId,
            bypassCache: bypassCache === true,
        });

        logger.info(
            `Classification complete: topic=${result.topic}, intent=${result.intent}, agent=${result.selectedAgentCardId}, latency=${result.latencyMs}ms`,
        );

        res.json(result);
    } catch (error: any) {
        // Handle provider unavailability as 503 Service Unavailable
        if (error.message?.includes("No available model provider")) {
            logger.error("All model providers unavailable during classification", error);
            return res.status(503).json({
                success: false,
                error: {
                    code: "SERVICE_UNAVAILABLE",
                    message: "No model provider is currently available. Please retry later.",
                    statusCode: 503,
                },
                timestamp: new Date().toISOString(),
            });
        }

        // Re-throw other errors to be handled by the global error handler
        throw error;
    }
}));

/**
 * POST /api/intent-router/respond
 * Classify, select an agent, resolve its model binding AND generate the reply —
 * the single-agent counterpart to a crew round.
 *
 * This is separate from /classify on purpose: requirement 10.1 holds
 * classification to a 150ms budget, and a model call would blow it. /classify
 * stays a pure routing decision; generation lives here.
 *
 * Body:
 *   - prompt (string, required)
 *   - sessionId (string, required)
 *   - selectedAgentCardId (number, optional): route straight to this agent and
 *     skip classification entirely (requirement 11.4).
 *
 * Returns 200 with { response, agentCardId, agentCardName, classification? }.
 * Returns 503 if no model provider is available.
 */
router.post("/respond", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);

    const { prompt, sessionId, selectedAgentCardId } = req.body ?? {};

    if (!prompt || (typeof prompt === "string" && prompt.trim().length === 0)) {
        throw new ValidationError(
            "Prompt content is required and cannot be empty or whitespace", { field: "prompt" },
        );
    }
    if (!sessionId || typeof sessionId !== "string") {
        throw new ValidationError("Session ID is required", {
            field: "sessionId",
        });
    }

    try {
        let classification = null;
        let card;

        if (selectedAgentCardId !== undefined && selectedAgentCardId !== null) {
            // Manual selection bypasses the Intent Router (requirement 11.4).
            const id = Number(selectedAgentCardId);
            if (!Number.isInteger(id) || id <= 0) {
                throw new ValidationError(
                    "selectedAgentCardId must be a positive integer", { field: "selectedAgentCardId" },
                );
            }
            card = await agentCardService.getById(orgId, id);
            if (!card) {
                throw new NotFoundError(`Agent card ${id} not found`, "NOT_FOUND", {
                    agentCardId: id,
                    organizationId: orgId,
                });
            }
        } else {
            classification = await intentRouterService.classify({
                prompt,
                organizationId: orgId,
                sessionId,
            });
            card = await agentCardService.getById(orgId, classification.selectedAgentCardId);
            if (!card) {
                throw new NotFoundError(
                    `Selected agent card ${classification.selectedAgentCardId} not found`,
                    "NOT_FOUND",
                    { organizationId: orgId },
                );
            }
        }

        // Speak in the agent's own voice, grounded in its accumulated experience.
        let memoryContext = "";
        try {
            const recall = await crewMemoryService.recallForDiscussion(orgId, card.name, prompt);
            memoryContext = recall.formattedMemoryContext;
        } catch {
            // Recall is best-effort; an agent without history still answers.
        }

        const result = await crewGenerationService.generate(
            card,
            orgId,
            [
                { role: "system", content: crewPersonaService.buildSystemPrompt(card, [], memoryContext) },
                { role: "user", content: prompt },
            ],
            { temperature: 0.7, maxTokens: 800 },
        );

        logger.info(
            `Responded as "${card.name}" (card ${card.id}) via ${result.modelIdentifier} in ${result.latencyMs}ms`,
        );

        res.json({
            response: result.content,
            agentCardId: card.id,
            agentCardName: card.name,
            modelIdentifier: result.modelIdentifier,
            latencyMs: result.latencyMs,
            classification,
        });
    } catch (error: any) {
        if (error?.message?.includes("No available model provider")) {
            logger.error("All model providers unavailable during respond", error);
            return res.status(503).json({
                success: false,
                error: {
                    code: "SERVICE_UNAVAILABLE",
                    message: "No model provider is currently available. Please retry later.",
                    statusCode: 503,
                },
                timestamp: new Date().toISOString(),
            });
        }
        throw error;
    }
}));

/**
 * GET /api/intent-router/learned-keywords
 * The organization's learned topic vocabulary (labels declared as #[tags]
 * mapped to the classifier category they were observed under), with the
 * decayed effective weight the classifier currently uses. Org-admin curation.
 */
router.get("/learned-keywords", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);
    if (!orgContext.isOrgAdmin && !orgContext.isSuperAdmin) {
        throw new ForbiddenError("Organization management permission is required.");
    }
    res.json({ keywords: await intentRouterService.listLearnedKeywords(orgId) });
}));

/**
 * DELETE /api/intent-router/learned-keywords/:id
 * Forget a learned keyword — the classifier stops scoring it immediately.
 */
router.delete("/learned-keywords/:id", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);
    if (!orgContext.isOrgAdmin && !orgContext.isSuperAdmin) {
        throw new ForbiddenError("Organization management permission is required.");
    }
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
        throw new ValidationError("Select a valid keyword.", { field: "id" });
    }
    await intentRouterService.deleteLearnedKeyword(orgId, id);
    res.json({ ok: true });
}));

/**
 * GET /api/intent-router/topic-drift
 * The inductive payoff: does the classifier agree with the topics users
 * declare? Each declared #[tag] on an intent observation is classified in
 * isolation and compared to the category the router assigned the message.
 */
router.get("/topic-drift", asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);
    if (!orgContext.isOrgAdmin && !orgContext.isSuperAdmin) {
        throw new ForbiddenError("Organization management permission is required.");
    }
    const limit = Number(req.query.limit);
    res.json(await intentRouterService.topicDriftReport(orgId, Number.isInteger(limit) && limit > 0 && limit <= 2000 ? limit : 500));
}));

export const intentRouterRouter = router;
export default router;
