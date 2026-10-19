
import { Router, Request, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@server/utils/errors.js";
import { validateIdParam } from "@server/utils/api-utils.js";
import { CHANNEL_TYPES, type ChannelType } from "@shared/schema/index.js";
import { omnichannelService } from "@domain/integrations/core/omnichannel.service.js";

const router = Router();

/**
 * Per person, not per IP: the people pairing share office networks, and the
 * thing being limited is one account guessing at one number. A backstop to the
 * per-challenge cap in omnichannelService (MAX_VERIFY_ATTEMPTS), which is the
 * part that holds across processes.
 */
const perUser = (windowMs: number, max: number, message: string) => rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => `channels:${(req.session as any)?.userId ?? ipKeyGenerator(req.ip ?? "")}`,
    message: { message },
});
// Each start texts a code to the number, so restarts are what an attacker would cycle.
const startLimiter = perUser(60 * 60 * 1000, 5, "Too many pairing requests — try again in an hour.");
const verifyLimiter = perUser(10 * 60 * 1000, 20, "Too many verification attempts — try again later.");

/**
 * Channel pairing binds an external identifier (E.164 phone, Telegram chat) to
 * a specific users.id — an API-key or internal-token principal has no user row
 * to bind to, so a real session user is required.
 */
function requireSessionUserId(req: Request): string {
    const userId = (req.session as any)?.userId;
    if (!userId) {
        throw new ForbiddenError("Channel identities require an authenticated user session");
    }
    return userId;
}

/**
 * POST /api/channels/identities
 * Start pairing a channel to the current user. Sends a 6-digit code over the
 * channel; the code itself is never returned — 202 + {id, delivered}.
 */
router.post("/identities", requireAuth, startLimiter, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const userId = requireSessionUserId(req);

    const { channelType, channelIdentifier } = req.body ?? {};
    if (!CHANNEL_TYPES.includes(channelType)) {
        throw new BadRequestError(`channelType must be one of: ${CHANNEL_TYPES.join(", ")}`);
    }
    if (typeof channelIdentifier !== "string" || !channelIdentifier.trim()) {
        throw new BadRequestError("channelIdentifier is required");
    }

    const result = await omnichannelService.startPairing({
        organizationId,
        userId,
        channelType: channelType as ChannelType,
        channelIdentifier,
    });

    if (!result.ok) {
        if (result.reason === "identifier_in_use") {
            throw new ConflictError("This channel identifier is already paired to another account");
        }
        throw new BadRequestError("channelIdentifier is not a valid identifier for this channel");
    }

    res.status(202).json({ id: result.id, delivered: result.delivered });
}));

/**
 * POST /api/channels/identities/:id/verify
 * Confirm a pairing with the code sent to the channel.
 * Error mapping: not_found → 404, expired → 410, wrong_code → 400,
 * too_many_attempts → 429, identifier_in_use → 409.
 */
router.post("/identities/:id/verify", requireAuth, verifyLimiter, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const userId = requireSessionUserId(req);
    const identityId = validateIdParam(req.params.id, "Identity ID");

    const code = req.body?.code;
    if (typeof code !== "string" || !code.trim()) {
        throw new BadRequestError("code is required");
    }

    const result = await omnichannelService.verifyPairing({
        organizationId,
        userId,
        identityId,
        code: code.trim(),
    });

    if (!result.ok) {
        if (result.reason === "not_found") throw new NotFoundError("Channel identity not found");
        if (result.reason === "expired") {
            return res.status(410).json({ message: "Verification code expired — start pairing again for a new one" });
        }
        if (result.reason === "too_many_attempts") {
            return res.status(429).json({ message: "Too many wrong codes — start pairing again for a new one" });
        }
        if (result.reason === "identifier_in_use") {
            throw new ConflictError("This channel identifier is already verified for another account");
        }
        throw new BadRequestError("Incorrect verification code");
    }

    res.json({ ok: true, verified: true });
}));

/**
 * GET /api/channels/identities
 * The current user's channel identities in this org (verification codes stripped).
 */
router.get("/identities", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const userId = requireSessionUserId(req);

    res.json(await omnichannelService.listIdentities(organizationId, userId));
}));

/**
 * DELETE /api/channels/identities/:id
 * Unlink a channel — owner only.
 */
router.delete("/identities/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const userId = requireSessionUserId(req);
    const identityId = validateIdParam(req.params.id, "Identity ID");

    const removed = await omnichannelService.removeIdentity(organizationId, userId, identityId);
    if (!removed) throw new NotFoundError("Channel identity not found");

    res.status(204).end();
}));

export default router;
