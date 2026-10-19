
import { ErrorCode } from "@shared/schema/errors";
import type { ErrorCodeType } from "@shared/schema/errors";

// Re-export for backwards compatibility
export { ErrorCode };
export type { ErrorCodeType };

/**
 * Enhanced Error class for Client-side error handling.
 * Matches the structure of the server's AppError.
 */
export class ClientAppError extends Error {
    public readonly statusCode: number;
    public readonly code: ErrorCodeType;
    public readonly details: any;
    public readonly correlationId?: string;

    constructor(
        message: string,
        statusCode: number = 500,
        code: ErrorCodeType = ErrorCode.INTERNAL_ERROR,
        options?: {
            details?: any;
            correlationId?: string;
        }
    ) {
        super(message);
        this.name = 'ClientAppError';
        this.statusCode = statusCode;
        this.code = code;
        this.details = options?.details;
        this.correlationId = options?.correlationId;
    }

    /**
     * Factory method to create a ClientAppError from an unknown error object.
     * It handles various shapes (axios errors, fetch responses, string errors).
     */
    static fromUnknown(error: unknown): ClientAppError {
        if (error instanceof ClientAppError) {
            return error;
        }

        // Handle error objects that look like our server response
        if (typeof error === 'object' && error !== null) {
            const err = error as any;

            // Direct match for server ErrorResponse.error structure
            if (err.code && Object.values(ErrorCode).includes(err.code)) {
                return new ClientAppError(
                    err.message || 'Unknown Error',
                    err.statusCode || 500,
                    err.code,
                    {
                        details: err.details,
                        correlationId: err.correlationId
                    }
                );
            }

            // Handle nested error property (commonly from API response)
            // { error: { code, message, ... } }
            if (err.error && typeof err.error === 'object') {
                return ClientAppError.fromUnknown(err.error);
            }

            // Fallback for generic JS Error objects
            if (err instanceof Error) {
                // If the error message is valid JSON, try to parse it
                try {
                    const parsed = JSON.parse(err.message);
                    if (parsed && typeof parsed === 'object') {
                        // Recursively try to convert the parsed object
                        const fromParsed = ClientAppError.fromUnknown(parsed);
                        // If we didn't get a generic Internal Error, return it
                        if (fromParsed.code !== ErrorCode.INTERNAL_ERROR || fromParsed.message !== 'Internal Server Error') {
                            return fromParsed;
                        }
                    }
                } catch (e) {
                    // Not JSON, continue
                }

                // Standard error
                const message = err.message || 'An unexpected error occurred';
                return new ClientAppError(
                    message,
                    (err as any).status || (err as any).statusCode || 500,
                    ErrorCode.INTERNAL_ERROR
                );
            }
        }

        // String errors
        if (typeof error === 'string') {
            return new ClientAppError(error);
        }

        return new ClientAppError('An unexpected error occurred');
    }
}

/**
 * Helper to get a user-friendly title based on error code
 */
export function getErrorTitle(code: ErrorCodeType): string {
    switch (code) {
        case ErrorCode.VALIDATION_FAILED:
        case ErrorCode.INVALID_INPUT:
        case ErrorCode.MISSING_REQUIRED_FIELD:
        case ErrorCode.INVALID_FORMAT:
            return 'Validation Error';

        case ErrorCode.UNAUTHORIZED:
            return 'Authentication Required';
        case ErrorCode.FORBIDDEN:
        case ErrorCode.INSUFFICIENT_PERMISSIONS:
            return 'Access Denied';

        case ErrorCode.NOT_FOUND:
        case ErrorCode.JOB_NOT_FOUND:
        case ErrorCode.PIPELINE_NOT_FOUND:
            return 'Not Found';

        case ErrorCode.CONFLICT:
        case ErrorCode.DUPLICATE_ENTRY:
            return 'Conflict';

        case ErrorCode.EXTERNAL_SERVICE_ERROR:
        case ErrorCode.AI_PROVIDER_ERROR:
            return 'Service Error';

        case ErrorCode.RATE_LIMITED:
            return 'Too Many Requests';

        default:
            return 'Error';
    }
}
