/**
 * Mission Knowledge Bridge
 * 
 * Full bidirectional sync between Mission system and Knowledge Graph:
 * - Mission outcomes → Knowledge Graph (entities, facts, relationships)
 * - Knowledge Graph → Mission context (relevant prior learnings)
 * 
 * Hard Feature: Comprehensive bidirectional integration
 */

import { db } from "@server/database_service.js";
import { missionRuns, missions, missionDeliverables, jobCollections, datasets } from "@shared/schema/index.js";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { assertOrgId, getSystemOrgContext } from "@server/utils/auth-context.js";
import { knowledgeService } from "@domain/knowledge/core/knowledge.service.js";
import { longTermMemoryService } from "@domain/agents/core/long-term-memory.service.js";
import { graphService } from "@domain/knowledge/core/graph/graph-service.js";
import { topicService } from "@domain/knowledge/core/topic-service.js";

const logger = createLogger("MissionKnowledgeBridge");

export interface MissionLearning {
    missionId: number;
    missionRunId: number;
    organizationId: number;
    objective: string;
    outcome: 'success' | 'partial' | 'failure';
    keyEntities: Array<{ name: string; type: string; data: any }>;
    keyFacts: string[];
    lessonsLearned: string[];
    artifacts: any[];
}

export const missionKnowledgeBridge = {
    // =========================================================================
    // MISSION → KNOWLEDGE GRAPH (Capture outcomes)
    // =========================================================================

    /**
     * Capture a completed mission's learnings to the Knowledge Graph.
     * Called when a mission reaches terminal state.
     */
    async captureMissionLearning(missionRunId: number): Promise<{ success: boolean; nodeIds?: number[]; message?: string }> {
        try {
            // 1. Get mission run with mission details
            const [run] = await db
                .select({
                    id: missionRuns.id,
                    missionId: missionRuns.missionId,
                    status: missionRuns.status,
                    missionContext: missionRuns.missionContext,
                    blackboard: missions.blackboard,
                    organizationId: missions.organizationId,
                })
                .from(missionRuns)
                .innerJoin(missions, eq(missionRuns.missionId, missions.id))
                .where(eq(missionRuns.id, missionRunId))
                .limit(1);

            if (!run) {
                return { success: false, message: "Mission run not found" };
            }

            // Only capture from terminal states
            if (!['completed', 'failed', 'cancelled'].includes(run.status || '')) {
                return { success: false, message: `Mission status ${run.status} is not terminal` };
            }

            const mission = await db
                .select()
                .from(missions)
                .where(eq(missions.id, run.missionId!))
                .limit(1)
                .then(rows => rows[0]);

            if (!mission) {
                return { success: false, message: "Mission not found" };
            }

            const orgId = assertOrgId(run.organizationId);
            const orgContext = getSystemOrgContext(orgId);
            const createdNodes: number[] = [];

            // 2. Create Mission Topic if needed
            const topicId = await this.ensureMissionTopic(orgId);

            // 3. Capture mission as knowledge node
            const outcome = this.determineOutcome(run.status || '', run.blackboard as any);
            const missionNode = await graphService.createNode({
                knowledgeTopicId: topicId,
                label: 'MissionOutcome',
                name: `${outcome === 'success' ? '✓' : '✗'} ${mission.objective?.substring(0, 80)}`,
                properties: {
                    missionId: mission.id,
                    missionRunId,
                    objective: mission.objective,
                    outcome,
                    strategy: mission.executionStrategy,
                    blackboardSummary: this.summarizeBlackboard(run.blackboard as any),
                    completedAt: new Date().toISOString(),
                    orgId,
                },
                verificationStatus: outcome === 'success' ? 'verified' : 'staging',
            }, orgContext);

            createdNodes.push(missionNode.id);

            // 4. Capture entities discovered/created during mission
            const entities = await this.extractEntities(run);
            for (const entity of entities) {
                const entityNode = await graphService.createNode({
                    knowledgeTopicId: topicId,
                    label: entity.type,
                    name: entity.name,
                    properties: {
                        ...entity.data,
                        discoveredInMission: mission.id,
                        discoveredAt: new Date().toISOString(),
                    },
                    verificationStatus: 'verified',
                }, orgContext);

                createdNodes.push(entityNode.id);

                // Create relationship to mission
                await graphService.createEdge({
                    sourceNodeId: missionNode.id,
                    targetNodeId: entityNode.id,
                    relation: 'DISCOVERED',
                    properties: { confidence: 1.0 },
                }, orgContext);
            }

            // 5. Capture deliverables/artifacts
            const deliverables = await db
                .select()
                .from(missionDeliverables)
                .where(eq(missionDeliverables.missionId, mission.id));

            for (const deliverable of deliverables) {
                const artifactNode = await graphService.createNode({
                    knowledgeTopicId: topicId,
                    label: 'Artifact',
                    name: deliverable.name,
                    properties: {
                        type: deliverable.type,
                        content: (deliverable.content as string)?.substring(0, 1000),
                        metadata: deliverable.metadata as any,
                        missionId: mission.id,
                        createdAt: deliverable.createdAt?.toISOString(),
                    },
                    verificationStatus: 'verified',
                }, orgContext);

                createdNodes.push(artifactNode.id);

                await graphService.createEdge({
                    sourceNodeId: missionNode.id,
                    targetNodeId: artifactNode.id,
                    relation: 'PRODUCED',
                    properties: {},
                }, orgContext);
            }

            // 5b. Auto-populate Smart Collection & Dataset linked to Mission and Cycle
            try {
                const cycleId = (mission as any).cycleId || (run as any).cycleId || null;
                const [existingCollection] = await db
                    .select()
                    .from(jobCollections)
                    .where(eq(jobCollections.missionId, mission.id))
                    .limit(1);

                if (!existingCollection) {
                    await db.insert(jobCollections).values({
                        name: `Mission #${mission.id} Output Collection (${mission.objective?.substring(0, 40) || 'Deliverables'})`,
                        description: `Auto-populated collection from Mission #${mission.id} execution run #${missionRunId}.`,
                        organizationId: orgId,
                        createdBy: "system",
                        missionId: mission.id,
                        cycleId: cycleId,
                        isSmart: 1,
                        tags: ["auto-populated", `mission-${mission.id}`, cycleId ? `cycle-${cycleId}` : "standalone"],
                    });
                }

                if (deliverables.length > 0) {
                    const [existingDataset] = await db
                        .select()
                        .from(datasets)
                        .where(eq(datasets.missionId, mission.id))
                        .limit(1);

                    if (!existingDataset) {
                        await db.insert(datasets).values({
                            name: `Mission #${mission.id} Deliverables Dataset`,
                            description: `Structured dataset generated by Mission #${mission.id} run #${missionRunId}.`,
                            organizationId: orgId,
                            missionId: mission.id,
                            cycleId: cycleId,
                            tags: ["mission-output", `mission-${mission.id}`],
                            schemaMapping: { deliverablesCount: deliverables.length, types: deliverables.map(d => d.type) },
                        });
                    }
                }
            } catch (collErr: any) {
                logger.warn(`Failed auto-populating collection for mission #${mission.id}: ${collErr.message}`);
            }

            // 6. Extract and store key facts as long-term memory
            const facts = this.extractFacts(run, mission);
            for (const fact of facts) {
                await longTermMemoryService.remember({
                    organizationId: orgId,
                    type: 'fact',
                    content: fact,
                    key: `mission-${mission.id}-fact`,
                    importance: 7,
                    metadata: {
                        missionId: mission.id,
                        missionRunId,
                        source: 'mission_outcome',
                    },
                });
            }

            // 7. Capture lessons learned
            const lessons = this.extractLessons(run, mission, outcome);
            for (const lesson of lessons) {
                await longTermMemoryService.remember({
                    organizationId: orgId,
                    type: 'strategy',
                    content: lesson,
                    key: `mission-${mission.id}-lesson`,
                    importance: 8,
                    metadata: {
                        missionId: mission.id,
                        missionRunId,
                        outcome,
                        source: 'mission_lesson',
                    },
                });
            }

            logger.info(`[MissionKnowledgeBridge] Captured mission ${missionRunId} learning as nodes [${createdNodes.join(', ')}]`);

            // 8. Mark mission run as knowledge-synced
            if (typeof (db as any).update === "function") {
                try {
                    const currentContext = (run.missionContext as Record<string, any>) || {};
                    await db
                        .update(missionRuns)
                        .set({
                            missionContext: {
                                ...currentContext,
                                knowledgeSynced: true,
                                knowledgeSyncedAt: new Date().toISOString(),
                                knowledgeNodeIds: createdNodes,
                            },
                        })
                        .where(eq(missionRuns.id, missionRunId));
                } catch (updateErr: any) {
                    logger.warn(`[MissionKnowledgeBridge] Failed to set knowledgeSynced flag on run ${missionRunId}: ${updateErr.message}`);
                }
            }

            return {
                success: true,
                nodeIds: createdNodes,
                message: `Created ${createdNodes.length} knowledge nodes from mission`,
            };

        } catch (err: any) {
            logger.error(`[MissionKnowledgeBridge] Failed to capture mission learning: ${err.message}`);
            return { success: false, message: err.message };
        }
    },

    // =========================================================================
    // KNOWLEDGE GRAPH → MISSION (Enrich context)
    // =========================================================================

    /**
     * Enrich mission context with relevant prior knowledge before starting.
     * Called when a new mission run is created.
     */
    async enrichMissionContext(
        missionId: number,
        objective: string,
        organizationId: number
    ): Promise<{ 
        relevantMissions: any[]; 
        keyFacts: string[]; 
        suggestedStrategies: string[];
        entities: any[];
    }> {
        try {
            const orgContext = getSystemOrgContext(organizationId);

            // 1. Search for similar past missions
            const similarMissions = await this.findSimilarMissions(organizationId, objective);

            // 2. Get key facts from long-term memory
            const memoryContext = await longTermMemoryService.getContextString(
                organizationId,
                undefined,
                objective
            );

            // 3. Search knowledge graph for relevant entities
            const relevantEntities = await knowledgeService.searchNodes(orgContext, {
                query: objective,
                limit: 5,
            });

            // 4. Extract strategies from successful similar missions
            const strategies = similarMissions
                .filter(m => m.outcome === 'success')
                .map(m => m.strategy)
                .filter(Boolean);

            return {
                relevantMissions: similarMissions.slice(0, 3),
                keyFacts: memoryContext ? [memoryContext] : [],
                suggestedStrategies: [...new Set(strategies)],
                entities: relevantEntities.map(e => ({
                    id: e.id,
                    name: e.name,
                    type: e.label,
                })),
            };

        } catch (err: any) {
            logger.error(`[MissionKnowledgeBridge] Failed to enrich context: ${err.message}`);
            return {
                relevantMissions: [],
                keyFacts: [],
                suggestedStrategies: [],
                entities: [],
            };
        }
    },

    /**
     * Find missions similar to the current objective.
     */
    async findSimilarMissions(organizationId: number, objective: string): Promise<any[]> {
        // Search by objective similarity in knowledge nodes
        const { nodes } = await graphService.searchNodes(getSystemOrgContext(organizationId), {
            label: 'MissionOutcome',
            query: objective.split(' ').slice(0, 3).join(' '),
            limit: 10
        });

        return nodes.map(n => ({
            id: n.id,
            missionId: (n.data as any)?.missionId,
            missionRunId: (n.data as any)?.missionRunId,
            objective: (n.data as any)?.objective,
            outcome: (n.data as any)?.outcome,
            strategy: (n.data as any)?.strategy,
        }));
    },

    // =========================================================================
    // HELPERS
    // =========================================================================

    determineOutcome(status: string, blackboard: any): 'success' | 'partial' | 'failure' {
        if (status === 'completed') return 'success';
        if (status === 'failed') return 'failure';
        if (blackboard?.progress > 50) return 'partial';
        return 'failure';
    },

    async ensureMissionTopic(organizationId: number): Promise<number> {
        const topics = await topicService.listTopics(getSystemOrgContext(organizationId));
        const existing = topics.find(t => t.name === 'Mission Outcomes');
        if (existing) return existing.id;

        const topic = await topicService.createTopic({
            name: 'Mission Outcomes',
            description: 'Learnings and outcomes from completed missions',
        }, getSystemOrgContext(organizationId));

        return topic.id;
    },

    summarizeBlackboard(blackboard: any): string {
        if (!blackboard) return '';
        
        const parts: string[] = [];
        if (blackboard.progress !== undefined) {
            parts.push(`Progress: ${blackboard.progress}%`);
        }
        if (blackboard.phase) {
            parts.push(`Final phase: ${blackboard.phase}`);
        }
        
        return parts.join(', ');
    },

    extractEntities(run: any): Array<{ name: string; type: string; data: any }> {
        const entities: Array<{ name: string; type: string; data: any }> = [];
        const context = run.missionContext as any;
        
        // Extract apps created during mission
        if (context?.appId) {
            entities.push({
                name: `App ${context.appId}`,
                type: 'Application',
                data: { appId: context.appId, slug: context.appSlug },
            });
        }

        // Extract datasets modified
        if (context?.datasetId) {
            entities.push({
                name: `Dataset ${context.datasetId}`,
                type: 'Dataset',
                data: { datasetId: context.datasetId },
            });
        }

        // Extract pipelines triggered
        if (context?.pipelineId) {
            entities.push({
                name: `Pipeline ${context.pipelineId}`,
                type: 'Pipeline',
                data: { pipelineId: context.pipelineId },
            });
        }

        return entities;
    },

    extractFacts(run: any, mission: any): string[] {
        const facts: string[] = [];
        const blackboard = run.blackboard as any;

        // Extract facts from blackboard decisions
        if (blackboard?.decisions) {
            for (const decision of blackboard.decisions) {
                facts.push(`Decision: ${decision.action} - ${decision.result}`);
            }
        }

        // Extract from mission objective completion
        if (run.status === 'completed') {
            facts.push(`Successfully completed: ${mission.objective}`);
        }

        return facts;
    },

    extractLessons(run: any, mission: any, outcome: string): string[] {
        const lessons: string[] = [];
        const blackboard = run.blackboard as any;

        if (outcome === 'success') {
            // Capture successful strategies
            if (mission.executionStrategy) {
                lessons.push(`Strategy "${mission.executionStrategy}" was effective for this type of objective`);
            }
        }

        if (outcome === 'failure' && blackboard?.errors) {
            // Capture failure patterns
            for (const error of blackboard.errors.slice(0, 3)) {
                lessons.push(`Avoid: ${error.message || error}`);
            }
        }

        return lessons;
    },

    // =========================================================================
    // SYNC OPERATIONS
    // =========================================================================

    /**
     * Full sync: Capture all unprocessed mission runs to knowledge graph.
     * Can be run periodically or on-demand.
     */
    async syncAllCompletedMissions(organizationId?: number): Promise<{ processed: number; errors: number }> {
        const conditions: any[] = [
            inArray(missionRuns.status, ['completed', 'failed']),
            sql`(${missionRuns.missionContext}->>'knowledgeSynced') IS NULL OR (${missionRuns.missionContext}->>'knowledgeSynced') != 'true'`,
        ];

        if (organizationId) {
            conditions.push(eq(missions.organizationId, organizationId));
        }

        // Find missions not yet in knowledge graph
        const runs = await db
            .select({
                id: missionRuns.id,
            })
            .from(missionRuns)
            .innerJoin(missions, eq(missionRuns.missionId, missions.id))
            .where(and(...conditions))
            .limit(100);

        let processed = 0;
        let errors = 0;

        for (const run of runs) {
            const result = await this.captureMissionLearning(run.id);
            if (result.success) {
                processed++;
            } else {
                errors++;
            }
        }

        logger.info(`[MissionKnowledgeBridge] Synced ${processed} missions, ${errors} errors`);
        return { processed, errors };
    },
};

export default missionKnowledgeBridge;
