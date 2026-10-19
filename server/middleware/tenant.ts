import { type Request, type Response, type NextFunction } from "express";
import { ForbiddenError } from "../utils/errors.js";
import { getUserOrgContext } from "../utils/auth-context.js";

/** Derive tenant scope from verified identity, never directly from a header. */
export const requireOrganization = (strict = true) => {
    return async (req: Request, _res: Response, next: NextFunction) => {
        try {
            const context = await getUserOrgContext(req);
            req.organizationId = context.organizationId ?? undefined;
            if (strict && !req.organizationId) throw new ForbiddenError("Organization context required");
            next();
        } catch (error) {
            next(error);
        }
    };
};
export const resolveOrganization = requireOrganization(false);
