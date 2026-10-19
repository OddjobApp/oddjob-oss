/**
 * Unified Memory Service
 * 
 * Fuses Long-Term Memory and Knowledge Graph into a single organizational
 * memory system with bidirectional sync.
 * 
 * Hard Feature: Unified Organizational Memory
 */

import { db } from "@server/database_service.js";
import { agentLongTermMemories } from "@shared/schema/index.js";
import { knowledgeNodes, knowledgeEdges, knowledgeTopics } from "@shared/schema/index.js";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { getSystemOrgContext } from "@server/utils/auth-context.js";
import { longTermMemoryService } from "./long-term-memory.service.js";
import { knowledgeService } from "@domain/knowledge/core/knowledge.service.js";
import { graphService } from "@domain/knowledge/core/graph/graph-service.js";
import { topicService } from "@domain/knowledge/core/topic-service.js";

const logger = createLogger("UnifiedMemory");

export interface UnifiedMemoryQuery {
    organizationId: number;
    userId?: string;
    search?: string;
    type?: 'fact' | 'preference' | 'entity' | 'strategy' | 'all';
    includeGraph?: boolean;
    includeMemories?: boolean;
    limit?: number;
}

export interface MemoryFusionResult {
    memories: any[];
    graphNodes: any[];
    relationships: any[];
    consolidated: any[]; // Merged view
}

