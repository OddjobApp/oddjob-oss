/**
 * Auth Service Middleware
 */

import type { Request, Response, NextFunction } from "express";

/**
 * Error response interface
 */
interface ErrorResponse {
    error: string;
    message: string;
    code?: string;
    timestamp: string;
}

/**
 * AppError for typed errors
 */
export class AppError extends Error {
    constructor(
        message: string,
        public statusCode: number = 500,
        public code: string = "INTERNAL_ERROR"
    ) {
        super(message);
        this.name = "AppError";
    }
}

export class BadRequestError extends AppError {
    constructor(message: string) {
        super(message, 400, "BAD_REQUEST");
    }
}

export class UnauthorizedError extends AppError {
    constructor(message: string = "Unauthorized") {
        super(message, 401, "UNAUTHORIZED");
    }
}

export class NotFoundError extends AppError {
    constructor(message: string = "Not found") {
        super(message, 404, "NOT_FOUND");
    }
}

export class ConflictError extends AppError {
    constructor(message: string) {
        super(message, 409, "CONFLICT");
    }
}

/**
 * Global error handler
 */
export function errorHandler(
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction
): void {
    console.error(`[auth-service] Error: ${err.message}`, err);

    const statusCode = err instanceof AppError ? err.statusCode : 500;
    const code = err instanceof AppError ? err.code : "INTERNAL_ERROR";

    const response: ErrorResponse = {
        error: err.name || "Error",
        message: err.message || "Internal server error",
        code,
        timestamp: new Date().toISOString(),
    };

    res.status(statusCode).json(response);
}

/**
 * 404 handler
 */
export function notFoundHandler(req: Request, res: Response): void {
    res.status(404).json({
        error: "Not Found",
        message: `Route ${req.method} ${req.path} not found`,
        code: "NOT_FOUND",
        timestamp: new Date().toISOString(),
    });
}

/**
 * Async handler wrapper
 */
export function asyncHandler(
    fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Require authentication middleware
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
    const userId = (req.session as any)?.userId;

    if (!userId) {
        res.status(401).json({
            error: "Unauthorized",
            message: "Authentication required",
            code: "UNAUTHORIZED",
            timestamp: new Date().toISOString(),
        });
        return;
    }

    next();
}
