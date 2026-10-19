/**
 * Validation Middleware
 * 
 * Zod-based request validation middleware for Express.
 * Provides type-safe validation for body, query, and params.
 */

import { z, ZodSchema, ZodError } from "zod";
import type { Request, Response, NextFunction } from "express";
import { BadRequestError } from "../utils/errors.js";

/**
 * Validation target types
 */
type ValidationTarget = "body" | "query" | "params";

/**
 * Validate request data against a Zod schema
 */
export function validate<T extends ZodSchema>(
    schema: T,
    target: ValidationTarget = "body"
) {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            const data = req[target];
            const result = await schema.parseAsync(data);

            // Replace request data with validated data
            req[target] = result;
            next();
        } catch (error) {
            if (error instanceof ZodError) {
                const messages = error.errors.map(
                    (e) => `${e.path.join(".")}: ${e.message}`
                );
                next(new BadRequestError(`Validation failed: ${messages.join(", ")}`));
            } else {
                next(error);
            }
        }
    };
}

/**
 * Validate multiple targets at once
 */
export function validateRequest<
    TBody extends ZodSchema = ZodSchema,
    TQuery extends ZodSchema = ZodSchema,
    TParams extends ZodSchema = ZodSchema
>(schemas: {
    body?: TBody;
    query?: TQuery;
    params?: TParams;
}) {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            if (schemas.body) {
                req.body = await schemas.body.parseAsync(req.body);
            }
            if (schemas.query) {
                req.query = await schemas.query.parseAsync(req.query) as any;
            }
            if (schemas.params) {
                req.params = await schemas.params.parseAsync(req.params) as any;
            }
            next();
        } catch (error) {
            if (error instanceof ZodError) {
                const messages = error.errors.map(
                    (e) => `${e.path.join(".")}: ${e.message}`
                );
                next(new BadRequestError(`Validation failed: ${messages.join(", ")}`));
            } else {
                next(error);
            }
        }
    };
}

// ============================================================================
// COMMON SCHEMAS
// ============================================================================

/**
 * Pagination query parameters
 */
export const PaginationSchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sortBy: z.string().optional(),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

/**
 * Common ID parameter
 */
export const IdParamSchema = z.object({
    id: z.coerce.number().int().positive(),
});

/**
 * String ID parameter (for UUIDs)
 */
export const StringIdParamSchema = z.object({
    id: z.string().min(1),
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type Pagination = z.infer<typeof PaginationSchema>;
export type IdParam = z.infer<typeof IdParamSchema>;