export const unifiedMemoryService = {
    // =========================================================================
    // BIDIRECTIONAL SYNC
    // =========================================================================

    /**
     * Sync a long-term memory entry to the Knowledge Graph.
     * High-importance memories become knowledge nodes.
     */
    async syncMemoryToGraph(memoryId: number): Promise<{ success: boolean; nodeId?: number; message?: string }> {
        try {
            const [memory] = await db
                .select()
                .from(agentLongTermMemories)
                .where(eq(agentLongTermMemories.id, memoryId))
                .limit(1);

            if (!memory) {
                return { success: false, message: "Memory not found" };
            }

            if (!memory.organizationId) {
                return { success: false, message: "Memory has no organization ID" };
            }

            // Only high-importance memories become graph nodes
            if ((memory.importance || 5) < 7) {
                return { success: false, message: "Memory importance too low for graph sync" };
            }

            // Determine node label based on memory type
            const label = this.memoryTypeToLabel(memory.type);

            // Check if already synced
            const { nodes } = await graphService.searchNodes(getSystemOrgContext(memory.organizationId), {
                query: `"memoryId": ${memory.id}`,
                limit: 1
            });
            const existing = nodes[0];

            if (existing) {
                // Update existing node
                await graphService.updateNode(existing.id, {
                    name: memory.key || memory.content.substring(0, 100),
                    properties: {
                        content: memory.content,
                        updatedAt: new Date().toISOString(),
                        importance: memory.importance
                    }
                }, getSystemOrgContext(memory.organizationId));
                return { success: true, nodeId: existing.id, message: "Updated existing graph node" };
            }

            // Create topic for unified memory if needed
            const topicId = await this.ensureUnifiedMemoryTopic(memory.organizationId!);

            // Create new knowledge node
            const node = await graphService.createNode({
                knowledgeTopicId: topicId,
                label,
                name: memory.key || memory.content.substring(0, 100),
                properties: {
                    content: memory.content,
                    memoryId: memory.id,
                    memoryType: memory.type,
                    userId: memory.userId,
                    importance: memory.importance,
                    metadata: memory.metadata as any,
                    syncedAt: new Date().toISOString(),
                },
                verificationStatus: 'verified',
            }, getSystemOrgContext(memory.organizationId!));

            // Link memory to node
            await db.execute(sql`
                UPDATE agent_long_term_memories 
                SET metadata = metadata || jsonb_build_object('knowledgeNodeId', ${node.id})
                WHERE id = ${memory.id}
            `);

            logger.info(`[UnifiedMemory] Synced memory ${memoryId} to graph node ${node.id}`);

            return { success: true, nodeId: node.id, message: "Created new graph node from memory" };

        } catch (err: any) {
            logger.error(`[UnifiedMemory] Failed to sync memory to graph: ${err.message}`);
            return { success: false, message: err.message };
        }
    },

    /**
     * Sync a knowledge node to long-term memory.
     * Verified knowledge becomes agent memory for faster retrieval.
     */
    async syncNodeToMemory(nodeId: number, organizationId: number): Promise<{ success: boolean; memoryId?: number; message?: string }> {
        try {
            const nodes = await graphService.getNodesByIds([nodeId], getSystemOrgContext(organizationId));
            const node = nodes[0];

            if (!node) {
                return { success: false, message: "Knowledge node not found" };
            }

            // Only verified nodes become memories
            if (node.verificationStatus !== 'verified') {
                return { success: false, message: "Node must be verified to sync to memory" };
            }

            const nodeData = node.data as any;

            // Check if already synced
            if (nodeData?.memoryId) {
                return { success: false, message: "Node already synced to memory" };
            }

            // Determine memory type from node label
            const memoryType = this.labelToMemoryType(node.label);

            // Create memory entry
            const [memory] = await db.insert(agentLongTermMemories).values({
                organizationId: node.organizationId,
                userId: nodeData?.userId,
                type: memoryType,
                key: node.name,
                content: nodeData?.content || node.name,
                importance: 8, // Graph-verified facts are high importance
                metadata: {
                    knowledgeNodeId: node.id,
                    nodeLabel: node.label,
                    syncedAt: new Date().toISOString(),
                },
            }).returning();

            // Update node with memory reference
            await graphService.updateNode(node.id, {
                properties: { memoryId: memory.id }
            }, getSystemOrgContext(organizationId));

            logger.info(`[UnifiedMemory] Synced node ${nodeId} to memory ${memory.id}`);

            return { success: true, memoryId: memory.id, message: "Created memory from graph node" };

        } catch (err: any) {
            logger.error(`[UnifiedMemory] Failed to sync node to memory: ${err.message}`);
            return { success: false, message: err.message };
        }
    },

    /**
     * Full bidirectional sync for an organization.
     * Syncs high-importance memories to graph and verified nodes to memory.
     */
    async syncOrganization(organizationId: number): Promise<{ 
        memoriesToGraph: number; 
        nodesToMemory: number; 
        errors: number;
    }> {
        try {
            let memoriesToGraph = 0;
            let nodesToMemory = 0;
            let errors = 0;

            // 1. Sync high-importance memories to graph
            const highImportanceMemories = await db
                .select({ id: agentLongTermMemories.id })
                .from(agentLongTermMemories)
                .where(
                    and(
                        eq(agentLongTermMemories.organizationId, organizationId),
                        sql`${agentLongTermMemories.importance} >= 7`
                    )
                );

            for (const mem of highImportanceMemories) {
                const result = await this.syncMemoryToGraph(mem.id);
                if (result.success) {
                    memoriesToGraph++;
                } else if (!result.message?.includes('too low') && !result.message?.includes('already synced')) {
                    errors++;
                }
            }

            // 2. Sync verified knowledge nodes to memory
            const { nodes } = await graphService.searchNodes(getSystemOrgContext(organizationId), {
                limit: 100
            });
            const verifiedNodes = nodes.filter((n: any) => n.verificationStatus === 'verified' && !(n.data as any)?.memoryId);

            for (const node of verifiedNodes.slice(0, 50)) { // Limit to prevent overload
                const result = await this.syncNodeToMemory(node.id, organizationId);
                if (result.success) {
                    nodesToMemory++;
                } else if (!result.message?.includes('already synced')) {
                    errors++;
                }
            }

            logger.info(`[UnifiedMemory] Organization ${organizationId} sync: ${memoriesToGraph} memories→graph, ${nodesToMemory} nodes→memory`);

            return { memoriesToGraph, nodesToMemory, errors };

        } catch (err: any) {
            logger.error(`[UnifiedMemory] Organization sync failed: ${err.message}`);
            return { memoriesToGraph: 0, nodesToMemory: 0, errors: 1 };
        }
    },

    // =========================================================================
    // UNIFIED QUERY
    // =========================================================================

    /**
     * Query unified memory - both memories and knowledge graph.
     * Returns consolidated results from both systems.
     */
    async queryUnified(query: UnifiedMemoryQuery): Promise<MemoryFusionResult> {
        const {
            organizationId,
            userId,
            search,
            type = 'all',
            includeGraph = true,
            includeMemories = true,
            limit = 10,
        } = query;

        const result: MemoryFusionResult = {
            memories: [],
            graphNodes: [],
            relationships: [],
            consolidated: [],
        };

        try {
            // 1. Query long-term memories
            if (includeMemories) {
                result.memories = await longTermMemoryService.recall({
                    organizationId,
                    userId,
                    search,
                    type: type === 'all' ? undefined : type,
                    limit,
                });
            }

            // 2. Query knowledge graph
            if (includeGraph) {
                const orgContext = getSystemOrgContext(organizationId);
                result.graphNodes = await knowledgeService.searchNodes(orgContext, {
                    query: search,
                    limit,
                });
            }

            // 3. Get relationships if we have graph nodes
            if (result.graphNodes.length > 0) {
                const nodeIds = result.graphNodes.map(n => n.id);
                const edges = await graphService.getNodeEdgesBatch(nodeIds, getSystemOrgContext(organizationId), "outgoing");
                result.relationships = edges.slice(0, 20);
            }

            // 4. Consolidate results
            result.consolidated = this.consolidateResults(
                result.memories,
                result.graphNodes,
                limit
            );

            return result;

        } catch (err: any) {
            logger.error(`[UnifiedMemory] Query failed: ${err.message}`);
            return result;
        }
    },

    /**
     * Get formatted context string for LLM from unified memory.
     * This is the primary interface for agents to access organizational memory.
     */
    async getUnifiedContext(
        organizationId: number,
        userId: string | undefined,
        query: string,
        options: {
            includeGraph?: boolean;
            maxMemories?: number;
            maxGraphNodes?: number;
        } = {}
    ): Promise<string> {
        const {
            includeGraph = true,
            maxMemories = 5,
            maxGraphNodes = 5,
        } = options;

        try {
            const parts: string[] = [];

            // Get unified memory
            const unified = await this.queryUnified({
                organizationId,
                userId,
                search: query,
                includeGraph,
                includeMemories: true,
                limit: Math.max(maxMemories, maxGraphNodes),
            });

            // Format memories section
            if (unified.memories.length > 0) {
                parts.push(`### Personal Memory (User-Specific)`);
                parts.push(unified.memories
                    .slice(0, maxMemories)
                    .map(m => `- [${m.type?.toUpperCase()}] ${m.key ? m.key + ': ' : ''}${m.content}`)
                    .join('\n'));
            }

            // Format graph section
            if (unified.graphNodes.length > 0) {
                parts.push(`### Organizational Knowledge (Graph)`);
                parts.push(unified.graphNodes
                    .slice(0, maxGraphNodes)
                    .map(n => {
                        const nodeData = n.data as any;
                        return `- [${n.label}] ${n.name}${nodeData?.content ? ': ' + nodeData.content.substring(0, 100) : ''}`;
                    })
                    .join('\n'));
            }

            // Format relationships
            if (unified.relationships.length > 0) {
                parts.push(`### Relationships`);
                parts.push(unified.relationships
                    .slice(0, 5)
                    .map(r => `- ${r.label} → Node ${r.targetId}`)
                    .join('\n'));
            }

            if (parts.length === 0) {
                return ""; // No context available
            }

            return `\n### UNIFIED ORGANIZATIONAL MEMORY\nRelevant information from organizational memory systems:\n${parts.join('\n\n')}\n`;

        } catch (err: any) {
            logger.error(`[UnifiedMemory] Context generation failed: ${err.message}`);
            return "";
        }
    },

    // =========================================================================
    // HELPERS
    // =========================================================================

    memoryTypeToLabel(type: string): string {
        const mapping: Record<string, string> = {
            'fact': 'Fact',
            'preference': 'Preference',
            'entity': 'Entity',
            'strategy': 'Strategy',
        };
        return mapping[type] || 'Memory';
    },

    labelToMemoryType(label: string): 'fact' | 'preference' | 'entity' | 'strategy' {
        const mapping: Record<string, any> = {
            'Fact': 'fact',
            'Preference': 'preference',
            'Entity': 'entity',
            'Strategy': 'strategy',
            'MissionOutcome': 'fact',
            'RescuePattern': 'strategy',
        };
        return mapping[label] || 'fact';
    },

    async ensureUnifiedMemoryTopic(organizationId: number): Promise<number> {
        const topics = await topicService.listTopics(getSystemOrgContext(organizationId));
        const existing = topics.find((t: any) => t.name === 'Unified Memory');
        if (existing) return existing.id;

        const topic = await topicService.createTopic({
            name: 'Unified Memory',
            description: 'Fused long-term memories and knowledge graph entries',
        }, getSystemOrgContext(organizationId));

        return topic.id;
    },

    consolidateResults(memories: any[], graphNodes: any[], limit: number): any[] {
        // Merge and score results from both systems
        const scored: Array<{ item: any; score: number; source: 'memory' | 'graph' }> = [];

        // Score memories (personal has higher weight)
        for (const mem of memories) {
            scored.push({
                item: { ...mem, _source: 'memory' },
                score: (mem.importance || 5) * 1.2, // Boost personal memories
                source: 'memory',
            });
        }

        // Score graph nodes (verified has higher weight)
        for (const node of graphNodes) {
            const nodeData = node.data as any;
            let score = 5;
            if (node.verificationStatus === 'verified') score += 3;
            if (nodeData?.successCount) score += Math.min(nodeData.successCount, 5);

            scored.push({
                item: { ...node, _source: 'graph' },
                score,
                source: 'graph',
            });
        }

        // Sort by score and take top results
        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(s => ({
                ...s.item,
                _relevanceScore: s.score,
            }));
    },

    // =========================================================================
    // MAINTENANCE
    // =========================================================================

    /**
     * Reconcile orphaned entries (memory without node, node without memory).
     */
    async reconcile(organizationId: number): Promise<{
        memoriesSynced: number;
        nodesSynced: number;
        orphansRemoved: number;
    }> {
        try {
            let memoriesSynced = 0;
            let nodesSynced = 0;

            // Find memories that should be in graph but aren't
            const unsyncedMemories = await db
                .select({ id: agentLongTermMemories.id })
                .from(agentLongTermMemories)
                .where(
                    and(
                        eq(agentLongTermMemories.organizationId, organizationId),
                        sql`${agentLongTermMemories.metadata}->>'knowledgeNodeId' IS NULL`,
                        sql`${agentLongTermMemories.importance} >= 7`
                    )
                );

            for (const mem of unsyncedMemories) {
                const result = await this.syncMemoryToGraph(mem.id);
                if (result.success) memoriesSynced++;
            }

            // Find verified nodes that should be in memory but aren't
            const { nodes } = await graphService.searchNodes(getSystemOrgContext(organizationId), {
                limit: 100
            });
            const unsyncedNodes = nodes.filter((n: any) => n.verificationStatus === 'verified' && !(n.data as any)?.memoryId);

            for (const node of unsyncedNodes) {
                const result = await this.syncNodeToMemory(node.id, organizationId);
                if (result.success) nodesSynced++;
            }

            logger.info(`[UnifiedMemory] Reconciled org ${organizationId}: ${memoriesSynced} mems, ${nodesSynced} nodes`);

            return {
                memoriesSynced,
                nodesSynced,
                orphansRemoved: 0,
            };

        } catch (err: any) {
            logger.error(`[UnifiedMemory] Reconcile failed: ${err.message}`);
            return { memoriesSynced: 0, nodesSynced: 0, orphansRemoved: 0 };
        }
    },

    // Backwards compatibility wrappers
    async query(search: string, organizationId: number, options?: any) {
        return this.queryUnified({
            organizationId,
            search,
            ...options
        });
    },

    async syncBidirectional(organizationId: number, userId?: number) {
        return this.syncOrganization(organizationId);
    },

    async recall(query: string, organizationId: number, userId?: string, options?: any) {
        return this.getUnifiedContext(organizationId, userId, query, options);
    }
};

export default unifiedMemoryService;
