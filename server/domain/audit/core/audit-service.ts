
import { db } from "@server/database_service.js";
import { auditLogs, type InsertAuditLog } from "@shared/schema/index.js";
import { desc, eq, and, sql } from "drizzle-orm";
import { Request, Response, NextFunction } from "express";
import { createLogger } from "@server/utils/logger.js";
import { extractTraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";

const logger = createLogger("Audit");

// Predefined sensitive action categories
export type AuditCategory =
    | "auth" | "data" | "admin" | "api_key"
    | "credential" | "config" | "export" | "delete" | "access" | "system";

export class AuditService {
    /**
     * Log an action to the audit log
     */
    async log(entry: InsertAuditLog): Promise<void> {
        try {
            await db.insert(auditLogs).values(entry);
        } catch (error) {
            // Internal error reporting using structured logger
            logger.error("Failed to write audit log", { 
                error: error instanceof Error ? error.message : String(error),
                action: entry.action,
                entityType: entry.entityType
            });
            
            // In high security contexts we might want to throw, but for now 
            // we prevent audit failure from breaking the business transaction.
        }
    }

    /**
     * Log from request context
     */
    async logFromRequest(
        req: Request,
        action: string,
        entityType: string,
        entityId?: string | number,
        details?: Record<string, any>
    ): Promise<void> {
        const user = req ? (req as any).user : null;
        const trace = req ? extractTraceContext(req.headers) : null;

        await this.log({
            action,
            entityType,
            entityId: entityId ? String(entityId) : "",
            userId: user?.id ? String(user.id) : "",
            organizationId: user?.organizationId,
            metadata: {
                ...details,
                ip: req?.ip,
                userAgent: req?.headers?.["user-agent"],
                method: req?.method,
                path: req?.path,
                traceId: trace?.traceId,
                spanId: trace?.spanId,
            },
        });
    }

    /**
     * Retrieve audit logs with optional filtering
     */
    async getLogs(organizationId: number, options: {
        entityType?: string;
        entityId?: string;
        userId?: string;
        limit?: number;
        offset?: number;
    } = {}) {
        const { entityType, entityId, userId, limit = 50, offset = 0 } = options;

        const filters = [eq(auditLogs.organizationId, organizationId)];

        if (entityType) filters.push(eq(auditLogs.entityType, entityType));
        if (entityId) filters.push(eq(auditLogs.entityId, entityId));
        if (userId) filters.push(eq(auditLogs.userId, userId));

        const logs = await db
            .select()
            .from(auditLogs)
            .where(and(...filters))
            .orderBy(desc(auditLogs.createdAt))
            .limit(limit)
            .offset(offset);

        // Count total
        const [countResult] = await db
            .select({ count: sql<number>`count(*)` })
            .from(auditLogs)
            .where(and(...filters));

        return {
            data: logs,
            total: Number(countResult.count),
            limit,
            offset
        };
    }
}

export const auditService = new AuditService();

// ============================================================================
// PREDEFINED AUDIT EVENTS
// ============================================================================

export const AuditEvents = {
    LOGIN_SUCCESS: (req: Request) =>
        auditService.logFromRequest(req, "login_success", "auth"),

    LOGIN_FAILURE: (req: Request, reason: string) =>
        auditService.logFromRequest(req, "login_failure", "auth", undefined, { reason }),

    CREDENTIAL_CREATED: (req: Request, id: number) =>
        auditService.logFromRequest(req, "credential_created", "credential", id),

    CREDENTIAL_DELETED: (req: Request, id: number) =>
        auditService.logFromRequest(req, "credential_deleted", "credential", id),

    API_KEY_CREATED: (req: Request, id: number) =>
        auditService.logFromRequest(req, "api_key_created", "api_key", id),

    API_KEY_REVOKED: (req: Request, id: number) =>
        auditService.logFromRequest(req, "api_key_revoked", "api_key", id),

    DATA_EXPORTED: (req: Request, type: string, count: number) =>
        auditService.logFromRequest(req, "data_exported", type, undefined, { count }),

    BULK_DELETE: (req: Request, type: string, count: number) =>
        auditService.logFromRequest(req, "bulk_delete", type, undefined, { count }),

    SKILL_INGESTED: (req: Request, skillName: string, agentId: number, jobIds: number[], collectionId?: number) =>
        auditService.logFromRequest(req, "skill_ingested", "skill", agentId, {
            skillName,
            agentId,
            jobIds,
            collectionId,
            count: jobIds.length + 1 // Agent + Jobs
        }),
};

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Auto-audit middleware for sensitive routes
 */
export function auditMiddleware(action: string, entityType: string) {
    return (req: Request, res: Response, next: NextFunction) => {
        const originalEnd = res.end.bind(res);

        res.end = function (...args: any[]) {
            if (res.statusCode < 400) {
                auditService.logFromRequest(
                    req, action, entityType, req.params.id
                ).catch(() => { });
            }
            return originalEnd(...args);
        } as any;

        next();
    };
}



