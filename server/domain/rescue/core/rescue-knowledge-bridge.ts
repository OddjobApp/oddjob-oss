/**
 * Rescue Knowledge Bridge
 * 
 * Captures successful rescue patterns to the Knowledge Graph,
 * enabling self-improving organizational troubleshooting memory.
 * 
 * Quick Win: When rescues complete successfully, the recovery
 * strategy is captured as a knowledge node for future retrieval.
 */

import { db } from "@server/database_service.js";
import { rescueSessions, rescueEvents } from "@shared/schema/rescue.js";
import { knowledgeNodes, knowledgeTopics } from "@shared/schema/index.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { assertOrgId, getSystemOrgContext } from "@server/utils/auth-context.js";

const logger = createLogger("RescueKnowledgeBridge");

export interface RescuePattern {
    problemType: string;
    failureContext: string;
    recoveryStrategy: string;
    successProbability: number;
    missionId?: number;
    missionRunId?: number;
    sessionId: number;
}

export const rescueKnowledgeBridge = {
    /**
     * Capture a successful rescue pattern to the Knowledge Graph.
     * Called when a rescue session reaches terminal success state.
     */
    async captureSuccessPattern(sessionId: number): Promise<{ success: boolean; nodeId?: number; message?: string }> {
        try {
            // 1. Get rescue session details
            const [session] = await db
                .select()
                .from(rescueSessions)
                .where(eq(rescueSessions.id, sessionId))
                .limit(1);

            if (!session) {
                return { success: false, message: "Rescue session not found" };
            }

            // Only capture patterns from successful resolutions
            if (session.status !== 'COMPLETED') {
                return { success: false, message: `Session status ${session.status} is not a success state` };
            }

            // 2. Get recovery events from the session
            const events = await db
                .select()
                .from(rescueEvents)
                .where(eq(rescueEvents.sessionId, sessionId))
                .orderBy(desc(rescueEvents.createdAt));

            // 3. Get recovery options that were applied
            const recoveryOptions = (session.recoveryOptions as any[]) || [];
            const appliedOption = events.find(e => e.eventType === 'RECOVERY_OPTION_APPLIED');
            
            if (!appliedOption && recoveryOptions.length === 0) {
                return { success: false, message: "No recovery strategy was applied" };
            }

            // 4. Extract pattern details
            const problemType = this.inferProblemType(session, events);
            const failureContext = this.extractFailureContext(session, events);
            const recoveryStrategy = this.extractRecoveryStrategy(appliedOption, recoveryOptions, session);
            
            // 5. Check if similar pattern already exists
            const existingPattern = await this.findSimilarPattern(
                assertOrgId(session.organizationId),
                problemType,
                recoveryStrategy
            );

            if (existingPattern) {
                // Update success count on existing pattern
                await this.updatePatternSuccess(existingPattern.id);
                return { success: true, nodeId: existingPattern.id, message: "Updated existing pattern success count" };
            }

            // 6. Create knowledge graph node
            const orgContext = getSystemOrgContext(assertOrgId(session.organizationId));
            
            // Ensure rescue patterns topic exists
            const topicId = await this.ensureRescueTopic(assertOrgId(orgContext.organizationId));
            
            const [node] = await db.insert(knowledgeNodes).values({
                organizationId: assertOrgId(orgContext.organizationId),
                knowledgeTopicId: topicId,
                label: 'RescuePattern',
                name: `Pattern: ${problemType} → ${recoveryStrategy.substring(0, 50)}`,
                data: {
                    problemType,
                    failureContext,
                    recoveryStrategy,
                    successCount: 1,
                    sessionId,
                    missionId: session.missionId,
                    missionRunId: session.missionRunId,
                    capturedAt: new Date().toISOString(),
                    triageSummary: session.triageSummary,
                    originalServiceType: session.serviceType,
                },
                verificationStatus: 'verified', // Rescue patterns are verified by success
            }).returning();

            logger.info(`[RescueKnowledgeBridge] Captured success pattern ${node.id} from session ${sessionId}`);

            // 7. Link to mission if exists
            if (session.missionRunId && session.missionId) {
                await this.linkToMission(node.id, session.missionId, session.missionRunId);
            }

            return { success: true, nodeId: node.id, message: "New pattern captured to knowledge graph" };

        } catch (err: any) {
            logger.error(`[RescueKnowledgeBridge] Failed to capture pattern: ${err.message}`);
            return { success: false, message: err.message };
        }
    },

    /**
     * Find similar existing patterns to avoid duplicates.
     */
    async findSimilarPattern(organizationId: number, problemType: string, strategy: string): Promise<{ id: number } | null> {
        const [existing] = await db
            .select({ id: knowledgeNodes.id })
            .from(knowledgeNodes)
            .where(
                and(
                    eq(knowledgeNodes.organizationId, organizationId),
                    eq(knowledgeNodes.label, 'RescuePattern'),
                    sql`${knowledgeNodes.data}->>'problemType' = ${problemType}`,
                    sql`${knowledgeNodes.data}->>'recoveryStrategy' = ${strategy}`
                )
            )
            .limit(1);
        
        return existing || null;
    },

    /**
     * Update success count on existing pattern.
     */
    async updatePatternSuccess(nodeId: number): Promise<void> {
        await db.execute(sql`
            UPDATE knowledge_nodes 
            SET data = data || jsonb_build_object(
                'successCount', COALESCE((data->>'successCount')::int, 0) + 1,
                'lastSuccessAt', ${new Date().toISOString()}
            )
            WHERE id = ${nodeId}
        `);
        
        logger.info(`[RescueKnowledgeBridge] Updated success count for pattern ${nodeId}`);
    },

    /**
     * Ensure "Rescue Patterns" knowledge topic exists.
     */
    async ensureRescueTopic(organizationId: number): Promise<number> {
        const [existing] = await db
            .select({ id: knowledgeTopics.id })
            .from(knowledgeTopics)
            .where(
                and(
                    eq(knowledgeTopics.organizationId, organizationId),
                    eq(knowledgeTopics.name, 'Rescue Patterns')
                )
            )
            .limit(1);

        if (existing) {
            return existing.id;
        }

        const [topic] = await db.insert(knowledgeTopics).values({
            organizationId,
            name: 'Rescue Patterns',
            description: 'Successful rescue and recovery strategies captured from mission rescues',
            createdBy: 'rescue-knowledge-bridge',
        }).returning();

        return topic.id;
    },

    /**
     * Link rescue pattern to mission for traceability.
     */
    async linkToMission(nodeId: number, missionId: number, missionRunId: number): Promise<void> {
        // Store link in node data
        await db.execute(sql`
            UPDATE knowledge_nodes 
            SET data = data || jsonb_build_object(
                'linkedMissionId', ${missionId},
                'linkedMissionRunId', ${missionRunId}
            )
            WHERE id = ${nodeId}
        `);
    },

    /**
     * Infer problem type from session and events.
     */
    inferProblemType(session: typeof rescueSessions.$inferSelect, events: any[]): string {
        // Use triage summary if available
        if (session.triageSummary) {
            return session.triageSummary.substring(0, 100);
        }

        // Use first error event
        const errorEvent = events.find(e => 
            e.eventType.includes('ERROR') || 
            e.eventType.includes('FAILURE')
        );
        
        if (errorEvent?.details?.error) {
            return errorEvent.details.error.substring(0, 100);
        }

        // Fallback to service type
        return `${session.serviceType} failure`;
    },

    /**
     * Extract failure context from session.
     */
    extractFailureContext(session: typeof rescueSessions.$inferSelect, events: any[]): string {
        const contextParts: string[] = [];

        if ((session.metadata as any)?.failureReason) {
            contextParts.push((session.metadata as any).failureReason);
        }

        const statusChange = events.find(e => e.eventType === 'STATUS_CHANGE');
        if (statusChange?.previousStatus) {
            contextParts.push(`Transition from ${statusChange.previousStatus}`);
        }

        return contextParts.join('; ') || 'Unknown failure context';
    },

    /**
     * Extract recovery strategy from events and options.
     */
    extractRecoveryStrategy(appliedEvent: any, options: any[], session: typeof rescueSessions.$inferSelect): string {
        if (appliedEvent?.details?.optionId) {
            const option = options.find(o => o.id === appliedEvent.details.optionId);
            if (option) {
                return `${option.label}: ${option.description}`;
            }
        }

        if (appliedEvent?.details?.label) {
            return appliedEvent.details.label;
        }

        // Use final status as indicator of resolution
        return `Resolved via ${session.status}`;
    },

    /**
     * Search for relevant rescue patterns when a new rescue is initiated.
     */
    async findRelevantPatterns(
        organizationId: number, 
        problemDescription: string,
        limit: number = 3
    ): Promise<any[]> {
        // Search by problem type similarity
        const patterns = await db
            .select({
                id: knowledgeNodes.id,
                name: knowledgeNodes.name,
                data: knowledgeNodes.data,
                createdAt: knowledgeNodes.createdAt,
            })
            .from(knowledgeNodes)
            .where(
                and(
                    eq(knowledgeNodes.organizationId, organizationId),
                    eq(knowledgeNodes.label, 'RescuePattern'),
                    sql`${knowledgeNodes.data}->>'problemType' ILIKE ${'%' + problemDescription + '%'}`
                )
            )
            .orderBy(desc(sql`(data->>'successCount')::int`))
            .limit(limit);

        return patterns.map(p => ({
            id: p.id,
            problemType: (p.data as any)?.problemType,
            recoveryStrategy: (p.data as any)?.recoveryStrategy,
            successCount: (p.data as any)?.successCount || 1,
            capturedAt: (p.data as any)?.capturedAt,
        }));
    }
};

export default rescueKnowledgeBridge;
