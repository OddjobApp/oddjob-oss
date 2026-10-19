import { Request, Response, NextFunction } from "express";
import { AppError, ErrorCode, createErrorResponse, ErrorCodeType } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger('ErrorHandler');

import { errorDiagnosisEngine } from "@domain/diagnostics/core/error-diagnosis.engine.js";

/**
 * Global error handler middleware for Express
 * 
 * This middleware catches all errors and returns a standardized error response.
 * It logs errors with correlation IDs for tracing.
 */
export const errorHandler = (
    err: any,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    // Log all errors to console for debugging
    if (req.method === 'POST' && req.path.includes('login')) {
        console.error(`[errorHandler] LOGIN ERROR: ${req.method} ${req.path}`);
        console.error(`[errorHandler] Error message:`, err.message);
        console.error(`[errorHandler] Error status:`, err.status || err.statusCode || 'unknown');
    }

    // Get correlation ID from request
    const correlationId = req.correlationId || 'unknown';

    // Determine if this is an operational error (expected) or programming error
    const isOperational = err instanceof AppError && err.isOperational;

    // Determine status code
    let statusCode = 500;
    let errorCode: ErrorCodeType = ErrorCode.INTERNAL_ERROR;
    let message = 'Internal Server Error';
    let details: any = undefined;

    // Extremely robust status detection
    const rawStatus = err.statusCode || err.status || (err.response && err.response.status);
    if (rawStatus && typeof rawStatus === 'number') {
        statusCode = rawStatus;
        errorCode = (err.code || (statusCode >= 400 && statusCode < 500 ? ErrorCode.INVALID_INPUT : ErrorCode.INTERNAL_ERROR)) as ErrorCodeType;
        message = err.message || message;
        details = err.details || err.data;
    } else if (err instanceof AppError) {
        statusCode = err.statusCode;
        errorCode = err.code as ErrorCodeType;
        message = err.message;
        details = err.details;
    } else if (err.message) {
        message = err.message;
    }

    // Handle Zod validation errors
    if (err.name === 'ZodError') {
        statusCode = 400;
        errorCode = ErrorCode.VALIDATION_FAILED;
        message = 'Validation failed';
        details = err.issues;
    }

    // Handle JSON parsing errors
    if (err.type === 'entity.parse.failed') {
        statusCode = 400;
        errorCode = ErrorCode.INVALID_FORMAT;
        message = 'Invalid JSON in request body';
    }

    // Log the error with context
    const logContext = {
        correlationId,
        statusCode,
        errorCode,
        path: req.path,
        method: req.method,
        userId: (req.session as any)?.userId,
        isOperational,
    };

    if (statusCode >= 500) {
        // Server errors - log full stack trace
        logger.error(`${req.method} ${req.path} - ${message}`, err, logContext);

        // Trigger asynchronous diagnosis for server errors
        // We don't await this to avoid blocking the response
        errorDiagnosisEngine.diagnose({
            error: err,
            errorCode,
            httpStatus: statusCode,
            requestUrl: req.originalUrl || req.url,
            organizationId: (req.session as any)?.organizationId,
            // Add identifying info to help diagnosis
            stepOutput: details,
        }, { includeAI: true }).catch((diagErr: any) => {
            logger.error('Failed to run error diagnosis', diagErr);
        });

    } else if (statusCode >= 400) {
        // Client errors - log as warning with details
        logger.warn(`${req.method} ${req.path} - ${message}`, { ...logContext, details });
    }

    // Create standardized error response
    const errorResponse = createErrorResponse(errorCode, message, statusCode, {
        details,
        correlationId,
        path: req.path,
    });

    // In development mode, include stack trace for 500 errors
    if (process.env.NODE_ENV === 'development' && statusCode >= 500) {
        (errorResponse as any).stack = err.stack;
    }

    res.status(statusCode).json(errorResponse);
};

/**
 * Async wrapper to catch errors in async routes and pass them to next()
 * 
 * Usage: router.get('/path', asyncHandler(async (req, res) => { ... }))
 */
export const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * 404 Not Found handler
 * Use this as the last middleware before error handler
 */
export const notFoundHandler = (req: Request, res: Response, next: NextFunction) => {
    const correlationId = req.correlationId || 'unknown';

    logger.debug(`Route not found: ${req.method} ${req.path}`, { correlationId });

    res.status(404).json(createErrorResponse(
        ErrorCode.NOT_FOUND,
        `Route not found: ${req.method} ${req.path}`,
        404,
        { correlationId, path: req.path }
    ));
};

/**
 * Create an error-safe handler that logs and returns appropriate errors
 */
export function createSafeHandler<T>(
    handler: (req: Request, res: Response) => Promise<T>,
    options?: { logSuccess?: boolean }
) {
    return async (req: Request, res: Response, next: NextFunction) => {
        const correlationId = req.correlationId;
        const startTime = Date.now();

        try {
            await handler(req, res);

            if (options?.logSuccess) {
                const duration = Date.now() - startTime;
                logger.debug(`${req.method} ${req.path} completed`, { correlationId, duration });
            }
        } catch (error) {
            // Attach correlation ID to error if it's an AppError
            if (error instanceof AppError && !error.correlationId) {
                (error as any).correlationId = correlationId;
            }
            next(error);
        }
    };
}
