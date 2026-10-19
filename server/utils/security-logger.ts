import { Request } from "express";

/**
 * Shared utility for logging security-related events.
 */
export async function logSecurityEvent(
    req: Request,
    eventType: string,
    details?: Record<string, any>
) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        eventType,
        path: req.path,
        userId: (req.session as any)?.userId || 'anonymous',
        details: details || {},
    };
    console.log('[SECURITY]', JSON.stringify(logEntry));
}

