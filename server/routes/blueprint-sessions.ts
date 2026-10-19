import { Router } from "express";
import { randomUUID } from "node:crypto";
import { AssemblyBlueprintSchema } from "@shared/schema/assembly-blueprint.js";
import { blueprintStateService } from "@domain/scaffold/blueprint-state.service.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "../domain/core/auth/security.service.js";
import { assertOrgId } from "@server/utils/auth-context.js";

/**
 * Multi-step assembly runs.
 *
 * The server is authoritative for stage state. The client renders the summary
 * returned here and does not keep a second copy of the state machine: stage
 * prerequisites are enforced in submitStageCompletion, and a client-held machine
 * can be driven out of order by anyone able to call the endpoint.
 *
 * Every handler scopes by organization. An id belonging to another org reads as
 * 404, not 403, so the endpoint does not confirm that it exists.
 */
const router = Router();

router.use(requireAuth);

function orgOf(req: any): number {
    return assertOrgId(req.organizationId ?? req.session?.organizationId ?? req.user?.defaultOrgId);
}

// Start a run from a blueprint. The blueprint is snapshotted into the session.
router.post("/", asyncHandler(async (req: any, res: any) => {
    const parsed = AssemblyBlueprintSchema.safeParse(req.body?.blueprint);
    if (!parsed.success) {
        return res.status(400).json({
            error: "Invalid blueprint",
            details: parsed.error.issues.slice(0, 10),
        });
    }

    const sessionId = randomUUID();
    const summary = await blueprintStateService.createSession(
        sessionId,
        parsed.data,
        orgOf(req),
        req.user?.id ? String(req.user.id) : undefined,
    );
    res.status(201).json(summary);
}));

router.get("/:sessionId", asyncHandler(async (req: any, res: any) => {
    const summary = await blueprintStateService.getSessionSummary(req.params.sessionId, orgOf(req));
    res.json(summary);
}));

// Complete a stage and advance. Rejects out-of-order completion with 409.
router.post("/:sessionId/stages/:stageId", asyncHandler(async (req: any, res: any) => {
    const payload = (req.body?.outputs ?? {}) as Record<string, unknown>;
    if (typeof payload !== "object" || Array.isArray(payload) || payload === null) {
        return res.status(400).json({ error: "`outputs` must be an object" });
    }

    const summary = await blueprintStateService.submitStageCompletion(
        req.params.sessionId,
        req.params.stageId,
        payload,
        orgOf(req),
    );
    res.json(summary);
}));

export default router;
