import type { NextFunction, Request, Response } from "express";
import { requireOrgAdminOrSuper } from "@server/utils/auth-context.js";

/**
 * Cycle permission guards, shared by every router that reads or changes
 * operational cycles. They were private to server/routes/operational-cycles.ts,
 * so the Cycle Builder — which creates cycles and rewrites them in place —
 * enforced nothing and let any org member do what the cycles API reserves for
 * cycle:write holders and org admins.
 */

/** cycle:read, cycle:write or admin:full; otherwise the caller must be an org admin. */
export function requireCycleRead(req: Request, res: Response, next: NextFunction) {
    const perms: string[] = (req as any).user?.mcpPermissions || [];
    if (perms.includes("cycle:read") || perms.includes("cycle:write") || perms.includes("admin:full")) {
        return next();
    }
    return requireOrgAdminOrSuper(req, res, next);
}

/** cycle:write or admin:full; otherwise the caller must be an org admin. */
export function requireCycleWrite(req: Request, res: Response, next: NextFunction) {
    const perms: string[] = (req as any).user?.mcpPermissions || [];
    if (perms.includes("cycle:write") || perms.includes("admin:full")) {
        return next();
    }
    return requireOrgAdminOrSuper(req, res, next);
}
