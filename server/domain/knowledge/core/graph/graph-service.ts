import { createHash } from "crypto";
import { db } from "@server/database_service.js";
import {
    knowledgeNodes,
    knowledgeEdges,
    type KnowledgeNode,
    type KnowledgeEdge,
    datasetItems,
    knowledgeTopics,
    knowledgeConcepts,
    knowledgeTopicConcepts,
    knowledgePolicyConstraints,
    graphSchemaDefs,
    knowledgeDocuments,
    createKnowledgeNodeSchema,
    updateKnowledgeNodeSchema,
    normalizeRelation
} from "@shared/schema/index.js";
import { eq, and, or, ilike, desc, sql, type SQL, inArray, aliasedTable, ne, isNotNull } from "drizzle-orm";
import { NotFoundError, BadRequestError, ErrorCode } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { withQueryTracking } from "@domain/knowledge/core/query-monitor.service.js";
import { type OrgContext } from "@server/utils/auth-context.js";
import { getOrgConditions } from "@server/utils/index.js";
import { qdrantPublisher } from "../indexing/qdrant-publisher.js";
import { hierarchicalRetrievalService } from "./hierarchical-retrieval.service.js";

import { CreateNodeInput, UpdateNodeInput, CreateEdgeInput, NodeSearchOptions, GraphTraversalOptions } from "../types.js";
import { temporalVersionStoreService } from "../temporal/temporal-version-store.service.js";
import { developmentProviderKey, ORG_AI_KEY_MISSING, resolveOrgTextAiKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("GraphService");

/**
 * Publishes a node to the vector store for semantic search
 */
export async function embedKnowledgeNode(node: KnowledgeNode): Promise<void> {
    await qdrantPublisher.publishGraphNode(node.id);
}

/**
 * Searches the knowledge graph semantically using vectors
 */
export async function searchNodesSemantically(query: string, orgContext: OrgContext, limit: number = 20): Promise<KnowledgeNode[]> {
    const { retrieveSimilarDocuments } = await import("@domain/knowledge/core/rag-langchain.service.js");
    
    // Check if hierarchical retrieval is enabled
    const enableHierarchical = process.env.ENABLE_HIERARCHICAL_RETRIEVAL === "true";
    
    if (enableHierarchical) {
        // Use hierarchical retrieval for better performance on complex queries
        const hierarchicalResult = await hierarchicalRetrievalService.retrieveHierarchical(
            query,
            orgContext.organizationId
        );
        
        if (hierarchicalResult.localResults.length > 0) {
            logger.info(`[GraphService] Hierarchical retrieval found ${hierarchicalResult.localResults.length} nodes`);
            return hierarchicalResult.localResults.slice(0, limit);
        }
    }
    
    const results = await retrieveSimilarDocuments(query, {
        k: limit,
        organizationId: orgContext.organizationId,
        filter: { sourceType: "graph_node" }
    });

    // Map vector results back to KnowledgeNode entities
    const nodeIds = results
        .map(r => r.metadata?.nodeId)
        .filter((id): id is number => id !== undefined && id !== null);

    if (nodeIds.length === 0) return [];

    return await db.select().from(knowledgeNodes).where(and(
        inArray(knowledgeNodes.id, nodeIds),
        ...getOrgConditions({ ...orgContext, isSuperAdmin: false }, knowledgeNodes, false)
    )).limit(limit);
}

export const graphService = {
    /**
     * Search nodes
     */
    async searchNodes(orgContext: OrgContext, options: NodeSearchOptions = {}): Promise<{ nodes: KnowledgeNode[]; total: number; page: number; limit: number }> {
        return withQueryTracking("graphService.searchNodes", async () => {
            const allowGlobal = !orgContext.organizationId;
            const conditions: SQL[] = getOrgConditions(orgContext, knowledgeNodes, allowGlobal);

            if (options.query) {
                conditions.push(
                    or(
                        ilike(knowledgeNodes.name, `%${options.query}%`),
                        // Search in data jsonb
                        sql`${knowledgeNodes.data}::text ILIKE ${'%' + options.query + '%'}`
                    )!
                );
            }

            if (options.label) {
                conditions.push(eq(knowledgeNodes.label, options.label));
            }

            if (options.excludeLabels && options.excludeLabels.length > 0) {
                conditions.push(sql`${knowledgeNodes.label} NOT IN (${sql.join(options.excludeLabels.map(l => sql`${l}`), sql`, `)})`);
            }

            // Handle domain separation
            if (options.domain === 'system') {
                conditions.push(eq(knowledgeNodes.label, 'Infrastructure'));
            } else if (options.domain === 'knowledge') {
                conditions.push(ne(knowledgeNodes.label, 'Infrastructure'));
            }

            // User requested: Do not represent images as nodes in graph
            conditions.push(
                sql`${knowledgeNodes.label} NOT IN ('Attachment', 'Image', 'Asset')`
            );
            conditions.push(
                sql`${knowledgeNodes.name} NOT ILIKE '%.png' 
                AND ${knowledgeNodes.name} NOT ILIKE '%.jpg' 
                AND ${knowledgeNodes.name} NOT ILIKE '%.jpeg' 
                AND ${knowledgeNodes.name} NOT ILIKE '%.gif' 
                AND ${knowledgeNodes.name} NOT ILIKE '%.webp' 
                AND ${knowledgeNodes.name} NOT ILIKE '%.svg'`
            );

            if (options.knowledgeTopicId) {
                conditions.push(eq(knowledgeNodes.knowledgeTopicId, options.knowledgeTopicId));
            }

            if (options.knowledgeTopicIds && options.knowledgeTopicIds.length > 0) {
                conditions.push(inArray(knowledgeNodes.knowledgeTopicId, options.knowledgeTopicIds));
            }

            if (options.knowledgeDocumentId) {
                const { knowledgeDocumentExtractions } = await import("@shared/schema/index.js");
                const runQuery = db
                    .select({ id: knowledgeDocumentExtractions.id })
                    .from(knowledgeDocumentExtractions)
                    .where(eq(knowledgeDocumentExtractions.documentId, options.knowledgeDocumentId));

                conditions.push(
                    or(
                        eq(knowledgeNodes.knowledgeDocumentId, options.knowledgeDocumentId),
                        sql`EXISTS (
                            SELECT 1 FROM jsonb_array_elements(${knowledgeNodes.extractionSources}) AS s
                            WHERE s->>'type' = 'extraction_run' AND (s->>'runId')::int IN (SELECT id FROM (${runQuery}) AS runs)
                        )`
                    )!
                );
            }

            if (options.pipelineExecutionId) {
                conditions.push(eq(knowledgeNodes.pipelineExecutionId, options.pipelineExecutionId));
            }

            if (options.missionId) {
                conditions.push(eq(knowledgeNodes.missionId, options.missionId));
            }

            if (options.fingerprintPrefix) {
                conditions.push(
                    sql`${knowledgeNodes.data}->>'fingerprintPrefix' = ${options.fingerprintPrefix}`
                );
            }

            if (options.filePath) {
                // Backed by node_data_file_path_idx.
                conditions.push(
                    sql`${knowledgeNodes.data}->>'filePath' = ${options.filePath}`
                );
            }

            if (options.pipelineId) {
                const { pipelineExecutions } = await import("@shared/schema/index.js");
                const execQuery = db
                    .select({ id: pipelineExecutions.id })
                    .from(pipelineExecutions)
                    .where(eq(pipelineExecutions.pipelineId, options.pipelineId));

                conditions.push(inArray(knowledgeNodes.pipelineExecutionId, execQuery));
            }

            if (options.datasetIds && options.datasetIds.length > 0) {
                // Find pipeline executions linked to these datasets
                const executionQuery = db
                    .selectDistinct({ pipelineExecutionId: datasetItems.pipelineExecutionId })
                    .from(datasetItems)
                    .where(and(
                        inArray(datasetItems.datasetId, options.datasetIds),
                        isNotNull(datasetItems.pipelineExecutionId)
                    ));

                // Also find documents linked to these datasets
                const { knowledgeDocuments } = await import("@shared/schema/index.js");
                const docQuery = db
                    .select({ id: knowledgeDocuments.id })
                    .from(knowledgeDocuments)
                    .innerJoin(datasetItems, eq(knowledgeDocuments.datasetItemId, datasetItems.id))
                    .where(inArray(datasetItems.datasetId, options.datasetIds));

                conditions.push(
                    or(
                        inArray(knowledgeNodes.pipelineExecutionId, executionQuery),
                        inArray(knowledgeNodes.knowledgeDocumentId, docQuery)
                    )!
                );
            }
            
            if (options.temporal) {
                const { before, after, between, atTime, field = 'created' } = options.temporal;
                const temporalField = field === 'updated' ? knowledgeNodes.sourceUpdatedAt : knowledgeNodes.sourceCreatedAt;
                
                if (before) {
                    conditions.push(sql`${temporalField} < ${new Date(before)}`);
                }
                if (after) {
                    conditions.push(sql`${temporalField} > ${new Date(after)}`);
                }
                if (between) {
                    conditions.push(and(
                        sql`${temporalField} >= ${new Date(between.start)}`,
                        sql`${temporalField} <= ${new Date(between.end)}`
                    )!);
                }
                if (atTime) {
                    const targetDate = new Date(atTime);
                    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
                    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));
                    conditions.push(and(
                        sql`${temporalField} >= ${startOfDay}`,
                        sql`${temporalField} <= ${endOfDay}`
                    )!);
                }
            }

            const limit = options.limit || 50;
            const offset = options.offset || 0;
            const page = Math.floor(offset / limit) + 1;

            // The count and the page are independent queries over the same
            // predicate; running them together halves wall-clock latency.
            const [countResult, nodes] = await Promise.all([
                db
                    .select({ count: sql<number>`count(*)` })
                    .from(knowledgeNodes)
                    .where(and(...conditions)),
                db
                    .select()
                    .from(knowledgeNodes)
                    .where(and(...conditions))
                    .orderBy(desc(knowledgeNodes.createdAt))
                    .limit(limit)
                    .offset(offset),
            ]);
            const total = Number(countResult[0]?.count || 0);

            return { nodes, total, page, limit };
        }, { table: "knowledge_nodes", operation: "select" });
    },

    /**
     * Parse natural language query into structured search options
     */
    async parseNaturalLanguageQuery(query: string, orgContext: OrgContext): Promise<NodeSearchOptions> {
        return withQueryTracking("graphService.parseNaturalLanguageQuery", async () => {
            const { AIClientFactory } = await import("@domain/ai/core/ai-client.service.js");

            const aiClient = AIClientFactory.getClient({ provider: "google", model: "gemini-2.5-flash" } as any);

            const systemPrompt = `You are a helper for a Knowledge Graph search engine.
            Your goal is to convert a user's natural language query into a structured JSON object.
            
            The structure is:
            {
              "query": string, // general text search
              "label": string, // specific entity label like "Person", "Job", "Incident"
              "verificationStatus": "verified" | "staging" | "rejected"
            }

            Rules:
            - If the user asks for "failed jobs", return { "label": "Job", "query": "failed" }
            - If the user asks for "users named John", return { "label": "User", "query": "John" }
            - If no specific filter is found, put the keywords in "query".
            
            Output ONLY valid JSON.
            `;

            // Gated on the organization's key. This checked OPENAI_API_KEY, which
            // production never sets, so NLQ parsing always fell back to text search.
            if (!(await resolveOrgTextAiKey(null))) throw new Error(`${ORG_AI_KEY_MISSING} to parse natural-language graph queries`);

            const res = await aiClient.execute(
                {
                    model: "gemini-2.5-flash",
                    systemPrompt,
                    userPrompt: query,
                    requestType: "json",
                    provider: "google"
                } as any,
                query,
                developmentProviderKey()
            );

            if (!res.success || !res.output) {
                console.warn("NLQ Parsing failed, falling back to basic text search");
                return { query };
            }

            try {
                return JSON.parse(res.output) as NodeSearchOptions;
            } catch (e) {
                console.error("Failed to parse NLQ JSON:", e);
                return { query };
            }

        }, { operation: "select" });
    },

    /**
     * Resolve entity names to Knowledge Graph node IDs
     */
    async resolveEntitiesToNodeIds(entityNames: string[], orgContext: OrgContext): Promise<number[]> {
        if (!entityNames || entityNames.length === 0) return [];

        return withQueryTracking("graphService.resolveEntitiesToNodeIds", async () => {
            const conditions = [
                inArray(knowledgeNodes.name, entityNames),
                ...getOrgConditions(orgContext, knowledgeNodes)
            ];

            const nodes = await db
                .select({ id: knowledgeNodes.id })
                .from(knowledgeNodes)
                .where(and(...conditions));

            return nodes.map(n => n.id);
        }, { table: "knowledge_nodes", operation: "select" });
    },


    /**
     * Get node by ID
     */
    async getNodeById(nodeId: number, orgContext: OrgContext): Promise<KnowledgeNode> {
        return withQueryTracking("graphService.getNodeById", async () => {
            const conditions = [eq(knowledgeNodes.id, nodeId), ...getOrgConditions(orgContext, knowledgeNodes)];

            const [node] = await db.select().from(knowledgeNodes).where(and(...conditions)).limit(1);
            if (!node) {
                throw new NotFoundError("Node not found");
            }

            // Phase 4: Track usage utility
            db.update(knowledgeNodes)
                .set({ 
                    usageCount: sql`${knowledgeNodes.usageCount} + 1`,
                    lastReaffirmedAt: new Date(),
                    updatedAt: new Date()
                })
                .where(eq(knowledgeNodes.id, nodeId))
                .execute()
                .catch(err => logger.error(`Failed to update usage for node ${nodeId}`, err));

            return node;
        }, { table: "knowledge_nodes", operation: "select" });
    },

    /**
     * Get nodes by IDs
     */
    async getNodesByIds(nodeIds: number[], orgContext: OrgContext): Promise<KnowledgeNode[]> {
        if (nodeIds.length === 0) return [];
        return withQueryTracking("graphService.getNodesByIds", async () => {
            const conditions = [inArray(knowledgeNodes.id, nodeIds), ...getOrgConditions(orgContext, knowledgeNodes)];
            return await db.select().from(knowledgeNodes).where(and(...conditions));
        }, { table: "knowledge_nodes", operation: "select" });
    },

    /**
     * Get nodes by External IDs
     */
    async getNodesByExternalId(externalIds: string[], orgContext: OrgContext): Promise<KnowledgeNode[]> {
        if (externalIds.length === 0) return [];
        return withQueryTracking("graphService.getNodesByExternalId", async () => {
            const conditions = [inArray(knowledgeNodes.externalId, externalIds), ...getOrgConditions(orgContext, knowledgeNodes)];
            return await db.select().from(knowledgeNodes).where(and(...conditions));
        }, { table: "knowledge_nodes", operation: "select" });
    },

    /**
     * Get policy rule IDs for topics
     */
    async getPolicyRuleIdsForTopics(topicIds: number[], orgContext: OrgContext): Promise<number[]> {
        if (topicIds.length === 0) return [];
        return withQueryTracking("graphService.getPolicyRuleIdsForTopics", async () => {
            const results = await db.select({ policyRuleId: knowledgePolicyConstraints.policyRuleId })
                .from(knowledgeTopicConcepts)
                .innerJoin(knowledgePolicyConstraints, eq(knowledgeTopicConcepts.conceptId, knowledgePolicyConstraints.conceptId))
                .where(inArray(knowledgeTopicConcepts.topicId, topicIds));
            
            return results.map(r => r.policyRuleId).filter((id): id is number => id !== null);
        }, { table: "knowledge_topic_concepts", operation: "select" });
    },

    /**
     * Create a node
     */
    async createNode(input: CreateNodeInput, orgContext: OrgContext): Promise<KnowledgeNode> {
        return withQueryTracking("graphService.createNode", async () => {
            // Validate and transform input
            const validated = createKnowledgeNodeSchema.parse({
                ...input,
                organizationId: orgContext.organizationId,
                data: {
                    ...(input.properties || {}),
                    ...(input.metadata || {}),
                    description: input.description,
                    sourceType: input.sourceType,
                    sourceRef: input.sourceRef,
                }
            });

            // Compute fingerprint for deduplication when not explicitly provided.
            // Activates the partial unique index on (organizationId, fingerprint).
            const fingerprint = validated.fingerprint
                ?? createHash('sha256')
                    .update(`${orgContext.organizationId}:${validated.label}:${validated.name}`)
                    .digest('hex');

            const insertValues = {
                name: validated.name,
                label: validated.label,
                data: validated.data,
                knowledgeTopicId: validated.knowledgeTopicId,
                externalId: validated.externalId,
                knowledgeDocumentId: validated.knowledgeDocumentId,
                pipelineExecutionId: validated.pipelineExecutionId,
                extractionSources: validated.extractionSources,
                fingerprint,
                confidenceScore: validated.confidenceScore ? String(validated.confidenceScore) : null,
                missionId: validated.missionId,
                organizationId: orgContext.organizationId,
                verificationStatus: validated.verificationStatus || "staging",
                scope: validated.scope || "private",
                ownerId: validated.ownerId,
            };

            // Filter out undefined values to avoid Drizzle mapping bugs with optional columns
            const cleanValues = Object.fromEntries(
                Object.entries(insertValues).filter(([_, v]) => v !== undefined)
            ) as typeof knowledgeNodes.$inferInsert;

            // DB-level upsert strategy:
            // 1. If externalId present → upsert on (org, label, externalId) partial index.
            // 2. Otherwise → upsert on (org, fingerprint) partial index to prevent duplicates
            //    for nodes without a source-system ID.
            let node;
            if (validated.externalId) {
                const [upserted] = await db.insert(knowledgeNodes)
                    .values(cleanValues)
                    .onConflictDoUpdate({
                        target: [knowledgeNodes.organizationId, knowledgeNodes.label, knowledgeNodes.externalId],
                        targetWhere: sql`external_id IS NOT NULL`,
                        set: cleanValues,
                    })
                    .returning();
                node = upserted;
            } else {
                const [upserted] = await db.insert(knowledgeNodes)
                    .values(cleanValues)
                    .onConflictDoUpdate({
                        target: [knowledgeNodes.organizationId, knowledgeNodes.fingerprint],
                        targetWhere: sql`fingerprint IS NOT NULL`,
                        set: cleanValues,
                    })
                    .returning();
                node = upserted;
            }

            // Index in Qdrant (Async)
            const { qdrantPublisher } = await import("../../index.js");
            qdrantPublisher.publishGraphNode(node.id).catch(err => logger.error('Failed to index node in Qdrant', err, { nodeId: node.id }));

            // Post-mutation: Record version (non-blocking, fire-and-forget)
            // For creates, previousState is an empty object representing no prior state.
            const emptyPreviousState = {} as KnowledgeNode;
            temporalVersionStoreService.recordNodeVersion(
                node.id,
                emptyPreviousState,
                node,
                orgContext.userId || "system:graph-service",
                "node_created",
            ).then(() => {
                temporalVersionStoreService.pruneExcessVersions(node.id).catch(err =>
                    logger.error("Failed to prune node versions after create", { nodeId: node.id, error: err })
                );
            }).catch(err => {
                logger.error("Failed to record node version after create", { nodeId: node.id, error: err });
            });

            logger.info("Node created", { nodeId: node.id, name: node.name, label: node.label });
            return node;
        }, { table: "knowledge_nodes", operation: "insert" });
    },

    /**
     * Update a node
     */
    async updateNode(nodeId: number, input: UpdateNodeInput, orgContext: OrgContext): Promise<KnowledgeNode> {
        return withQueryTracking("graphService.updateNode", async () => {
            const conditions = [eq(knowledgeNodes.id, nodeId), ...getOrgConditions(orgContext, knowledgeNodes)];

            const [currentNode] = await db.select().from(knowledgeNodes).where(and(...conditions)).limit(1);
            if (!currentNode) throw new NotFoundError("Node not found");

            // Validate and transform input
            const validated = updateKnowledgeNodeSchema.parse({
                ...input,
                data: {
                    ...(currentNode.data as object),
                    ...(input.properties || {}),
                    ...(input.metadata || {}),
                    ...(input.description !== undefined ? { description: input.description } : {}),
                    ...(input.sourceType !== undefined ? { sourceType: input.sourceType } : {}),
                    ...(input.sourceRef !== undefined ? { sourceRef: input.sourceRef } : {}),
                }
            });

            const updateData: any = {};
            if (validated.name !== undefined) updateData.name = validated.name;
            if (validated.label !== undefined) updateData.label = validated.label;
            if (validated.data !== undefined) updateData.data = validated.data;
            if (validated.knowledgeTopicId !== undefined) updateData.knowledgeTopicId = validated.knowledgeTopicId;
            if (validated.externalId !== undefined) updateData.externalId = validated.externalId;
            if (validated.knowledgeDocumentId !== undefined) updateData.knowledgeDocumentId = validated.knowledgeDocumentId;
            if (validated.pipelineExecutionId !== undefined) updateData.pipelineExecutionId = validated.pipelineExecutionId;
            if (validated.extractionSources !== undefined) updateData.extractionSources = validated.extractionSources;
            if (validated.fingerprint !== undefined) updateData.fingerprint = validated.fingerprint;
            if (validated.confidenceScore !== undefined) updateData.confidenceScore = validated.confidenceScore ? String(validated.confidenceScore) : null;
            if (validated.verificationStatus !== undefined) updateData.verificationStatus = validated.verificationStatus;
            if (validated.scope !== undefined) updateData.scope = validated.scope;
            if (validated.ownerId !== undefined) updateData.ownerId = validated.ownerId;

            updateData.updatedAt = new Date();

            const [node] = await db
                .update(knowledgeNodes)
                .set(updateData)
                .where(and(...conditions))
                .returning();

            if (!node) {
                throw new NotFoundError("Node not found");
            }

            // Re-index in Qdrant (Async)
            const { qdrantPublisher } = await import("../../index.js");
            qdrantPublisher.publishGraphNode(node.id).catch(err => logger.error('Failed to re-index node', err, { nodeId }));

            // Post-mutation: Record version (non-blocking, fire-and-forget)
            temporalVersionStoreService.recordNodeVersion(
                node.id,
                currentNode,
                node,
                orgContext.userId || "system:graph-service",
                "node_updated",
            ).then(() => {
                temporalVersionStoreService.pruneExcessVersions(node.id).catch(err =>
                    logger.error("Failed to prune node versions after update", { nodeId, error: err })
                );
            }).catch(err => {
                logger.error("Failed to record node version after update", { nodeId, error: err });
            });

            logger.info("Node updated", { nodeId });
            return node;
        }, { table: "knowledge_nodes", operation: "update" });
    },

    /**
     * Delete a node and its edges
     */
    async deleteNode(nodeId: number, orgContext: OrgContext): Promise<boolean> {
        return withQueryTracking("graphService.deleteNode", async () => {
            // Verify access and capture state before deletion
            const nodeBeforeDelete = await this.getNodeById(nodeId, orgContext);

            // Delete edges
            await db.delete(knowledgeEdges).where(
                or(
                    eq(knowledgeEdges.sourceId, nodeId),
                    eq(knowledgeEdges.targetId, nodeId)
                )
            );

            // Delete node
            await db.delete(knowledgeNodes)
                .where(and(
                    eq(knowledgeNodes.id, nodeId),
                    ...getOrgConditions(orgContext, knowledgeNodes)
                ));

            // Remove from Qdrant (Async)
            const { qdrantPublisher } = await import("../../index.js");
            if ((qdrantPublisher as any).deleteGraphNode) {
                (qdrantPublisher as any).deleteGraphNode(nodeId).catch((err: any) => logger.error('Failed to remove node from Qdrant', err, { nodeId }));
            } else {
                // Fallback to bridge if domain publisher doesn't have delete yet
                import("../../../../knowledge/knowledge-graph-service.js").then(({ deleteKnowledgeNodeFromQdrant }) => {
                    deleteKnowledgeNodeFromQdrant(nodeId).catch(err => logger.error('Failed to remove node from Qdrant', err, { nodeId }));
                });
            }

            // Post-mutation: Record version for deletion (non-blocking, fire-and-forget)
            // For deletes, newState is an empty object representing removal.
            const emptyNewState = {} as KnowledgeNode;
            temporalVersionStoreService.recordNodeVersion(
                nodeId,
                nodeBeforeDelete,
                emptyNewState,
                orgContext.userId || "system:graph-service",
                "node_deleted",
            ).catch(err => {
                logger.error("Failed to record node version after delete", { nodeId, error: err });
            });

            logger.info("Node deleted", { nodeId });
            return true;
        }, { table: "knowledge_nodes", operation: "delete" });
    },

    /**
     * List nodes in staging
     */
    async listStagingNodes(orgContext: OrgContext, options: {
        page?: number;
        limit?: number;
        label?: string;
        pipelineExecutionId?: number;
        topicId?: number;
    }) {
        return withQueryTracking("graphService.listStagingNodes", async () => {
            const page = options.page || 1;
            const limit = Math.min(options.limit || 50, 100);
            const offset = (page - 1) * limit;

            const conditions = [
                ...getOrgConditions(orgContext, knowledgeNodes, !orgContext.organizationId),
                eq(knowledgeNodes.verificationStatus, "staging"),
            ];

            if (options.label) conditions.push(eq(knowledgeNodes.label, options.label));
            if (options.pipelineExecutionId) conditions.push(eq(knowledgeNodes.pipelineExecutionId, options.pipelineExecutionId));
            if (options.topicId) conditions.push(eq(knowledgeNodes.knowledgeTopicId, options.topicId));

            const countResult = await db
                .select({ count: sql<number>`count(*)` })
                .from(knowledgeNodes)
                .where(and(...conditions));
            const total = Number(countResult[0]?.count || 0);

            const nodes = await db
                .select({
                    id: knowledgeNodes.id, label: knowledgeNodes.label, name: knowledgeNodes.name,
                    externalId: knowledgeNodes.externalId, data: knowledgeNodes.data,
                    knowledgeDocumentId: knowledgeNodes.knowledgeDocumentId, knowledgeTopicId: knowledgeNodes.knowledgeTopicId,
                    pipelineExecutionId: knowledgeNodes.pipelineExecutionId, extractionSources: knowledgeNodes.extractionSources,
                    fingerprint: knowledgeNodes.fingerprint, verificationStatus: knowledgeNodes.verificationStatus,
                    confidenceScore: knowledgeNodes.confidenceScore, verifiedBy: knowledgeNodes.verifiedBy, verifiedAt: knowledgeNodes.verifiedAt,
                    organizationId: knowledgeNodes.organizationId, createdBy: knowledgeNodes.createdBy, createdAt: knowledgeNodes.createdAt,
                    updatedAt: knowledgeNodes.updatedAt, topicName: knowledgeTopics.name,
                })
                .from(knowledgeNodes)
                .leftJoin(knowledgeTopics, eq(knowledgeNodes.knowledgeTopicId, knowledgeTopics.id))
                .where(and(...conditions))
                .orderBy(desc(knowledgeNodes.createdAt))
                .limit(limit)
                .offset(offset);

            return { nodes, total, page, limit };

        }, { table: "knowledge_nodes", operation: "select" });
    },

    /**
     * Verify a node
     */
    async verifyNode(nodeId: number, orgContext: OrgContext, input: {
        action: "approve" | "reject" | "correct";
        corrections?: { label?: string; name?: string; data?: Record<string, any> };
        username?: string;
    }) {
        return withQueryTracking("graphService.verifyNode", async () => {
            const conditions = [eq(knowledgeNodes.id, nodeId), ...getOrgConditions(orgContext, knowledgeNodes)];

            // Capture state before verification for version recording
            const [nodeBeforeVerify] = await db.select().from(knowledgeNodes).where(and(...conditions)).limit(1);
            if (!nodeBeforeVerify) throw new NotFoundError("Node not found");

            const updateData: Record<string, any> = {
                verifiedBy: input.username || "system",
                verifiedAt: new Date(),
                updatedAt: new Date()
            };

            if (input.action === "approve") updateData.verificationStatus = "verified";
            else if (input.action === "reject") updateData.verificationStatus = "rejected";
            else if (input.action === "correct") {
                updateData.verificationStatus = "verified";
                if (input.corrections?.label) updateData.label = input.corrections.label;
                if (input.corrections?.name) updateData.name = input.corrections.name;
                if (input.corrections?.data) updateData.data = input.corrections.data;
            }

            const [updated] = await db.update(knowledgeNodes).set(updateData).where(and(...conditions)).returning();

            if (!updated) throw new NotFoundError("Node not found");

            // Post-mutation: Record version (non-blocking, fire-and-forget)
            temporalVersionStoreService.recordNodeVersion(
                nodeId,
                nodeBeforeVerify,
                updated,
                input.username || orgContext.userId || "system:graph-service",
                `node_verified:${input.action}`,
            ).then(() => {
                temporalVersionStoreService.pruneExcessVersions(nodeId).catch(err =>
                    logger.error("Failed to prune node versions after verify", { nodeId, error: err })
                );
            }).catch(err => {
                logger.error("Failed to record node version after verify", { nodeId, error: err });
            });

            return updated;
        }, { table: "knowledge_nodes", operation: "update" });
    },

    /**
     * Bulk verify nodes
     */
    async bulkVerifyNodes(orgContext: OrgContext, input: {
        action: "approve" | "reject";
        nodeIds?: number[];
        pipelineExecutionId?: number;
        label?: string;
        username?: string;
    }) {
        return withQueryTracking("graphService.bulkVerifyNodes", async () => {
            const newStatus = input.action === "approve" ? "verified" : "rejected";
            const updateData = {
                verificationStatus: newStatus,
                verifiedBy: input.username || "system",
                verifiedAt: new Date(),
                updatedAt: new Date()
            };

            const conditions = [
                ...getOrgConditions(orgContext, knowledgeNodes),
                eq(knowledgeNodes.verificationStatus, "staging")
            ];

            if (input.nodeIds?.length) {
                conditions.push(inArray(knowledgeNodes.id, input.nodeIds));
            } else if (input.pipelineExecutionId) {
                conditions.push(eq(knowledgeNodes.pipelineExecutionId, input.pipelineExecutionId));
                if (input.label) conditions.push(eq(knowledgeNodes.label, input.label));
            } else {
                throw new BadRequestError("Must provide selection criteria (nodeIds, pipelineExecutionId, or label)");
            }

            // Capture previous states before bulk update for version recording
            const nodesBeforeUpdate = await db.select().from(knowledgeNodes).where(and(...conditions));

            const result = await db.update(knowledgeNodes)
                .set(updateData)
                .where(and(...conditions))
                .returning();

            // Post-mutation: Record versions for each affected node (non-blocking, fire-and-forget)
            const actorId = input.username || orgContext.userId || "system:graph-service";
            const annotation = `bulk_verify:${input.action}`;
            const previousStateMap = new Map(nodesBeforeUpdate.map(n => [n.id, n]));

            Promise.allSettled(
                result.map(updatedNode => {
                    const previousState = previousStateMap.get(updatedNode.id) || ({} as KnowledgeNode);
                    return temporalVersionStoreService.recordNodeVersion(
                        updatedNode.id,
                        previousState,
                        updatedNode,
                        actorId,
                        annotation,
                    ).then(() => {
                        return temporalVersionStoreService.pruneExcessVersions(updatedNode.id);
                    });
                })
            ).catch(err => {
                logger.error("Failed to record node versions after bulk verify", { error: err });
            });

            return { success: true, action: newStatus, count: result.length, nodeIds: result.map(r => r.id) };
        }, { table: "knowledge_nodes", operation: "update" });
    },




    // ========================================================================
    // EDGES
    // ========================================================================

    /**
     * Create an edge between nodes
     */
    async createEdge(input: CreateEdgeInput, orgContext: OrgContext): Promise<KnowledgeEdge> {
        return withQueryTracking("graphService.createEdge", async () => {
            // Verify both nodes exist and are accessible
            await this.getNodeById(input.sourceNodeId, orgContext);
            await this.getNodeById(input.targetNodeId, orgContext);

            const normalizedRelation = normalizeRelation(input.relation);

            const [edge] = await db.insert(knowledgeEdges).values({
                sourceId: input.sourceNodeId,
                targetId: input.targetNodeId,
                relation: normalizedRelation,
                weight: input.weight || 1,
                missionId: input.missionId,
                organizationId: orgContext.organizationId,
                lastUpdatedByRunId: input.lastUpdatedByRunId,
                data: input.properties || {},
            }).onConflictDoNothing().returning();

            if (!edge) {
                logger.warn("Edge already exists, skipping creation", {
                    source: input.sourceNodeId,
                    target: input.targetNodeId,
                    relation: normalizedRelation
                });
                // Return an empty/mock representation or find existing
                const [existing] = await db.select().from(knowledgeEdges).where(
                    and(
                        eq(knowledgeEdges.sourceId, input.sourceNodeId),
                        eq(knowledgeEdges.targetId, input.targetNodeId),
                        eq(knowledgeEdges.relation, normalizedRelation)
                    )
                ).limit(1);
                return existing;
            }

            // Post-mutation: Record edge version (non-blocking, fire-and-forget)
            temporalVersionStoreService.recordEdgeVersion(
                edge.id,
                edge,
                "created",
            ).catch(err => {
                logger.error("Failed to record edge version after create", { edgeId: edge.id, error: err });
            });

            logger.info("Edge created", {
                edgeId: edge.id,
                source: input.sourceNodeId,
                target: input.targetNodeId,
                originalRelation: input.relation,
                normalizedRelation
            });

            return edge;
        }, { table: "knowledge_edges", operation: "insert" });
    },

    /**
     * Batch create edges
     */
    async createEdgesBatch(inputs: CreateEdgeInput[], orgContext: OrgContext): Promise<KnowledgeEdge[]> {
        if (inputs.length === 0) return [];
        return withQueryTracking("graphService.createEdgesBatch", async () => {
            const values = inputs.map(input => ({
                sourceId: input.sourceNodeId,
                targetId: input.targetNodeId,
                relation: normalizeRelation(input.relation),
                weight: input.weight || 1,
                missionId: input.missionId,
                organizationId: orgContext.organizationId,
                lastUpdatedByRunId: input.lastUpdatedByRunId,
                data: input.properties || {},
            }));

            const createdEdges = await db.insert(knowledgeEdges)
                .values(values)
                .onConflictDoNothing()
                .returning();

            if (createdEdges.length > 0 && orgContext.organizationId) {
                Promise.allSettled(
                    createdEdges.map(edge =>
                        temporalVersionStoreService.recordEdgeVersion(edge.id, edge, "created")
                    )
                ).catch(() => {});
            }

            return createdEdges;
        }, { table: "knowledge_edges", operation: "insert" });
    },

    /**
     * Get edge by ID
     */
    async getEdgeById(id: number, orgContext: OrgContext): Promise<KnowledgeEdge | undefined> {
        return withQueryTracking("graphService.getEdgeById", async () => {
            const conditions = [eq(knowledgeEdges.id, id), ...getOrgConditions(orgContext, knowledgeEdges)];
            const [edge] = await db.select().from(knowledgeEdges).where(and(...conditions));
            return edge;
        }, { table: "knowledge_edges", operation: "select" });
    },

    /**
     * Update edge
     */
    async updateEdge(id: number, update: Partial<Omit<KnowledgeEdge, "id" | "sourceId" | "targetId" | "createdAt">>, orgContext: OrgContext): Promise<KnowledgeEdge | undefined> {
        return withQueryTracking("graphService.updateEdge", async () => {
            const conditions = [eq(knowledgeEdges.id, id), ...getOrgConditions(orgContext, knowledgeEdges)];
            const [edge] = await db.update(knowledgeEdges).set(update as any).where(and(...conditions)).returning();

            // Post-mutation: Record edge version (non-blocking, fire-and-forget)
            if (edge) {
                temporalVersionStoreService.recordEdgeVersion(
                    edge.id,
                    edge,
                    "modified",
                ).catch(err => {
                    logger.error("Failed to record edge version after update", { edgeId: id, error: err });
                });
            }

            return edge;
        }, { table: "knowledge_edges", operation: "update" });
    },

    /**
     * Delete edge
     */
    async deleteEdge(id: number, orgContext: OrgContext): Promise<boolean> {
        return withQueryTracking("graphService.deleteEdge", async () => {
            const conditions = [eq(knowledgeEdges.id, id), ...getOrgConditions(orgContext, knowledgeEdges)];

            // Capture edge state before deletion for version recording
            const [edgeBeforeDelete] = await db.select().from(knowledgeEdges).where(and(...conditions));

            const result = await db.delete(knowledgeEdges).where(and(...conditions)).returning();

            // Post-mutation: Record edge version for deletion (non-blocking, fire-and-forget)
            if (edgeBeforeDelete && result.length > 0) {
                temporalVersionStoreService.recordEdgeVersion(
                    edgeBeforeDelete.id,
                    edgeBeforeDelete,
                    "deleted",
                ).catch(err => {
                    logger.error("Failed to record edge version after delete", { edgeId: id, error: err });
                });
            }

            return result.length > 0;
        }, { table: "knowledge_edges", operation: "delete" });
    },

    /**
     * Get edge by nodes
     */
    async getEdgeByNodes(sourceId: number, targetId: number, relation: string, orgContext: OrgContext): Promise<KnowledgeEdge | undefined> {
        return withQueryTracking("graphService.getEdgeByNodes", async () => {
            const conditions = [
                ...getOrgConditions(orgContext, knowledgeEdges),
                eq(knowledgeEdges.sourceId, sourceId),
                eq(knowledgeEdges.targetId, targetId),
                eq(knowledgeEdges.relation, normalizeRelation(relation))
            ];
            const [edge] = await db.select().from(knowledgeEdges).where(and(...conditions)).limit(1);
            return edge;
        }, { table: "knowledge_edges", operation: "select" });
    },

    /**
     * Get edges for a node
     */
    async getNodeEdges(nodeId: number, orgContext: OrgContext, direction: "both" | "outgoing" | "incoming" = "both"): Promise<KnowledgeEdge[]> {
        return withQueryTracking("graphService.getNodeEdges", async () => {
            await this.getNodeById(nodeId, orgContext);

            let whereClause;
            switch (direction) {
                case "outgoing":
                    whereClause = eq(knowledgeEdges.sourceId, nodeId);
                    break;
                case "incoming":
                    whereClause = eq(knowledgeEdges.targetId, nodeId);
                    break;
                default:
                    whereClause = or(
                        eq(knowledgeEdges.sourceId, nodeId),
                        eq(knowledgeEdges.targetId, nodeId)
                    );
            }

            return await db.select().from(knowledgeEdges).where(whereClause!);
        }, { table: "knowledge_edges", operation: "select" });
    },

    /**
     * Get edges for a batch of nodes
     */
    async getNodeEdgesBatch(nodeIds: number[], orgContext: OrgContext, direction: "both" | "outgoing" | "incoming" = "both"): Promise<KnowledgeEdge[]> {
        if (nodeIds.length === 0) return [];
        return withQueryTracking("graphService.getNodeEdgesBatch", async () => {
            const CHUNK_SIZE = 1000;
            const allEdges: KnowledgeEdge[] = [];

            for (let i = 0; i < nodeIds.length; i += CHUNK_SIZE) {
                const chunk = nodeIds.slice(i, i + CHUNK_SIZE);
                let whereClause;
                switch (direction) {
                    case "outgoing":
                        whereClause = inArray(knowledgeEdges.sourceId, chunk);
                        break;
                    case "incoming":
                        whereClause = inArray(knowledgeEdges.targetId, chunk);
                        break;
                    default:
                        whereClause = or(
                            inArray(knowledgeEdges.sourceId, chunk),
                            inArray(knowledgeEdges.targetId, chunk)
                        );
                }

                const conditions = [whereClause!, ...getOrgConditions(orgContext, knowledgeEdges)];
                const chunkEdges = await db.select().from(knowledgeEdges).where(and(...conditions));
                allEdges.push(...chunkEdges);
            }

            return allEdges;
        }, { table: "knowledge_edges", operation: "select" });
    },

    /**
     * Alias for getNodeEdges to maintain compatibility with legacy/pod callers
     */
    async getEdges(nodeId: number, orgContext: OrgContext, direction: "both" | "outgoing" | "incoming" = "both"): Promise<KnowledgeEdge[]> {
        return this.getNodeEdges(nodeId, orgContext, direction);
    },

    /**
     * List edges with optional filters
     */
    async listEdges(orgContext: OrgContext, filters?: {
        sourceId?: number;
        targetId?: number;
        nodeIds?: number[];
        datasetIds?: number[];
        pipelineExecutionId?: number;
        pipelineId?: number;
        missionId?: number;
        limit?: number;
        offset?: number
    }): Promise<{ edges: KnowledgeEdge[]; total: number; page: number; limit: number }> {
        return withQueryTracking("graphService.listEdges", async () => {
            const allowGlobal = !orgContext.organizationId;
            const conditions = getOrgConditions(orgContext, knowledgeEdges, allowGlobal);

            if (filters?.sourceId) {
                conditions.push(eq(knowledgeEdges.sourceId, filters.sourceId));
            }
            if (filters?.targetId) {
                conditions.push(eq(knowledgeEdges.targetId, filters.targetId));
            }
            if (filters?.nodeIds && filters.nodeIds.length > 0) {
                conditions.push(
                    or(
                        inArray(knowledgeEdges.sourceId, filters.nodeIds),
                        inArray(knowledgeEdges.targetId, filters.nodeIds)
                    )!
                );
            }

            if (filters?.pipelineExecutionId) {
                conditions.push(eq(knowledgeEdges.lastUpdatedByRunId, filters.pipelineExecutionId));
            }

            if (filters?.missionId) {
                conditions.push(eq(knowledgeEdges.missionId, filters.missionId));
            }

            if (filters?.pipelineId) {
                const { pipelineExecutions } = await import("@shared/schema/index.js");
                const execQuery = db
                    .select({ id: pipelineExecutions.id })
                    .from(pipelineExecutions)
                    .where(eq(pipelineExecutions.pipelineId, filters.pipelineId));

                conditions.push(inArray(knowledgeEdges.lastUpdatedByRunId, execQuery));
            }

            if (filters?.datasetIds && filters.datasetIds.length > 0) {
                // Find executions for these datasets
                const executionQuery = db
                    .selectDistinct({ pipelineExecutionId: datasetItems.pipelineExecutionId })
                    .from(datasetItems)
                    .where(and(
                        inArray(datasetItems.datasetId, filters.datasetIds),
                        isNotNull(datasetItems.pipelineExecutionId)
                    ));

                conditions.push(inArray(knowledgeEdges.lastUpdatedByRunId, executionQuery));
            }

            // Get count
            const countResult = await db
                .select({ count: sql<number>`count(*)` })
                .from(knowledgeEdges)
                .where(and(...conditions));
            const total = Number(countResult[0]?.count || 0);

            const limit = filters?.limit || 50;
            const offset = filters?.offset || 0;
            const page = Math.floor(offset / limit) + 1;

            const edges = await db.select()
                .from(knowledgeEdges)
                .where(and(...conditions))
                .orderBy(desc(knowledgeEdges.createdAt))
                .limit(limit)
                .offset(offset);

            return { edges, total, page, limit };
        }, { table: "knowledge_edges", operation: "select" });
    },


    /**
     * Get knowledge graph labels
     */
    async getLabels(orgContext: OrgContext): Promise<string[]> {
        return withQueryTracking("graphService.getLabels", async () => {
            const conditions = getOrgConditions(orgContext, knowledgeNodes);
            const result = await db
                .selectDistinct({ label: knowledgeNodes.label })
                .from(knowledgeNodes)
                .where(and(...conditions));
            return result.map(r => r.label).filter((l): l is string => l !== null);
        }, { table: "knowledge_nodes", operation: "select" });
    },

    /**
     * Get node by external ID
     */
    async getNodeByExternalId(label: string, externalId: string, orgContext: OrgContext): Promise<KnowledgeNode | undefined> {
        return withQueryTracking("graphService.getNodeByExternalId", async () => {
            const conditions = [
                ...getOrgConditions(orgContext, knowledgeNodes),
                eq(knowledgeNodes.label, label),
                eq(knowledgeNodes.externalId, externalId)
            ];
            const [node] = await db.select().from(knowledgeNodes).where(and(...conditions)).limit(1);
            return node;
        }, { table: "knowledge_nodes", operation: "select" });
    },

    /**
     * Batch create nodes
     */
    async createNodesBatch(inputs: CreateNodeInput[], orgContext: OrgContext): Promise<KnowledgeNode[]> {
        if (inputs.length === 0) return [];
        return withQueryTracking("graphService.createNodesBatch", async () => {
            const createdNodes: KnowledgeNode[] = [];

            await db.transaction(async (tx) => {
                for (const input of inputs) {
                    try {
                        const values = {
                            name: input.name,
                            label: input.label,
                            data: {
                                // `data` was previously dropped here while the
                                // singular createNode persisted it, so batch-created
                                // nodes silently lost every caller-supplied field
                                // (the code graph stored no filePath at all).
                                ...(input.data || {}),
                                ...(input.properties || {}),
                                ...(input.metadata || {}),
                                description: input.description,
                                sourceType: input.sourceType,
                                sourceRef: input.sourceRef,
                            },
                            knowledgeTopicId: input.knowledgeTopicId,
                            externalId: input.externalId,
                            knowledgeDocumentId: input.knowledgeDocumentId,
                            pipelineExecutionId: input.pipelineExecutionId,
                            extractionSources: input.extractionSources,
                            fingerprint: input.fingerprint,
                            confidenceScore: input.confidenceScore ? String(input.confidenceScore) : null,
                            organizationId: orgContext.organizationId,
                        } as any;

                        // Upsert rather than plain insert, matching createNode. A
                        // plain insert hit the (organizationId, fingerprint) unique
                        // index on every re-index and the row was dropped with a
                        // warning, which froze the graph after its first build.
                        const [node] = input.fingerprint
                            ? await tx.insert(knowledgeNodes)
                                .values(values)
                                .onConflictDoUpdate({
                                    target: [knowledgeNodes.organizationId, knowledgeNodes.fingerprint],
                                    targetWhere: sql`fingerprint IS NOT NULL`,
                                    set: values,
                                })
                                .returning()
                            : await tx.insert(knowledgeNodes).values(values).returning();

                        if (node) createdNodes.push(node);
                    } catch (e) {
                        logger.warn("Failed to create node in batch", { error: e, externalId: input.externalId });
                    }
                }
            });

            // Async indexing
            if (createdNodes.length > 0) {
                const { embedKnowledgeNode } = await import("../../../../knowledge/knowledge-graph-service.js");
                createdNodes.forEach(node => {
                    embedKnowledgeNode(node as any).catch(err => {
                        logger.warn(`[GraphService] Background node embedding skipped/failed for node ${node.id}: ${err.message}`);
                    });
                });
            }

            // Post-mutation: Record versions for batch-created nodes (non-blocking, fire-and-forget)
            if (createdNodes.length > 0 && orgContext.organizationId) {
                const actorId = orgContext.userId || "system:graph-service";
                const emptyPreviousState = {} as KnowledgeNode;
                Promise.allSettled(
                    createdNodes.map(node =>
                        temporalVersionStoreService.recordNodeVersion(
                            node.id,
                            emptyPreviousState,
                            node,
                            actorId,
                            "node_created_batch",
                        ).then(() => temporalVersionStoreService.pruneExcessVersions(node.id))
                    )
                ).catch(err => {
                    logger.error("Failed to record node versions after batch create", { error: err });
                });
            }

            return createdNodes;
        }, { table: "knowledge_nodes", operation: "insert" });
    },

    /**
     * Get property keys for a specific node type (schema introspection)
     */
    async getNodeTypeProperties(nodeType: string, orgContext: OrgContext): Promise<string[]> {
        return withQueryTracking("graphService.getNodeTypeProperties", async () => {
            // Using raw SQL to extract keys from the data jsonb column for a specific label
            const query = sql`
                SELECT DISTINCT jsonb_object_keys(data) as key
                FROM ${knowledgeNodes}
                WHERE ${knowledgeNodes.label} = ${nodeType}
                AND (${knowledgeNodes.organizationId} = ${orgContext.organizationId} OR ${knowledgeNodes.organizationId} IS NULL)
            `;

            const results = await db.execute(query);
            return results.rows.map((r: any) => r.key);
        }, { table: "knowledge_nodes", operation: "select" });
    },

    /**
     * Traverse the graph from a starting node to a specified depth.
     * Uses a Recursive CTE to follow edges.
     */
    async traverseGraph(
        startNodeId: number,
        orgContext: OrgContext,
        options: GraphTraversalOptions = {}
    ): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> {
        return withQueryTracking("graphService.traverseGraph", async () => {
            const depth = Math.min(options.depth || 1, 3); // Max depth 3 for safety
            const direction = options.direction || "outgoing";

            // Define direction filter for the recursive term
            let directionCondition;
            if (direction === "outgoing") {
                directionCondition = eq(knowledgeEdges.sourceId, sql`p.node_id`);
            } else if (direction === "incoming") {
                directionCondition = eq(knowledgeEdges.targetId, sql`p.node_id`);
            } else {
                directionCondition = or(
                    eq(knowledgeEdges.sourceId, sql`p.node_id`),
                    eq(knowledgeEdges.targetId, sql`p.node_id`)
                );
            }

            // Recursive CTE to find related nodes
            // Note: Drizzle's CTE support might be experimental or require specific syntax depending on version.
            // Falling back to raw SQL for the recursive part if strictly typed CTEs are complex to set up quickly without full schema context.
            // However, we can do a localized BFS in application logic for simpler control and type safety if the graph isn't massive.
            // Given the implementation plan mentioned CTE, let's try a robust application-side BFS which is often safer for complex auth/org filtering.

            // 1. Initialize
            const visitedNodeIds = new Set<number>([startNodeId]);
            const visitedEdgeIds = new Set<number>();
            let currentLevelNodeIds = [startNodeId];

            const resultNodes: KnowledgeNode[] = [];

            // Fetch start node
            const startNode = await this.getNodeById(startNodeId, orgContext);
            resultNodes.push(startNode);

            const resultEdges: KnowledgeEdge[] = [];

            // 2. BFS Loop
            for (let i = 0; i < depth; i++) {
                if (currentLevelNodeIds.length === 0) break;

                // Find edges connected to current level
                // CHUNK currentLevelNodeIds to avoid ROW expression limit (1664)
                const CHUNK_SIZE = 1000;
                const levelEdges: KnowledgeEdge[] = [];

                for (let j = 0; j < currentLevelNodeIds.length; j += CHUNK_SIZE) {
                    const chunk = currentLevelNodeIds.slice(j, j + CHUNK_SIZE);
                    const edgesCondition = and(
                        ...getOrgConditions(orgContext, knowledgeEdges),
                        direction === "outgoing"
                            ? inArray(knowledgeEdges.sourceId, chunk)
                            : direction === "incoming"
                                ? inArray(knowledgeEdges.targetId, chunk)
                                : or(
                                    inArray(knowledgeEdges.sourceId, chunk),
                                    inArray(knowledgeEdges.targetId, chunk)
                                )
                    );

                    const chunkEdges = await db.select().from(knowledgeEdges).where(edgesCondition);
                    levelEdges.push(...chunkEdges);
                }

                const nextLevelNodeIds = new Set<number>();

                for (const edge of levelEdges) {
                    if (visitedEdgeIds.has(edge.id)) continue;
                    visitedEdgeIds.add(edge.id);
                    resultEdges.push(edge);

                    // Identify the 'other' node
                    const otherNodeId = currentLevelNodeIds.includes(edge.sourceId) ? edge.targetId : edge.sourceId;

                    if (!visitedNodeIds.has(otherNodeId)) {
                        visitedNodeIds.add(otherNodeId);
                        nextLevelNodeIds.add(otherNodeId);
                    }
                }

                if (nextLevelNodeIds.size > 0) {
                    const nextNodes = await db
                        .select()
                        .from(knowledgeNodes)
                        .where(and(
                            inArray(knowledgeNodes.id, Array.from(nextLevelNodeIds)),
                            ...getOrgConditions(orgContext, knowledgeNodes),
                            // User requested: Do not represent images as nodes in graph
                            sql`${knowledgeNodes.label} NOT IN ('Attachment', 'Image', 'Asset')`,
                            sql`${knowledgeNodes.name} NOT ILIKE '%.png' 
                            AND ${knowledgeNodes.name} NOT ILIKE '%.jpg' 
                            AND ${knowledgeNodes.name} NOT ILIKE '%.jpeg' 
                            AND ${knowledgeNodes.name} NOT ILIKE '%.gif' 
                            AND ${knowledgeNodes.name} NOT ILIKE '%.webp' 
                            AND ${knowledgeNodes.name} NOT ILIKE '%.svg'`
                        ));

                    resultNodes.push(...nextNodes);
                    currentLevelNodeIds = Array.from(nextLevelNodeIds);
                } else {
                    currentLevelNodeIds = [];
                }
            }

            return { nodes: resultNodes, edges: resultEdges };
        }, { table: "knowledge_nodes", operation: "select" });
    },

    /**
     * Get nodes by execution IDs (Forensics)
     */
    async getNodesByExecutionIds(executionIds: number[], orgContext: OrgContext): Promise<KnowledgeNode[]> {
        return withQueryTracking("graphService.getNodesByExecutionIds", async () => {
            const conditions = [
                ...getOrgConditions(orgContext, knowledgeNodes),
                inArray(knowledgeNodes.pipelineExecutionId, executionIds)
            ];
            return await db.select().from(knowledgeNodes).where(and(...conditions));
        }, { table: "knowledge_nodes", operation: "select" });
    },

    /**
     * Get distinct values for a field (Node Metadata)
     */
    async getNodeValues(orgContext: OrgContext, field: string): Promise<Array<{ value: string; count: number }>> {
        return withQueryTracking("graphService.getNodeValues", async () => {
            // Basic protection against SQL injection on the field name since it's used in sql.raw below
            if (!/^[a-zA-Z0-9_.]+$/.test(field)) return [];

            const conditions = getOrgConditions(orgContext, knowledgeNodes);
            let valueExpr;
            let whereExpr;

            const { isNotNull } = await import("drizzle-orm");

            if (field === 'label') {
                valueExpr = knowledgeNodes.label;
                whereExpr = isNotNull(knowledgeNodes.label);
            } else if (field === 'name') {
                valueExpr = knowledgeNodes.name;
                whereExpr = isNotNull(knowledgeNodes.name);
            } else {
                valueExpr = sql`data->>${sql.raw(`'${field}'`)}`;
                whereExpr = sql`data->>${sql.raw(`'${field}'`)} IS NOT NULL`;
            }

            const result = await db
                .select({
                    value: valueExpr,
                    count: sql<number>`count(*)::int`
                })
                .from(knowledgeNodes)
                .where(and(...conditions, whereExpr))
                .groupBy(valueExpr)
                .orderBy(desc(sql`count(*)`))
                .limit(100);

            return result.map(r => ({ value: String(r.value), count: r.count }));
        }, { table: "knowledge_nodes", operation: "select" });
    },

    /**
     * Get graph schema definitions
     */
    async getSchemaDefs(orgContext: OrgContext): Promise<any[]> {
        return withQueryTracking("graphService.getSchemaDefs", async () => {
            const conditions = getOrgConditions(orgContext, graphSchemaDefs);
            const allSchemas = await db.select().from(graphSchemaDefs).where(and(...conditions));

            // Deduplicate by name, preferring org-specific (non-null organizationId)
            const schemaMap = new Map<string, any>();
            for (const s of allSchemas) {
                const existing = schemaMap.get(s.name);
                // We prefer a schema with a non-null organizationId (org-specific) over a null one (global)
                if (!existing || (s.organizationId !== null && existing.organizationId === null)) {
                    schemaMap.set(s.name, s);
                }
            }
            return Array.from(schemaMap.values());
        }, { table: "graph_schema_defs", operation: "select" });
    },

    /**
     * Delete a schema definition
     */
    async deleteSchema(id: number, orgContext: OrgContext): Promise<boolean> {
        return withQueryTracking("graphService.deleteSchema", async () => {
            const conditions = [eq(graphSchemaDefs.id, id), ...getOrgConditions(orgContext, graphSchemaDefs)];
            const result = await db.delete(graphSchemaDefs).where(and(...conditions)).returning();
            return result.length > 0;
        }, { table: "graph_schema_defs", operation: "delete" });
    },

    /**
     * Create a schema definition
     */
    async createSchema(input: any, orgContext: OrgContext): Promise<any> {
        return withQueryTracking("graphService.createSchema", async () => {
            // Check for name collision in this org context
            const conditions = [
                eq(graphSchemaDefs.name, input.name),
                ...getOrgConditions(orgContext, graphSchemaDefs)
            ];
            const existing = await db.select().from(graphSchemaDefs).where(and(...conditions)).limit(1);
            if (existing.length > 0) {
                throw new BadRequestError(`A schema with name "${input.name}" already exists for this organization.`, { name: input.name }, ErrorCode.DUPLICATE_ENTRY);
            }

            const [created] = await db.insert(graphSchemaDefs).values({
                ...input,
                organizationId: orgContext.organizationId,
                createdBy: input.userId || orgContext.userId // Use context userId if not in input
            }).returning();
            return created;
        }, { table: "graph_schema_defs", operation: "insert" });
    },

    /**
     * Update a schema definition
     */
    async updateSchema(id: number, input: any, orgContext: OrgContext): Promise<any> {
        return withQueryTracking("graphService.updateSchema", async () => {
            const conditions = [eq(graphSchemaDefs.id, id), ...getOrgConditions(orgContext, graphSchemaDefs)];
            const [updated] = await db.update(graphSchemaDefs)
                .set({ ...input, updatedAt: new Date() })
                .where(and(...conditions))
                .returning();

            if (!updated) throw new NotFoundError("Schema not found");
            return updated;
        }, { table: "graph_schema_defs", operation: "update" });
    },



    /**
     * Query the graph for edges matching criteria
     */
    async queryGraph(orgContext: OrgContext, query: {
        sourceLabel?: string;
        sourceFilter?: string;
        relation?: string;
        targetLabel?: string;
        targetFilter?: string;
        limit?: number;
        offset?: number;
    }): Promise<Array<{ source: KnowledgeNode; edge: KnowledgeEdge; target: KnowledgeNode }>> {
        return withQueryTracking("graphService.queryGraph", async () => {
            const sourceNodes = aliasedTable(knowledgeNodes, "source_nodes");
            const targetNodes = aliasedTable(knowledgeNodes, "target_nodes");

            const conditions = getOrgConditions(orgContext, knowledgeEdges);

            if (query.relation) {
                conditions.push(eq(knowledgeEdges.relation, query.relation));
            }

            if (query.sourceLabel) {
                conditions.push(eq(sourceNodes.label, query.sourceLabel));
            }

            if (query.sourceFilter) {
                const pattern = `%${query.sourceFilter}%`;
                conditions.push(or(
                    ilike(sourceNodes.name, pattern),
                    ilike(sourceNodes.externalId, pattern)
                )!);
            }

            if (query.targetLabel) {
                conditions.push(eq(targetNodes.label, query.targetLabel));
            }

            if (query.targetFilter) {
                const pattern = `%${query.targetFilter}%`;
                conditions.push(or(
                    ilike(targetNodes.name, pattern),
                    ilike(targetNodes.externalId, pattern)
                )!);
            }

            const limit = query.limit || 50;
            const offset = query.offset || 0;

            return await db
                .select({
                    edge: knowledgeEdges,
                    source: sourceNodes,
                    target: targetNodes,
                })
                .from(knowledgeEdges)
                .innerJoin(sourceNodes, eq(knowledgeEdges.sourceId, sourceNodes.id))
                .innerJoin(targetNodes, eq(knowledgeEdges.targetId, targetNodes.id))
                .where(and(...conditions))
                .limit(limit)
                .offset(offset);
        }, { table: "knowledge_edges", operation: "select" });
    },

    /**
     * Get unique relationship types (relations) in the graph
     */
    async getRelationshipTypes(orgContext: OrgContext): Promise<string[]> {
        const result = await db.execute(sql`
            SELECT DISTINCT relation
            FROM knowledge_edges
            WHERE organization_id = ${orgContext.organizationId}
            ORDER BY relation
        `);

        return result.rows.map(row => row.relation as string);
    },

    /**
     * Get enriched semantic graph data (nodes with concept info)
     */
    async getSemanticGraph(orgContext: OrgContext, options: NodeSearchOptions = {}): Promise<{ nodes: any[]; edges: KnowledgeEdge[] }> {
        return withQueryTracking("graphService.getSemanticGraph", async () => {
            const allowGlobal = !orgContext.organizationId;
            const nodeConditions = getOrgConditions(orgContext, knowledgeNodes, allowGlobal);

            if (options.label) {
                nodeConditions.push(eq(knowledgeNodes.label, options.label));
            }

            if (options.excludeLabels && options.excludeLabels.length > 0) {
                nodeConditions.push(sql`${knowledgeNodes.label} NOT IN (${sql.join(options.excludeLabels.map(l => sql`${l}`), sql`, `)})`);
            }

            // Handle domain separation
            if (options.domain === 'system') {
                nodeConditions.push(eq(knowledgeNodes.label, 'Infrastructure'));
            } else if (options.domain === 'knowledge') {
                nodeConditions.push(ne(knowledgeNodes.label, 'Infrastructure'));
            }

            // User requested: Do not represent images as nodes in graph
            // Filter by common image labels and extensions
            nodeConditions.push(
                sql`${knowledgeNodes.label} NOT IN ('Attachment', 'Image', 'Asset')`
            );
            nodeConditions.push(
                sql`${knowledgeNodes.name} NOT ILIKE '%.png' 
                AND ${knowledgeNodes.name} NOT ILIKE '%.jpg' 
                AND ${knowledgeNodes.name} NOT ILIKE '%.jpeg' 
                AND ${knowledgeNodes.name} NOT ILIKE '%.gif' 
                AND ${knowledgeNodes.name} NOT ILIKE '%.webp' 
                AND ${knowledgeNodes.name} NOT ILIKE '%.svg'`
            );

            if (options.query) {
                nodeConditions.push(
                    or(
                        ilike(knowledgeNodes.name, `%${options.query}%`),
                        sql`${knowledgeNodes.data}::text ILIKE ${'%' + options.query + '%'}`
                    )!
                );
            }

            if (options.knowledgeDocumentId) {
                const { knowledgeDocumentExtractions } = await import("@shared/schema/index.js");
                const runQuery = db
                    .select({ id: knowledgeDocumentExtractions.id })
                    .from(knowledgeDocumentExtractions)
                    .where(eq(knowledgeDocumentExtractions.documentId, options.knowledgeDocumentId));

                nodeConditions.push(
                    or(
                        eq(knowledgeNodes.knowledgeDocumentId, options.knowledgeDocumentId),
                        sql`EXISTS (
                            SELECT 1 FROM jsonb_array_elements(${knowledgeNodes.extractionSources}) AS s
                            WHERE s->>'type' = 'extraction_run' AND (s->>'runId')::int IN (SELECT id FROM (${runQuery}) AS runs)
                        )`
                    )!
                );
            }

            if (options.pipelineExecutionId) {
                nodeConditions.push(eq(knowledgeNodes.pipelineExecutionId, options.pipelineExecutionId));
            }

            if (options.datasetIds && options.datasetIds.length > 0) {
                const { datasetItems, knowledgeDocuments } = await import("@shared/schema/index.js");
                const executionQuery = db
                    .selectDistinct({ pipelineExecutionId: datasetItems.pipelineExecutionId })
                    .from(datasetItems)
                    .where(and(
                        inArray(datasetItems.datasetId, options.datasetIds),
                        isNotNull(datasetItems.pipelineExecutionId)
                    ));

                const docQuery = db
                    .select({ id: knowledgeDocuments.id })
                    .from(knowledgeDocuments)
                    .innerJoin(datasetItems, eq(knowledgeDocuments.datasetItemId, datasetItems.id))
                    .where(inArray(datasetItems.datasetId, options.datasetIds));

                nodeConditions.push(
                    or(
                        inArray(knowledgeNodes.pipelineExecutionId, executionQuery),
                        inArray(knowledgeNodes.knowledgeDocumentId, docQuery),
                        sql`EXISTS (
                            SELECT 1 FROM jsonb_array_elements(${knowledgeNodes.extractionSources}) AS s
                            WHERE s->>'type' = 'extraction_run' AND (s->>'runId')::int IN (
                                SELECT id FROM knowledge_document_extractions WHERE document_id IN (SELECT id FROM (${docQuery}) AS d)
                            )
                        )`
                    )!
                );
            }

            // 1. Fetch nodes with Concept info
            const nodesWithConcepts = await db
                .select({
                    node: {
                        id: knowledgeNodes.id,
                        label: knowledgeNodes.label,
                        name: knowledgeNodes.name,
                        data: knowledgeNodes.data,
                        knowledgeTopicId: knowledgeNodes.knowledgeTopicId,
                        organizationId: knowledgeNodes.organizationId,
                        verificationStatus: knowledgeNodes.verificationStatus,
                        confidenceScore: knowledgeNodes.confidenceScore,
                        createdAt: knowledgeNodes.createdAt,
                    },
                    concept: {
                        id: knowledgeConcepts.id,
                        name: knowledgeConcepts.name,
                    }
                })
                .from(knowledgeNodes)
                .leftJoin(knowledgeTopics, eq(knowledgeNodes.knowledgeTopicId, knowledgeTopics.id))
                .leftJoin(knowledgeTopicConcepts, eq(knowledgeTopics.id, knowledgeTopicConcepts.topicId))
                .leftJoin(knowledgeConcepts, eq(knowledgeTopicConcepts.conceptId, knowledgeConcepts.id))
                .where(and(...nodeConditions))
                .limit(options.limit || 2000);

            // Transform into unique nodes with concept data
            const nodeMap = new Map<number, any>();
            nodesWithConcepts.forEach(row => {
                const node = row.node;
                if (!nodeMap.has(node.id)) {
                    nodeMap.set(node.id, {
                        ...node,
                        concept: row.concept?.id ? row.concept : null
                    });
                } else if (row.concept?.id) {
                    // Update if we found a concept for an existing node (multiple joins)
                    const existing = nodeMap.get(node.id);
                    if (!existing.concept) {
                        existing.concept = row.concept;
                    }
                }
            });
            const finalNodes = Array.from(nodeMap.values());
            const nodeIds = finalNodes.map(n => n.id);

            // 2. Fetch relevant edges
            let edges: KnowledgeEdge[] = [];
            const expandedNodeIds = new Set<number>(nodeIds);

            if (nodeIds.length > 0) {
                // CHUNK nodeIds to avoid ROW expression limit (1664)
                const CHUNK_SIZE = 1000;

                for (let i = 0; i < nodeIds.length; i += CHUNK_SIZE) {
                    const chunk = nodeIds.slice(i, i + CHUNK_SIZE);
                    const edgeConditions = [
                        ...getOrgConditions(orgContext, knowledgeEdges),
                        or(
                            inArray(knowledgeEdges.sourceId, chunk),
                            inArray(knowledgeEdges.targetId, chunk)
                        )!
                    ];
                    const chunkEdges = await db.select().from(knowledgeEdges).where(and(...edgeConditions)).limit(5000);
                    edges.push(...chunkEdges);
                }

                // Identify missing nodes from edges
                const missingNodeIds = new Set<number>();
                edges.forEach(edge => {
                    if (!expandedNodeIds.has(edge.sourceId)) missingNodeIds.add(edge.sourceId);
                    if (!expandedNodeIds.has(edge.targetId)) missingNodeIds.add(edge.targetId);
                });

                if (missingNodeIds.size > 0) {
                    const neighborNodes = await db
                        .select({
                            node: {
                                id: knowledgeNodes.id,
                                label: knowledgeNodes.label,
                                name: knowledgeNodes.name,
                                data: knowledgeNodes.data,
                                knowledgeTopicId: knowledgeNodes.knowledgeTopicId,
                                organizationId: knowledgeNodes.organizationId,
                                verificationStatus: knowledgeNodes.verificationStatus,
                                confidenceScore: knowledgeNodes.confidenceScore,
                                createdAt: knowledgeNodes.createdAt,
                            },
                            concept: {
                                id: knowledgeConcepts.id,
                                name: knowledgeConcepts.name,
                            }
                        })
                        .from(knowledgeNodes)
                        .leftJoin(knowledgeTopics, eq(knowledgeNodes.knowledgeTopicId, knowledgeTopics.id))
                        .leftJoin(knowledgeTopicConcepts, eq(knowledgeTopics.id, knowledgeTopicConcepts.topicId))
                        .leftJoin(knowledgeConcepts, eq(knowledgeTopicConcepts.conceptId, knowledgeConcepts.id))
                        .where(and(
                            inArray(knowledgeNodes.id, Array.from(missingNodeIds)),
                            ...getOrgConditions(orgContext, knowledgeNodes, allowGlobal)
                        ))
                        .limit(500); // Limit neighbors to avoid blowout

                    neighborNodes.forEach(row => {
                        const node = row.node;
                        if (!nodeMap.has(node.id)) {
                            nodeMap.set(node.id, {
                                ...node,
                                concept: row.concept?.id ? row.concept : null
                            });
                        }
                    });
                }
            }

            return { nodes: Array.from(nodeMap.values()), edges };
        }, { table: "knowledge_nodes", operation: "select" });
    }
};


