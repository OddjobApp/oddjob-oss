/**
 * Bots API Routes
 *
 * POST /api/bots/interpret   – natural-language → BotBlueprint (preview)
 * POST /api/bots/propose     – instruction + blueprint → AgentChangeProposal
 * POST /api/bots/create      – reviewed proposal → agent + CREW room + Agent Studio mount
 * GET  /api/bots             – list caller's enabled agent cards
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";
import { ValidationError } from "@server/utils/errors.js";
import { botInterpreterService } from "../core/bot-interpreter.service.js";
import { botFactoryService } from "../core/bot-factory.service.js";
import { agentCardService } from "@server/domain/agent-cards/core/agent-card.service.js";

const logger = createLogger("BotsRouter");
export const botsRouter = Router();

botsRouter.use(requireAuth);

function requiredInstruction(value: unknown): string {
    if (typeof value !== "string" || value.trim().length < 3) {
        throw new ValidationError("instruction must be a non-empty string (min 3 chars)", { field: "instruction" });
    }
    return value.trim();
}

/**
 * POST /api/bots/interpret
 *
 * Interprets a natural-language prompt and returns a BotBlueprint for preview.
 * Does NOT create any resources.
 */
botsRouter.post(
    "/interpret",
    asyncHandler(async (req: Request, res: Response) => {
        const { prompt } = req.body as { prompt?: unknown };
        if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3) {
            throw new ValidationError("prompt must be a non-empty string (min 3 chars)", { field: "prompt" });
        }

        const blueprint = await botInterpreterService.interpret(prompt.trim());
        res.json(blueprint);
    }),
);

/**
 * POST /api/bots/propose
 *
 * Converts the reviewed blueprint into an Agent Studio proposal. This is a
 * read-only preview: applying it is a separate explicit action.
 *
 * Body: { instruction: string, blueprint: BotBlueprint }
 * Returns: AgentChangeProposal
 */
botsRouter.post(
    "/propose",
    asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        requireOrgId(orgContext);
        const instruction = requiredInstruction(req.body?.instruction);

        const proposal = await botFactoryService.propose(orgContext, instruction, req.body?.blueprint);
        res.json(proposal);
    }),
);

/**
 * POST /api/bots/create
 *
 * Applies the exact Agent Studio proposal the user reviewed, then provisions
 * the applied card into a CREW room and mounts Agent Studio there.
 *
 * Body: { instruction: string, blueprint: BotBlueprint, proposal: AgentChangeProposal }
 * Returns: BotCreationResult
 */
botsRouter.post(
    "/create",
    asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const orgId = requireOrgId(orgContext);
        const instruction = requiredInstruction(req.body?.instruction);
        const proposal = req.body?.proposal;

        if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
            throw new ValidationError("proposal must be the AgentChangeProposal returned by /api/bots/propose", { field: "proposal" });
        }

        logger.info("Applying reviewed bot proposal", { proposalId: proposal.proposalId, orgId });
        const result = await botFactoryService.create(orgContext, {
            instruction,
            blueprint: req.body?.blueprint,
            proposal,
        });

        res.status(201).json(result);
    }),
);

/**
 * GET /api/bots
 *
 * Returns enabled agent cards for the current org. Kept as a compatibility
 * alias for the existing Bot Builder roster.
 */
botsRouter.get(
    "/",
    asyncHandler(async (req: Request, res: Response) => {
        const orgContext = await getUserOrgContext(req);
        const orgId = requireOrgId(orgContext);
        const cards = await agentCardService.list(orgId);
        res.json(cards);
    }),
);
