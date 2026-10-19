import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/auth/core/security.service.js";
import { auditService } from "@domain/audit/core/audit-service.js";
import { getUserOrgContext, requireOrgId, type OrgContext } from "@server/utils/auth-context.js";
import { resolveOrganizationAuthorization } from "@server/utils/organization-permissions.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { BadRequestError, ForbiddenError } from "@server/utils/errors.js";
import { isOrgAiProviderId, type OrgAiProviderId } from "@shared/org-ai-providers.js";
import { orgModelService } from "./core/org-model.service.js";
import { orgFalKeyService } from "./core/org-fal-key.service.js";

/**
 * Who may connect, replace or remove the org's provider key.
 *
 * Under strict RBAC that is `connector:manage`. Compatibility mode grants every
 * member every permission, so there the permission would widen access from
 * org admins to everyone — compatibility keeps the org-admin check instead.
 */
async function canManageKey(req: Request, context: OrgContext): Promise<boolean> {
    if (context.isSuperAdmin) return true;
    const authorization = await resolveOrganizationAuthorization(req);
    return authorization.enforcement === "strict"
        ? authorization.permissions.includes("connector:manage")
        : context.isOrgAdmin;
}

async function requireKeyManager(req: Request): Promise<OrgContext> {
    const context = await getUserOrgContext(req);
    if (!await canManageKey(req, context)) throw new ForbiddenError("Permission to manage AI connections is required");
    return context;
}

/** Key changes are recorded with the hint only — never the key itself. */
function audit(req: Request, context: OrgContext, action: string, metadata: Record<string, unknown>) {
    return auditService.log({
        action,
        entityType: "organization_ai",
        entityId: String(context.organizationId),
        userId: String(context.userId),
        organizationId: requireOrgId(context),
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        metadata,
    });
}

function providerParam(value: unknown): OrgAiProviderId {
    const provider = value ?? "google";
    if (!isOrgAiProviderId(provider)) throw new BadRequestError("Unknown AI provider");
    return provider;
}

/**
 * The provider's connection being replaced, for the audit record. A stored key
 * that no longer decrypts must not stop an admin from replacing or removing it.
 */
async function previousConnection(organizationId: number, provider: OrgAiProviderId) {
    try {
        const connection = await orgModelService.resolve(organizationId, provider);
        return { configured: !!connection, keyHint: connection ? `…${connection.apiKey.slice(-4)}` : null };
    } catch {
        return { configured: true, keyHint: null as string | null };
    }
}

const router = Router();
router.use(requireAuth);
router.get("/", asyncHandler(async (req: Request, res: Response) => {
    const context = await getUserOrgContext(req);
    res.setHeader("Cache-Control", "no-store");
    res.json({ ...await orgModelService.status(requireOrgId(context)), canManage: await canManageKey(req, context) });
}));
router.put("/", asyncHandler(async (req: Request, res: Response) => {
    const context = await requireKeyManager(req);
    const organizationId = requireOrgId(context);
    const provider = providerParam(req.body?.provider);
    const previous = await previousConnection(organizationId, provider);
    res.setHeader("Cache-Control", "no-store");
    const saved = await orgModelService.save(organizationId, { ...req.body, provider });
    await audit(req, context, previous.configured ? "AI_KEY_REPLACED" : "AI_KEY_CONNECTED", {
        provider: saved.provider, model: saved.model, keyHint: saved.keyHint, previousKeyHint: previous.keyHint,
    });
    res.json(saved);
}));
router.delete("/", asyncHandler(async (req: Request, res: Response) => {
    const context = await requireKeyManager(req);
    const organizationId = requireOrgId(context);
    const provider = providerParam(req.query.provider);
    const previous = await previousConnection(organizationId, provider);
    await orgModelService.remove(organizationId, provider);
    if (previous.configured) {
        await audit(req, context, "AI_KEY_REMOVED", { provider, previousKeyHint: previous.keyHint });
    }
    res.status(204).end();
}));
router.put("/default", asyncHandler(async (req: Request, res: Response) => {
    const context = await requireKeyManager(req);
    const organizationId = requireOrgId(context);
    const provider = providerParam(req.body?.provider);
    await orgModelService.setDefault(organizationId, provider);
    await audit(req, context, "AI_DEFAULT_PROVIDER_CHANGED", { provider });
    res.setHeader("Cache-Control", "no-store");
    res.json(await orgModelService.status(organizationId));
}));
// ── fal.ai (video rendering) ─────────────────────────────────────────────────
// Same permission and audit rules as the model connections above.

async function previousFalConnection(organizationId: number) {
    try {
        return await orgFalKeyService.status(organizationId);
    } catch {
        return { configured: true, provider: "fal", keyHint: null as string | null };
    }
}

router.get("/fal", asyncHandler(async (req: Request, res: Response) => {
    const context = await getUserOrgContext(req);
    res.setHeader("Cache-Control", "no-store");
    res.json({ ...await previousFalConnection(requireOrgId(context)), canManage: await canManageKey(req, context) });
}));
router.put("/fal", asyncHandler(async (req: Request, res: Response) => {
    const context = await requireKeyManager(req);
    const organizationId = requireOrgId(context);
    const previous = await previousFalConnection(organizationId);
    res.setHeader("Cache-Control", "no-store");
    const saved = await orgFalKeyService.save(organizationId, req.body);
    await audit(req, context, previous.configured ? "AI_KEY_REPLACED" : "AI_KEY_CONNECTED", {
        provider: "fal", keyHint: saved.keyHint, previousKeyHint: previous.keyHint,
    });
    res.json(saved);
}));
router.delete("/fal", asyncHandler(async (req: Request, res: Response) => {
    const context = await requireKeyManager(req);
    const organizationId = requireOrgId(context);
    const previous = await previousFalConnection(organizationId);
    await orgFalKeyService.remove(organizationId);
    if (previous.configured) {
        await audit(req, context, "AI_KEY_REMOVED", { provider: "fal", previousKeyHint: previous.keyHint });
    }
    res.status(204).end();
}));

export default router;
