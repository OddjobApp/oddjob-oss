/**
 * Consolidated Error Handling Utilities
 * Standardized error handling across the application
 */

// ============================================================================
// ERROR TYPES AND INTERFACES
// ============================================================================

export enum ErrorCode {
    // Validation Errors
    VALIDATION_FAILED = 'VALIDATION_FAILED',
    INVALID_INPUT = 'INVALID_INPUT',
    MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
    INVALID_FORMAT = 'INVALID_FORMAT',

    // Authentication Errors
    UNAUTHORIZED = 'UNAUTHORIZED',
    FORBIDDEN = 'FORBIDDEN',
    TOKEN_EXPIRED = 'TOKEN_EXPIRED',
    SESSION_EXPIRED = 'SESSION_EXPIRED',

    // Resource Errors
    NOT_FOUND = 'NOT_FOUND',
    ALREADY_EXISTS = 'CONFLICT',
    RESOURCE_CONFLICT = 'RESOURCE_CONFLICT',

    // Network Errors
    NETWORK_ERROR = 'NETWORK_ERROR',
    TIMEOUT = 'TIMEOUT',
    CONNECTION_REFUSED = 'CONNECTION_REFUSED',

    // Business Logic Errors
    BUSINESS_RULE_VIOLATION = 'BUSINESS_RULE_VIOLATION',
    OPERATION_NOT_ALLOWED = 'OPERATION_NOT_ALLOWED',
    INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',

    // System Errors
    INTERNAL_ERROR = 'INTERNAL_ERROR',
    DATABASE_ERROR = 'DATABASE_ERROR',
    EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
    AI_PROVIDER_ERROR = 'AI_PROVIDER_ERROR',

    // Pipeline Specific Errors
    PIPELINE_EXECUTION_FAILED = 'PIPELINE_EXECUTION_FAILED',
    STEP_EXECUTION_FAILED = 'STEP_EXECUTION_FAILED',
    PIPELINE_VALIDATION_FAILED = 'PIPELINE_VALIDATION_FAILED',

    // Job Specific Errors
    JOB_EXECUTION_FAILED = 'JOB_EXECUTION_FAILED',
    JOB_CONFIGURATION_INVALID = 'JOB_CONFIGURATION_INVALID'
}

export enum ErrorSeverity {
    LOW = 'low',
    MEDIUM = 'medium',
    HIGH = 'high',
    CRITICAL = 'critical'
}

export interface AppError {
    code: ErrorCode;
    message: string;
    severity: ErrorSeverity;
    details?: Record<string, any>;
    cause?: Error;
    timestamp: string;
    context?: {
        userId?: string;
        sessionId?: string;
        requestId?: string;
        operation?: string;
        resource?: string;
    };
}

// ============================================================================
// ERROR CLASSES
// ============================================================================

export class ApplicationError extends Error implements AppError {
    public readonly code: ErrorCode;
    public readonly severity: ErrorSeverity;
    public readonly details?: Record<string, any>;
    public readonly cause?: Error;
    public readonly timestamp: string;
    public readonly context?: AppError['context'];

    constructor(
        code: ErrorCode,
        message: string,
        severity: ErrorSeverity = ErrorSeverity.MEDIUM,
        details?: Record<string, any>,
        cause?: Error,
        context?: AppError['context']
    ) {
        super(message);
        this.name = 'ApplicationError';
        this.code = code;
        this.severity = severity;
        this.details = details;
        this.cause = cause;
        this.timestamp = new Date().toISOString();
        this.context = context;

        // Maintain proper stack trace
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ApplicationError);
        }
    }

    toJSON(): AppError {
        return {
            code: this.code,
            message: this.message,
            severity: this.severity,
            details: this.details,
            timestamp: this.timestamp,
            context: this.context
        };
    }
}

export class ValidationError extends ApplicationError {
    constructor(message: string, details?: Record<string, any>, context?: AppError['context']) {
        super(ErrorCode.VALIDATION_FAILED, message, ErrorSeverity.MEDIUM, details, undefined, context);
        this.name = 'ValidationError';
    }
}

export class NotFoundError extends ApplicationError {
    constructor(resource: string, identifier?: string, context?: AppError['context']) {
        const message = identifier ? `${resource} with identifier '${identifier}' not found` : `${resource} not found`;
        super(ErrorCode.NOT_FOUND, message, ErrorSeverity.MEDIUM, { resource, identifier }, undefined, context);
        this.name = 'NotFoundError';
    }
}

export class UnauthorizedError extends ApplicationError {
    constructor(message = 'Unauthorized access', context?: AppError['context']) {
        super(ErrorCode.UNAUTHORIZED, message, ErrorSeverity.HIGH, undefined, undefined, context);
        this.name = 'UnauthorizedError';
    }
}

export class PipelineExecutionError extends ApplicationError {
    constructor(message: string, pipelineId: number, stepIndex?: number, details?: Record<string, any>, context?: AppError['context']) {
        super(
            ErrorCode.PIPELINE_EXECUTION_FAILED,
            message,
            ErrorSeverity.HIGH,
            { pipelineId, stepIndex, ...details },
            undefined,
            context
        );
        this.name = 'PipelineExecutionError';
    }
}

// ============================================================================
// ERROR HANDLING UTILITIES
// ============================================================================

/**
 * Create an error handler for a specific context
 */
