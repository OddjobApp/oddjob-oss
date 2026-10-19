
import { Router, Request, Response } from "express";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { requireAuth } from "@domain/auth/core/security.service.js";
import { ForbiddenError, UnauthorizedError } from "@server/utils/errors.js";

const router = Router();

// GET /api/users - the people a caller can pick (assignees, invitees).
//
// Was unauthenticated and unscoped: anyone, signed in or not, got every user on
// the platform with their email. Now it needs a session and lists the caller's
// org — super admins keep the platform-wide view, as listUsers already gives them.
router.get("/", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { getUserOrgContext } = await import("@server/utils/auth-context.js");
    const { userService } = await import("@domain/org/core/user.service.js");
    const context = await getUserOrgContext(req);
    const members = await userService.listUsers(context);
    res.json(members.map((u: any) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
    })));
}));

/**
 * PATCH /api/users/:id — a user updating their own profile and quiet hours.
 * `:id` must be the caller (or "me"); administrators edit other people through
 * /api/admin/users. The body is allow-listed in selfProfileService.
 */
router.patch("/:id", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const sessionUserId = (req.session as any)?.userId;
    if (!sessionUserId) throw new UnauthorizedError("Not authenticated");
    const target = req.params.id === "me" ? String(sessionUserId) : req.params.id;
    if (target !== String(sessionUserId)) throw new ForbiddenError("You can only update your own profile");

    const { selfProfileService } = await import("@domain/org/core/self-profile.service.js");
    res.json(await selfProfileService.update(target, req.body));
}));

export default router;

