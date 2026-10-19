
import { Request, Response, NextFunction } from "express";
import { auditService } from "@domain/audit/index.js";
import { InsertAuditLog } from "@shared/schema/index.js";

/**
 * Extracts entity information from the request path
 * e.g. /api/pipelines/123 -> entity: pipeline, id: 123
 */
function parseResource(path: string): { type: string; id?: string } {
    const parts = path.split('/').filter(p => p && p !== 'api');

    if (parts.length > 0) {
        // Simple heuristic: First segment is type
        let type = parts[0];
        // Singularize (simple)
        if (type.endsWith('s')) type = type.slice(0, -1);

        let id = parts.length > 1 ? parts[1] : undefined;

        // Handle specific sub-actions e.g. /pipelines/123/run
        // If id is numeric or UUID-like, keep it. Else undefined.
        if (id && !/^\d+$/.test(id) && !/^[0-9a-fA-F-]{36}$/.test(id)) {
            // Maybe it wasn't an ID? e.g. /pipelines/search
            // Just best effort.
        }

        return { type, id };
    }
    return { type: 'unknown' };
}

export function auditLogger(req: Request, res: Response, next: NextFunction) {
    // Only log state-changing methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    // Capture start
    const originalSend = res.send;

    res.on('finish', () => {
        // Only log 2xx (and maybe 4xx/5xx depending on policy)
        // Usually we want to know if they *changed* something.
        // 403/401 might be security events (logged elsewhere or here).

        if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
                // Determine user
                const user = (req as any).user;
                if (!user) return; // Anonymous actions? Skip or log as system/anon

                const { type, id } = parseResource(req.path);
                const action = req.method.toUpperCase();

                const logEntry: InsertAuditLog = {
                    userId: user.id.toString(), // or email
                    organizationId: user.organizationId,
                    ipAddress: req.ip,
                    userAgent: req.get('user-agent') || undefined,
                    action,
                    entityType: type,
                    entityId: id,
                    metadata: {
                        path: req.originalUrl,
                        method: req.method,
                        statusCode: res.statusCode
                        // Body? Often too large or sensitive (passwords). Omitted by default.
                    }
                };

                auditService.log(logEntry);
            } catch (err) {
                console.error("Audit Middleware Error:", err);
            }
        }
    });

    next();
}

