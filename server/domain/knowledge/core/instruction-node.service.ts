
import { db } from "@server/database_service.js";
import { knowledgeDocuments } from "@shared/schema/knowledge-base.js";
import { eq, and, sql, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("InstructionNodeService");

export interface InstructionMetadata {
    priority: "low" | "medium" | "high" | "critical";
    status: "pending" | "processing" | "completed" | "failed";
    targetDomain?: string;
    autoExecute?: boolean;
    lastProcessedAt?: string;
    error?: string;
}

/**
 * InstructionNodeService
 * 
 * Manages persistent instruction nodes in the Knowledge Base (OpenClaw Parity).
 * These nodes act as asynchronous task queues for the agent.
 */
export const instructionNodeService = {
    /**
     * Create a new instruction node
     */
    async create(orgId: number, title: string, content: string, metadata: Partial<InstructionMetadata> = {}) {
        logger.info(`[InstructionNode] Creating instruction: ${title} for Org ${orgId}`);
        
        const fullMetadata: InstructionMetadata = {
            priority: "medium",
            status: "pending",
            autoExecute: true,
            ...metadata
        };

        const [doc] = await db.insert(knowledgeDocuments).values({
            organizationId: orgId,
            title,
            textContent: content,
            sourceType: "instruction" as any, // Extend existing types logically
            metadata: fullMetadata as any,
            createdBy: "system"
        }).returning();

        return doc;
    },

    /**
     * Get pending instructions for an organization
     */
    async getPending(orgId: number) {
        return await db.select()
            .from(knowledgeDocuments)
            .where(and(
                eq(knowledgeDocuments.organizationId, orgId),
                eq(knowledgeDocuments.sourceType, "instruction" as any),
                sql`metadata->>'status' = 'pending'`
            ))
            .orderBy(desc(knowledgeDocuments.createdAt));
    },

    /**
     * Update instruction status
     */
    async updateStatus(docId: number, status: InstructionMetadata["status"], error?: string) {
        const [doc] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, docId)).limit(1);
        if (!doc) return;

        const metadata = (doc.metadata as any) || {};
        metadata.status = status;
        metadata.lastProcessedAt = new Date().toISOString();
        if (error) metadata.error = error;

        await db.update(knowledgeDocuments)
            .set({ 
                metadata,
                updatedAt: new Date()
            })
            .where(eq(knowledgeDocuments.id, docId));
    },

    /**
     * Delete an instruction
     */
    async delete(docId: number) {
        await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, docId));
    }
};
