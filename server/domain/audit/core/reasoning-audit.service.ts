
import { db } from "@server/database_service.js";
import { reasoningAudits, type InsertReasoningAudit } from "@shared/schema/index.js";
import { eq, and, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ReasoningAudit");

export class ReasoningAuditService {
    /**
     * Capture a reasoning segment for auditing
     */
    async capture(missionRunId: number, traceId: string, protocol: string, rawReasoning: string, severity: number = 0): Promise<number> {
        try {
            const [audit] = await db.insert(reasoningAudits).values({
                missionRunId,
                traceId,
                reasoningProtocol: protocol as any,
                rawReasoning,
                severity,
                status: severity > 7 ? 'flagged' : 'pending' // Auto-flag high severity
            }).returning();

            logger.info(`Reasoning captured for audit: Run ${missionRunId}, Trace ${traceId}, Severity ${severity}`);
            return audit.id;
        } catch (error: any) {
            logger.error(`Failed to capture reasoning audit: ${error.message}`);
            return 0;
        }
    }

    /**
     * Update the status of an audit
     */
    async updateStatus(auditId: number, auditorId: string, status: 'safe' | 'flagged', notes?: string, violatedPolicies?: string[]): Promise<void> {
        try {
            await db.update(reasoningAudits)
                .set({
                    status,
                    auditorId,
                    auditNotes: notes,
                    violatedPolicies,
                    updatedAt: new Date()
                } as any) // updatedAt might be added to schema later if needed
                .where(eq(reasoningAudits.id, auditId));
            
            logger.info(`Audit ${auditId} status updated to ${status} by ${auditorId}`);
        } catch (error: any) {
            logger.error(`Failed to update reasoning audit status: ${error.message}`);
        }
    }

    /**
     * Get audits for a specific mission run
     */
    async getAuditsByRun(missionRunId: number) {
        return await db.select()
            .from(reasoningAudits)
            .where(eq(reasoningAudits.missionRunId, missionRunId))
            .orderBy(desc(reasoningAudits.createdAt));
    }

    /**
     * Get flagged audits across the organization
     */
    async getFlaggedAudits(limit: number = 50) {
        return await db.select()
            .from(reasoningAudits)
            .where(eq(reasoningAudits.status, 'flagged'))
            .orderBy(desc(reasoningAudits.severity), desc(reasoningAudits.createdAt))
            .limit(limit);
    }
}

export const reasoningAuditService = new ReasoningAuditService();