export function createErrorHandler(context: string) {
    return (error: unknown, additionalContext?: Record<string, any>): ApplicationError => {
        console.error(`[${context}] Error:`, error);

        if (error instanceof ApplicationError) {
            return error;
        }

        if (error instanceof Error) {
            return new ApplicationError(
                ErrorCode.INTERNAL_ERROR,
                error.message,
                ErrorSeverity.MEDIUM,
                { originalError: error.name, stack: error.stack, ...additionalContext },
                error,
                { operation: context }
            );
        }

        return new ApplicationError(
            ErrorCode.INTERNAL_ERROR,
            'An unexpected error occurred',
            ErrorSeverity.MEDIUM,
            { originalError: error, ...additionalContext },
            undefined,
            { operation: context }
        );
    };
}

/**
 * Safe async operation wrapper
 */
export async function safeAsync<T>(
    operation: () => Promise<T>,
    errorHandler?: (error: unknown) => ApplicationError
): Promise<{ success: true; data: T } | { success: false; error: ApplicationError }> {
    try {
        const data = await operation();
        return { success: true, data };
    } catch (error) {
        const appError = errorHandler ? errorHandler(error) : createErrorHandler('safeAsync')(error);
        return { success: false, error: appError };
    }
}

/**
 * Safe synchronous operation wrapper
 */
export function safeSync<T>(
    operation: () => T,
    errorHandler?: (error: unknown) => ApplicationError
): { success: true; data: T } | { success: false; error: ApplicationError } {
    try {
        const data = operation();
        return { success: true, data };
    } catch (error) {
        const appError = errorHandler ? errorHandler(error) : createErrorHandler('safeSync')(error);
        return { success: false, error: appError };
    }
}

/**
 * Retry operation with exponential backoff
 */
export async function withRetry<T>(
    operation: () => Promise<T>,
    options: {
        maxAttempts?: number;
        baseDelay?: number;
        maxDelay?: number;
        backoffMultiplier?: number;
        retryCondition?: (error: unknown) => boolean;
    } = {}
): Promise<T> {
    const {
        maxAttempts = 3,
        baseDelay = 1000,
        maxDelay = 30000,
        backoffMultiplier = 2,
        retryCondition = () => true
    } = options;

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;

            if (attempt === maxAttempts || !retryCondition(error)) {
                throw error;
            }

            const delay = Math.min(baseDelay * Math.pow(backoffMultiplier, attempt - 1), maxDelay);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}

// ============================================================================
// ERROR LOGGING AND REPORTING
// ============================================================================

export interface ErrorReport {
    error: AppError;
    userAgent?: string;
    url?: string;
    userId?: string;
    sessionId?: string;
    additionalData?: Record<string, any>;
}

/**
 * Report error to logging/monitoring system
 */
export function reportError(error: AppError | Error, additionalData?: Record<string, any>): void {
    const report: ErrorReport = {
        error: error instanceof ApplicationError ? error : createErrorHandler('reportError')(error),
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        additionalData
    };

    // In development, log to console
    if (process.env.NODE_ENV === 'development') {
        console.error('Error Report:', report);
    }

    // In production, this would send to monitoring service
    // Example: sendToMonitoringService(report);

    // For now, just log structured error
    console.error(JSON.stringify({
        level: 'error',
        message: report.error.message,
        code: report.error.code,
        severity: report.error.severity,
        timestamp: report.error.timestamp,
        context: report.error.context,
        stack: error instanceof Error ? error.stack : undefined
    }, null, 2));
}

/**
 * Global error boundary helper
 */
export function handleGlobalError(error: unknown, context?: Record<string, any>): void {
    const appError = createErrorHandler('global')(error, context);
    reportError(appError, { global: true, ...context });
}

/**
 * API error response formatter
 */
export function formatApiError(error: ApplicationError): {
    error: {
        code: string;
        message: string;
        details?: Record<string, any>;
    };
    timestamp: string;
} {
    return {
        error: {
            code: error.code,
            message: error.message,
            details: error.details
        },
        timestamp: error.timestamp
    };
}

// ============================================================================
// ERROR RECOVERY UTILITIES
// ============================================================================

/**
 * Attempt to recover from common errors
 */
export async function attemptRecovery<T>(
    operation: () => Promise<T>,
    recoveryStrategies: Array<{
        condition: (error: ApplicationError) => boolean;
        recover: (error: ApplicationError) => Promise<T>;
    }>
): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        const appError = error instanceof ApplicationError
            ? error
            : createErrorHandler('recovery')(error);

        for (const strategy of recoveryStrategies) {
            if (strategy.condition(appError)) {
                try {
                    return await strategy.recover(appError);
                } catch (recoveryError) {
                    // Recovery failed, continue to next strategy
                    continue;
                }
            }
        }

        // No recovery strategy worked, rethrow original error
        throw appError;
    }
}

/**
 * Circuit breaker for external service calls
 */
export class CircuitBreaker {
    private failures = 0;
    private lastFailureTime = 0;
    private state: 'closed' | 'open' | 'half-open' = 'closed';

    constructor(
        private readonly failureThreshold: number = 5,
        private readonly recoveryTimeout: number = 60000
    ) { }

    async execute<T>(operation: () => Promise<T>): Promise<T> {
        if (this.state === 'open') {
            if (Date.now() - this.lastFailureTime > this.recoveryTimeout) {
                this.state = 'half-open';
            } else {
                throw new ApplicationError(
                    ErrorCode.EXTERNAL_SERVICE_ERROR,
                    'Circuit breaker is open',
                    ErrorSeverity.HIGH,
                    { state: this.state }
                );
            }
        }

        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    private onSuccess(): void {
        this.failures = 0;
        this.state = 'closed';
    }

    private onFailure(): void {
        this.failures++;
        this.lastFailureTime = Date.now();

        if (this.failures >= this.failureThreshold) {
            this.state = 'open';
        }
    }

    getState(): { state: string; failures: number; lastFailureTime: number } {
        return {
            state: this.state,
            failures: this.failures,
            lastFailureTime: this.lastFailureTime
        };
    }
}