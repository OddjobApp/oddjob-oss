import { ErrorCode, ErrorCodeType, ErrorResponse } from "@shared/schema/errors.js";

export { ErrorCode, type ErrorCodeType, type ErrorResponse };

/**
 * Create a standardized error response
 */
export function createErrorResponse(
    code: ErrorCodeType,
    message: string,
    statusCode: number,
    options?: {
        details?: any;
        correlationId?: string;
        path?: string;
    }
): ErrorResponse {
    return {
        success: false,
        error: {
            code,
            message,
            statusCode,
            details: options?.details,
        },
        correlationId: options?.correlationId,
        timestamp: new Date().toISOString(),
        path: options?.path,
    };
}

import {
    AppError,
    BadRequestError,
    ValidationError,
    UnauthorizedError,
    ForbiddenError,
    NotFoundError,
    ConflictError,
    InternalServerError,
    ExternalServiceError,
    RateLimitError
} from "@oddjob/shared-utils";

export {
    AppError,
    BadRequestError,
    ValidationError,
    UnauthorizedError,
    ForbiddenError,
    NotFoundError,
    ConflictError,
    InternalServerError,
    ExternalServiceError,
    RateLimitError
};

/**
 * Domain-specific errors
 */

export class JobNotFoundError extends NotFoundError {
    constructor(jobId: number | string) {
        super(`Job ${jobId} not found`, ErrorCode.JOB_NOT_FOUND, { jobId });
    }
}

export class PipelineNotFoundError extends NotFoundError {
    constructor(pipelineId: number | string) {
        super(`Pipeline ${pipelineId} not found`, ErrorCode.PIPELINE_NOT_FOUND, { pipelineId });
    }
}

export class CredentialNotFoundError extends NotFoundError {
    constructor(credentialId: number | string) {
        super(`Credential ${credentialId} not found`, ErrorCode.CREDENTIAL_NOT_FOUND, { credentialId });
    }
}

export class JobExecutionError extends AppError {
    constructor(jobId: number, message: string, details?: any) {
        super(message, 500, ErrorCode.JOB_EXECUTION_FAILED, {
            details: { jobId, ...details },
        });
    }
}

export class PipelineExecutionError extends AppError {
    constructor(pipelineId: number, executionId: number, message: string, details?: any) {
        super(message, 500, ErrorCode.PIPELINE_EXECUTION_FAILED, {
            details: { pipelineId, executionId, ...details },
        });
    }
}

export class AIProviderError extends ExternalServiceError {
    constructor(provider: string, originalError?: Error) {
        super(`AI Provider: ${provider}`, originalError, ErrorCode.AI_PROVIDER_ERROR);
    }
}

export class ConfigurationError extends AppError {
    constructor(message: string, details?: any) {
        super(message, 500, ErrorCode.CONFIGURATION_ERROR, { details });
    }
}

export class LicenseRequiredError extends AppError {
    constructor(message: string = 'A valid license or active trial is required') {
        super(message, 402, ErrorCode.LICENSE_REQUIRED);
    }
}

export class LicenseExpiredError extends AppError {
    constructor(message: string = 'License has expired') {
        super(message, 402, ErrorCode.LICENSE_EXPIRED);
    }
}

export class TrialAlreadyUsedError extends AppError {
    constructor(message: string = 'A 30-day trial has already been used on this system') {
        super(message, 409, ErrorCode.TRIAL_ALREADY_USED);
    }
}

