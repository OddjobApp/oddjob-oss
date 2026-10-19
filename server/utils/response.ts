/**
 * Standardized API Response Utilities
 * Ensure consistent response envelopes for all API endpoints.
 */

export interface ApiResponse<T = any> {
    success: true;
    data: T;
    meta: {
        timestamp: string;
        correlationId?: string;
        [key: string]: any;
    };
}

/**
 * Create a standardized success response envelope
 */
export function createSuccessResponse<T>(
    data: T,
    options?: {
        correlationId?: string;
        meta?: Record<string, any>;
    }
): ApiResponse<T> {
    return {
        success: true,
        data,
        meta: {
            timestamp: new Date().toISOString(),
            correlationId: options?.correlationId,
            ...options?.meta,
        },
    };
}

