/**
 * HIL (Human-in-the-Loop) Knowledge Bridge
 * 
 * Captures approval patterns and decisions to the Knowledge Graph,
 * enabling organizational learning from human decisions.
 * 
 * Quick Win: Transform approval history into reusable intelligence
 */

import { db } from "@server/database_service.js";
import { approvalRequests, knowledgeNodes, knowledgeEdges, knowledgeTopics, users } from "@shared/schema/index.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { longTermMemoryService } from "@domain/agents/core/long-term-memory.service.js";
import { assertOrgId } from "@server/utils/auth-context.js";

const logger = createLogger("HILKnowledgeBridge");

export interface ApprovalPattern {
    approverId: string;
    approverEmail: string;
    jobType?: string;
    decision: 'approved' | 'rejected';
    decisionTime: number; // milliseconds to decide
    contextType: string;
    similarApprovalCount: number;
}

export const hilKnowledgeBridge = {
    /**
     * Capture an approval decision to the knowledge graph.
     * Called automatically when an approval is decided.
     */
    async captureDecision(approvalRequestId: number): Promise<{ success: boolean; patternId?: number; message?: string }> {
        try {
            // 1. Fetch the approval request with context
            const [request] = await db
                .select()
                .from(approvalRequests)
                .where(eq(approvalRequests.id, approvalRequestId))
                .limit(1);

            if (!request) {
                return { success: false, message: "Approval request not found" };
            }

            // Only capture completed decisions
            if (request.status !== 'approved' && request.status !== 'rejected') {
                return { success: false, message: "Decision not yet finalized" };
            }

            // 2. Calculate decision time
            const decisionTime = request.decisionAt && request.createdAt
                ? new Date(request.decisionAt).getTime() - new Date(request.createdAt).getTime()
                : 0;

            // 3. Find or create HIL Patterns topic
            const topicId = await this.ensureHILTopic(assertOrgId(request.organizationId));

            // 4. Extract context from the request
            const contextSnapshot = request.modifiedOutput as any;
            const contextType = this.classifyContext(contextSnapshot);

            // 5. Look for similar existing pattern
            const existingPattern = await this.findSimilarPattern(
                request.approverId || '',
                contextType,
                request.status,
                assertOrgId(request.organizationId)
            );

            if (existingPattern) {
                // 6a. Update existing pattern (increment count, update avg time)
                const currentCount = (existingPattern.data as any)?.similarApprovalCount || 1;
                const currentAvgTime = (existingPattern.data as any)?.avgDecisionTime || decisionTime;
                const newAvgTime = Math.round((currentAvgTime * currentCount + decisionTime) / (currentCount + 1));

                await db.update(knowledgeNodes)
                    .set({
                        data: {
                            ...(existingPattern.data as any),
                            similarApprovalCount: currentCount + 1,
                            avgDecisionTime: newAvgTime,
                            lastSeenAt: new Date().toISOString(),
                        },
                        updatedAt: new Date(),
                    })
                    .where(eq(knowledgeNodes.id, existingPattern.id));

                logger.info(`[HILKnowledgeBridge] Updated pattern ${existingPattern.id} (count: ${currentCount + 1})`);

                // Store to long-term memory
                await this.storeDecisionMemory(request, decisionTime, contextType);

                return { success: true, patternId: existingPattern.id, message: "Pattern updated" };
            } else {
                // 6b. Create new pattern node
                const [patternNode] = await db.insert(knowledgeNodes).values({
                    organizationId: assertOrgId(request.organizationId),
                    knowledgeTopicId: topicId,
                    label: 'HILPattern',
                    name: `Approval Pattern: ${contextType} → ${request.status}`,
                    data: {
                        approverId: request.approverId,
                        approverEmail: request.approverEmail,
                        decision: request.status,
                        contextType,
                        decisionTime,
                        similarApprovalCount: 1,
                        avgDecisionTime: decisionTime,
                        firstSeenAt: new Date().toISOString(),
                        lastSeenAt: new Date().toISOString(),
                        jobId: request.jobId,
                        executionId: request.executionId,
                    },
                    verificationStatus: request.status === 'approved' ? 'verified' : 'staging',
                }).returning();

                // Link to approver if known
                if (request.approverId) {
                    await this.linkToApprover(patternNode.id, request.approverId, assertOrgId(request.organizationId));
                }

                logger.info(`[HILKnowledgeBridge] Created new pattern ${patternNode.id}`);

                // Store to long-term memory
                await this.storeDecisionMemory(request, decisionTime, contextType);

                return { success: true, patternId: patternNode.id, message: "New pattern created" };
            }

        } catch (err: any) {
            logger.error(`[HILKnowledgeBridge] Failed to capture decision: ${err.message}`);
            return { success: false, message: err.message };
        }
    },

    /**
     * Get approval patterns for a specific approver.
     * Useful for showing "You typically approve X within Y minutes".
     */
    async getApproverPatterns(approverId: string, organizationId: number): Promise<ApprovalPattern[]> {
        try {
            const patterns = await db
                .select()
                .from(knowledgeNodes)
                .where(
                    and(
                        eq(knowledgeNodes.organizationId, organizationId),
                        eq(knowledgeNodes.label, 'HILPattern'),
                        sql`${knowledgeNodes.data}->>'approverId' = ${approverId}`
                    )
                )
                .orderBy(desc(knowledgeNodes.createdAt))
                .limit(20);

            return patterns.map(p => ({
                approverId: (p.data as any)?.approverId || '',
                approverEmail: (p.data as any)?.approverEmail || '',
                decision: (p.data as any)?.decision || 'approved',
                decisionTime: (p.data as any)?.avgDecisionTime || 0,
                contextType: (p.data as any)?.contextType || 'unknown',
                similarApprovalCount: (p.data as any)?.similarApprovalCount || 1,
                jobType: (p.data as any)?.jobType,
            }));

        } catch (err: any) {
            logger.error(`[HILKnowledgeBridge] Failed to get patterns: ${err.message}`);
            return [];
        }
    },

    /**
     * Predict approval likelihood for a new request.
     * Returns confidence score based on historical patterns.
     */
    async predictApprovalLikelihood(
        approverId: string,
        contextSnapshot: any,
        organizationId: number
    ): Promise<{ likelihood: 'high' | 'medium' | 'low'; confidence: number; avgDecisionTime: number }> {
        try {
            const contextType = this.classifyContext(contextSnapshot);

            // Find patterns for this approver + context type
            const patterns = await db
                .select()
                .from(knowledgeNodes)
                .where(
                    and(
                        eq(knowledgeNodes.organizationId, organizationId),
                        eq(knowledgeNodes.label, 'HILPattern'),
                        sql`${knowledgeNodes.data}->>'approverId' = ${approverId}`,
                        sql`${knowledgeNodes.data}->>'contextType' = ${contextType}`
                    )
                );

            if (patterns.length === 0) {
                return { likelihood: 'medium', confidence: 0.5, avgDecisionTime: 300000 }; // 5 min default
            }

            // Calculate approval rate
            const totalCount = patterns.reduce((sum, p) => sum + ((p.data as any)?.similarApprovalCount || 1), 0);
            const approvedCount = patterns
                .filter(p => (p.data as any)?.decision === 'approved')
                .reduce((sum, p) => sum + ((p.data as any)?.similarApprovalCount || 1), 0);

            const approvalRate = approvedCount / totalCount;
            const avgDecisionTime = Math.round(
                patterns.reduce((sum, p) => sum + ((p.data as any)?.avgDecisionTime || 300000), 0) / patterns.length
            );

            // Determine likelihood
            let likelihood: 'high' | 'medium' | 'low' = 'medium';
            if (approvalRate > 0.8) likelihood = 'high';
            else if (approvalRate < 0.3) likelihood = 'low';

            return {
                likelihood,
                confidence: Math.max(0.3, Math.min(0.95, totalCount / 10)), // More data = higher confidence
                avgDecisionTime,
            };

        } catch (err: any) {
            logger.error(`[HILKnowledgeBridge] Prediction failed: ${err.message}`);
            return { likelihood: 'medium', confidence: 0.5, avgDecisionTime: 300000 };
        }
    },

    /**
     * Find similar existing pattern for deduplication.
     */
    async findSimilarPattern(
        approverId: string,
        contextType: string,
        decision: string,
        organizationId: number
    ): Promise<typeof knowledgeNodes.$inferSelect | null> {
        const [existing] = await db
            .select()
            .from(knowledgeNodes)
            .where(
                and(
                    eq(knowledgeNodes.organizationId, organizationId),
                    eq(knowledgeNodes.label, 'HILPattern'),
                    sql`${knowledgeNodes.data}->>'approverId' = ${approverId}`,
                    sql`${knowledgeNodes.data}->>'contextType' = ${contextType}`,
                    sql`${knowledgeNodes.data}->>'decision' = ${decision}`
                )
            )
            .limit(1);

        return existing || null;
    },

    /**
     * Classify the context type from the approval snapshot.
     */
    classifyContext(contextSnapshot: any): string {
        if (!contextSnapshot) return 'general';

        // Check for specific context types
        if (contextSnapshot.plan?.tasks?.length > 0) return 'plan_approval';
        if (contextSnapshot.dynamicAction) return 'dynamic_action';
        if (contextSnapshot.checkpointType) return `checkpoint_${contextSnapshot.checkpointType}`;
        if (contextSnapshot.hilType) return `hil_${contextSnapshot.hilType}`;
        if (contextSnapshot.jobType) return `job_${contextSnapshot.jobType}`;

        return 'general';
    },

    /**
     * Ensure HIL Patterns topic exists.
     */
    async ensureHILTopic(organizationId: number): Promise<number> {
        const [existing] = await db
            .select({ id: knowledgeTopics.id })
            .from(knowledgeTopics)
            .where(
                and(
                    eq(knowledgeTopics.organizationId, organizationId),
                    eq(knowledgeTopics.name, 'HIL Patterns')
                )
            )
            .limit(1);

        if (existing) return existing.id;

        const [topic] = await db.insert(knowledgeTopics).values({
            organizationId,
            name: 'HIL Patterns',
            description: 'Human-in-the-Loop approval patterns and decision history',
            createdBy: 'hil-knowledge-bridge',
        }).returning();

        return topic.id;
    },

    /**
     * Link pattern to approver entity.
     */
    async linkToApprover(patternId: number, approverId: string, organizationId: number): Promise<void> {
        // Check if approver entity exists
        const [approverNode] = await db
            .select({ id: knowledgeNodes.id })
            .from(knowledgeNodes)
            .where(
                and(
                    eq(knowledgeNodes.organizationId, organizationId),
                    eq(knowledgeNodes.label, 'Person'),
                    sql`${knowledgeNodes.data}->>'userId' = ${approverId}`
                )
            )
            .limit(1);

        if (approverNode) {
            // Create relationship
            await db.insert(knowledgeEdges).values({
                sourceId: patternId,
                targetId: approverNode.id,
                relation: 'DECIDED_BY',
                data: {},
                organizationId: organizationId,
            });
        }
    },

    /**
     * Store decision to long-term memory for unified query.
     */
    async storeDecisionMemory(
        request: typeof approvalRequests.$inferSelect,
        decisionTime: number,
        contextType: string
    ): Promise<void> {
        const content = `HIL Decision: ${request.status} by ${request.approverEmail} ` +
            `for ${contextType} context ` +
            `(decision time: ${Math.round(decisionTime / 1000)}s)`;

        await longTermMemoryService.remember({
            organizationId: assertOrgId(request.organizationId),
            userId: request.approverId || undefined,
            type: 'strategy',
            content,
            key: `hil-decision-${request.id}`,
            importance: 6,
            metadata: {
                approvalRequestId: request.id,
                decision: request.status,
                contextType,
                decisionTime,
                source: 'hil_knowledge_bridge',
            },
        });
    },

    /**
     * Get all HIL patterns for an organization (admin view).
     */
    async getOrganizationPatterns(organizationId: number): Promise<any[]> {
        const patterns = await db
            .select()
            .from(knowledgeNodes)
            .where(
                and(
                    eq(knowledgeNodes.organizationId, organizationId),
                    eq(knowledgeNodes.label, 'HILPattern')
                )
            )
            .orderBy(desc(sql`(data->>'similarApprovalCount')::int`));

        return patterns.map(p => ({
            id: p.id,
            approverEmail: (p.data as any)?.approverEmail,
            decision: (p.data as any)?.decision,
            contextType: (p.data as any)?.contextType,
            count: (p.data as any)?.similarApprovalCount || 1,
            avgDecisionTime: (p.data as any)?.avgDecisionTime,
            firstSeen: (p.data as any)?.firstSeenAt,
            lastSeen: (p.data as any)?.lastSeenAt,
        }));
    },
};

export default hilKnowledgeBridge;
