import { Router, type Request, type Response, type NextFunction } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAppToken } from "../infrastructure/app-token.service.js";
import { getSystemOrgContext } from "@server/utils/auth-context.js";
import { validateIdParam } from "@server/utils/api-utils.js";
import { hilFormAccess } from "@domain/pipeline/core/hil-form-access.service.js";

/**
 * /api/platform/app/forms: what PlatformFormBlock reaches inside a built app.
 *
 * The block calls /api/oddjob/forms/*, which the preview proxy rewrites to this
 * app-token API. Only /hil existed here, so the block could neither load nor
 * submit a form in any built app, including the ones already deployed with a
 * copy of it.
 *
 * Forms are HIL forms, so a token granting either `forms` or `hil` may use these
 * routes: `forms` is in ALL_CAPABILITIES, but a deployment minted with a narrower
 * list may only carry `hil`.
 */
const router = Router();

function requireFormsOrHil(req: Request, res: Response, next: NextFunction) {
    const capabilities = req.appTokenContext?.capabilities ?? [];
    if (capabilities.includes("forms") || capabilities.includes("hil")) return next();
    return res.status(403).json({ error: "Token does not grant 'forms' capability" });
}

router.get(
    "/:formId",
    requireAppToken(),
    requireFormsOrHil,
    asyncHandler(async (req: Request, res: Response) => {
        const { orgId } = req.appTokenContext!;
        res.json(await hilFormAccess.getBlockForm(validateIdParam(req.params.formId), getSystemOrgContext(orgId)));
    }),
);

router.post(
    "/:formId/submit",
    requireAppToken(),
    requireFormsOrHil,
    asyncHandler(async (req: Request, res: Response) => {
        const { orgId } = req.appTokenContext!;
        // No submitting user: an app token has no user row, and submittedBy references users.id.
        res.json(
            await hilFormAccess.submitBlockForm(
                validateIdParam(req.params.formId),
                getSystemOrgContext(orgId),
                req.body?.data,
                undefined,
            ),
        );
    }),
);

export { router as formsRouter };
