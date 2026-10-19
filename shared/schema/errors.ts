/**
 * Error Codes - Unique identifiers for common error scenarios
 * These codes help frontend handle errors consistently and enable better error tracking
 */
export const ErrorCode = {
    // Validation Errors (400)
    VALIDATION_FAILED: 'VALIDATION_FAILED',
    INVALID_INPUT: 'INVALID_INPUT',
    MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
    INVALID_FORMAT: 'INVALID_FORMAT',
    BAD_REQUEST: 'BAD_REQUEST',

    // Authentication Errors (401)
    UNAUTHORIZED: 'UNAUTHORIZED',
    SESSION_EXPIRED: 'SESSION_EXPIRED',
    INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
    TOKEN_EXPIRED: 'TOKEN_EXPIRED',

    // Authorization Errors (403)
    FORBIDDEN: 'FORBIDDEN',
    INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
    RESOURCE_ACCESS_DENIED: 'RESOURCE_ACCESS_DENIED',

    // Not Found Errors (404)
    NOT_FOUND: 'NOT_FOUND',
    JOB_NOT_FOUND: 'JOB_NOT_FOUND',
    PIPELINE_NOT_FOUND: 'PIPELINE_NOT_FOUND',
    CREDENTIAL_NOT_FOUND: 'CREDENTIAL_NOT_FOUND',
    USER_NOT_FOUND: 'USER_NOT_FOUND',
    EXECUTION_NOT_FOUND: 'EXECUTION_NOT_FOUND',
    DOCUMENT_NOT_FOUND: 'DOCUMENT_NOT_FOUND',

    // Conflict Errors (409)
    CONFLICT: 'CONFLICT',
    DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',
    RESOURCE_IN_USE: 'RESOURCE_IN_USE',
    VERSION_CONFLICT: 'VERSION_CONFLICT',

    // Unprocessable Entity (422)
    UNPROCESSABLE_ENTITY: 'UNPROCESSABLE_ENTITY',
    SCHEMA_VALIDATION_FAILED: 'SCHEMA_VALIDATION_FAILED',

    // External Service Errors (502/503)
    EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
    AI_PROVIDER_ERROR: 'AI_PROVIDER_ERROR',
    DATABASE_ERROR: 'DATABASE_ERROR',
    VECTOR_STORE_ERROR: 'VECTOR_STORE_ERROR',

    // Execution Errors (500)
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    JOB_EXECUTION_FAILED: 'JOB_EXECUTION_FAILED',
    PIPELINE_EXECUTION_FAILED: 'PIPELINE_EXECUTION_FAILED',
    CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',

    // Rate Limiting (429)
    RATE_LIMITED: 'RATE_LIMITED',
    QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',

    // Licensing Errors (402/400/409)
    LICENSE_REQUIRED: 'LICENSE_REQUIRED',
    LICENSE_EXPIRED: 'LICENSE_EXPIRED',
    TRIAL_ALREADY_USED: 'TRIAL_ALREADY_USED',
} as const;

export type ErrorCodeType = typeof ErrorCode[keyof typeof ErrorCode];

/**
 * Standardized Error Response Format
 */
export interface ErrorResponse {
    success: false;
    error: {
        code: ErrorCodeType;
        message: string;
        details?: any;
        statusCode: number;
    };
    correlationId?: string;
    timestamp: string;
    path?: string;
}



