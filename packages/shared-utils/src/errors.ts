/**
 * Standardized error response format
 */
export interface ErrorResponse {
    success: boolean;
    error: {
        code: string;
        message: string;
        statusCode: number;
        details?: any;
    };
    correlationId?: string;
    timestamp: string;
    path?: string;
}

/**
 * Enhanced Application Error
 */
export class AppError extends Error {
    public readonly statusCode: number;
    public readonly code: string;
    public readonly isOperational: boolean;
    public readonly details?: any;
    public readonly correlationId?: string;

    constructor(
        message: string,
        statusCode: number = 500,
        code: string = 'INTERNAL_ERROR',
        options?: {
            isOperational?: boolean;
            details?: any;
            correlationId?: string;
        }
    ) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.isOperational = options?.isOperational ?? true;
        this.details = options?.details;
        this.correlationId = options?.correlationId;

        // Maintain stack trace in environments like Node.js
        if ((Error as any).captureStackTrace) {
            (Error as any).captureStackTrace(this, this.constructor);
        }
    }

    /**
     * Convert to standardized error response object
     */
    toResponse(path?: string): ErrorResponse {
        return {
            success: false,
            error: {
                code: this.code,
                message: this.message,
                statusCode: this.statusCode,
                details: this.details,
            },
            correlationId: this.correlationId,
            timestamp: new Date().toISOString(),
            path,
        };
    }
}

export class BadRequestError extends AppError {
    constructor(message: string = 'Bad Request', details?: any, code: string = 'INVALID_INPUT') {
        super(message, 400, code, { details });
    }
}

export class ValidationError extends AppError {
    constructor(message: string = 'Validation Failed', details?: any) {
        super(message, 400, 'VALIDATION_FAILED', { details });
    }
}

export class UnauthorizedError extends AppError {
    constructor(message: string = 'Unauthorized', details?: any) {
        super(message, 401, 'UNAUTHORIZED', { details });
    }
}

export class ForbiddenError extends AppError {
    constructor(message: string = 'Forbidden', details?: any) {
        super(message, 403, 'FORBIDDEN', { details });
    }
}

export class NotFoundError extends AppError {
    constructor(message: string = 'Not Found', code: string = 'NOT_FOUND', details?: any) {
        super(message, 404, code, { details });
    }
}

export class InternalServerError extends AppError {
    constructor(message: string = 'Internal Server Error', details?: any) {
        super(message, 500, 'INTERNAL_ERROR', { details });
    }
}

export class ExternalServiceError extends AppError {
    constructor(
        serviceName: string,
        originalError?: Error,
        code: string = 'EXTERNAL_SERVICE_ERROR'
    ) {
        super(
            `External service error: ${serviceName}`,
            502,
            code,
            {
                details: {
                    service: serviceName,
                    originalMessage: originalError?.message,
                },
            }
        );
    }
}

export class ConflictError extends AppError {
    constructor(message: string = 'Conflict', details?: any) {
        super(message, 409, 'CONFLICT', { details });
    }
}

export class RateLimitError extends AppError {
    constructor(message: string = 'Rate limit exceeded', retryAfter?: number) {
        super(message, 429, 'RATE_LIMITED', {
            details: { retryAfter },
        });
    }
}

export class ConfigurationError extends AppError {
    constructor(message: string, details?: any) {
        super(message, 500, 'CONFIGURATION_ERROR', { details });
    }
}

