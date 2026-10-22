/**
 * Knowledge Service
 * 
 * Business logic layer for knowledge graph operations.
 */

import { db } from "@server/database_service.js";
import {
    knowledgeNodes,
    knowledgeEdges,
    type KnowledgeNode,
    type KnowledgeEdge,
    knowledgeTopics,
    datasetItems,
    users,
    knowledgeDocuments,
    knowledgeTopicDocuments,
    fineTuningDatasets,
    fineTuningExamples,
    analysisSessions,
    type AnalysisSession,
    type CreateAnalysisSessionInput
} from "@shared/schema/index.js";
import { eq, and, or, ilike, desc, sql, type SQL, inArray, aliasedTable, ne } from "drizzle-orm";
import { NotFoundError, BadRequestError, ValidationError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { withQueryTracking } from "./query-monitor.service.js";
import { type OrgContext } from "@server/utils/auth-context.js";
import { projectService } from "@domain/projects/core/project.service.js";
import { randomUUID } from "crypto";
import { reindexKnowledgeDocument, deleteKnowledgeDocumentVectors } from "./knowledge-store.js";

const logger = createLogger("KnowledgeService");

// ============================================================================
import { 
    type CreateNodeInput, 
    type UpdateNodeInput, 
    type CreateEdgeInput, 
    type NodeSearchOptions, 
    type GraphTraversalOptions 
} from "./types.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getOrgConditions(orgContext: OrgContext, table: any = knowledgeNodes): SQL[] {
    return orgContext.organizationId !== null
        ? [eq(table.organizationId, orgContext.organizationId)]
        : [sql`${table.organizationId} IS NULL`];
}

// ============================================================================
// KNOWLEDGE SERVICE
// ============================================================================

// In-memory progress tracking for re-indexing
const reindexProgress = new Map<number, {
    total: number;
    processed: number;
    errors: number;
    active: boolean;
    lastUpdated: Date;
}>();

export const knowledgeService = {
    // ========================================================================
    // NODES
    // ========================================================================

    /**
     * Search nodes
     */
    async searchNodes(orgContext: OrgContext, options: NodeSearchOptions = {}): Promise<KnowledgeNode[]> {
        return withQueryTracking("knowledgeService.searchNodes", async () => {
            const conditions: SQL[] = getOrgConditions(orgContext);

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

            if (options.knowledgeTopicId) {
                conditions.push(eq(knowledgeNodes.knowledgeTopicId, options.knowledgeTopicId));
            }

            if (options.datasetIds && options.datasetIds.length > 0) {
                // Find pipeline executions linked to these datasets
                // This is a subquery logic: SELECT pipelineExecutionId FROM datasetItems WHERE datasetId IN ...
                const itemQuery = db
                    .selectDistinct({ pipelineExecutionId: datasetItems.pipelineExecutionId })
                    .from(datasetItems)
                    .where(and(
                        inArray(datasetItems.datasetId, options.datasetIds),
                        sql`${datasetItems.pipelineExecutionId} IS NOT NULL`
                    ));

                conditions.push(inArray(knowledgeNodes.pipelineExecutionId, itemQuery));
            }

            if (options.excludeLabels && options.excludeLabels.length > 0) {
                conditions.push(sql`${knowledgeNodes.label} NOT IN (${sql.join(options.excludeLabels.map(l => sql`${l}`), sql`, `)})`);
            }

            if (options.verificationStatus) {
                conditions.push(eq(knowledgeNodes.verificationStatus, options.verificationStatus));
            }

            let query = db
                .select()
                .from(knowledgeNodes)
                .where(and(...conditions))
                .orderBy(desc(knowledgeNodes.createdAt));

            if (options.limit) {
                query = query.limit(options.limit) as typeof query;
            }
            if (options.offset) {
                query = query.offset(options.offset) as typeof query;
            }

            return await query;
        }, { table: "knowledge_nodes", operation: "select" });
    },

    /**
     * Parse natural language query into structured search options
     */
    async parseNaturalLanguageQuery(query: string, orgContext: OrgContext): Promise<NodeSearchOptions> {
        return withQueryTracking("knowledgeService.parseNaturalLanguageQuery", async () => {
            const { AIClientFactory } = await import("@domain/ai/core/ai-client.service.js");

            // Get AI provider from org settings or env
            // simplified: assume OpenAI for now or use a default provider
            // In a real app, this would fetch the org's preferred AI provider
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
     * Get node by ID
     */
    async getNodeById(nodeId: number, orgContext: OrgContext): Promise<KnowledgeNode> {
        return withQueryTracking("knowledgeService.getNodeById", async () => {
            const conditions = [eq(knowledgeNodes.id, nodeId), ...getOrgConditions(orgContext)];

            const [node] = await db.select().from(knowledgeNodes).where(and(...conditions)).limit(1);
            if (!node) {
                throw new NotFoundError("Node not found");
            }

            return node;
        }, { table: "knowledge_nodes", operation: "select" });
    },

    /**
     * Create a node
     */
    async createNode(input: CreateNodeInput, orgContext: OrgContext): Promise<KnowledgeNode> {
        return withQueryTracking("knowledgeService.createNode", async () => {
            // Map inputs to schema
            // Ensure confidenceScore is string if schema requires decimal/numeric, 
            // but Drizzle often handles number->numeric. 
            // Schema definition: confidenceScore: numeric("confidence_score", { precision: 5, scale: 4 })
            // Parsing might need string. Let's try passing as is or stringify if issues arise.
            // Based on route inspection: `String(validation.data.confidenceScore)`

            const [node] = await db.insert(knowledgeNodes).values({
                name: input.name,
                label: input.label,
                data: {
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
            }).returning();

            logger.info("Node created", { nodeId: node.id, name: node.name, label: node.label });
            return node;
        }, { table: "knowledge_nodes", operation: "insert" });
    },

    /**
     * Update a node
     */
    async updateNode(nodeId: number, input: UpdateNodeInput, orgContext: OrgContext): Promise<KnowledgeNode> {
        return withQueryTracking("knowledgeService.updateNode", async () => {
            const conditions = [eq(knowledgeNodes.id, nodeId), ...getOrgConditions(orgContext)];

            const [currentNode] = await db.select().from(knowledgeNodes).where(and(...conditions)).limit(1);
            if (!currentNode) throw new NotFoundError("Node not found");

            const updateData: any = {};
            if (input.name !== undefined) updateData.name = input.name;
            if (input.label !== undefined) updateData.label = input.label;

            // Merge properties/description/sourceType/Ref into existing data
            if (input.properties || input.metadata || input.description !== undefined || input.sourceType !== undefined || input.sourceRef !== undefined) {
                updateData.data = {
                    ...(currentNode.data as object),
                    ...(input.properties || {}),
                    ...(input.metadata || {}),
                };
                if (input.description !== undefined) updateData.data.description = input.description;
                if (input.sourceType !== undefined) updateData.data.sourceType = input.sourceType;
                if (input.sourceRef !== undefined) updateData.data.sourceRef = input.sourceRef;
            }

            if (input.knowledgeTopicId !== undefined) updateData.knowledgeTopicId = input.knowledgeTopicId;
            if (input.externalId !== undefined) updateData.externalId = input.externalId;
            if (input.knowledgeDocumentId !== undefined) updateData.knowledgeDocumentId = input.knowledgeDocumentId;
            if (input.pipelineExecutionId !== undefined) updateData.pipelineExecutionId = input.pipelineExecutionId;
            if (input.extractionSources !== undefined) updateData.extractionSources = input.extractionSources;
            if (input.fingerprint !== undefined) updateData.fingerprint = input.fingerprint;
            if (input.confidenceScore !== undefined) updateData.confidenceScore = input.confidenceScore ? String(input.confidenceScore) : null;

            updateData.updatedAt = new Date();

            const [updated] = await db
                .update(knowledgeNodes)
                .set(updateData)
                .where(and(...conditions))
                .returning();

            if (!updated) {
                throw new NotFoundError("Node not found");
            }

            logger.info("Node updated", { nodeId });
            return updated;
        }, { table: "knowledge_nodes", operation: "update" });
    },

    /**
     * Delete a node and its edges
     */
    async deleteNode(nodeId: number, orgContext: OrgContext): Promise<void> {
        return withQueryTracking("knowledgeService.deleteNode", async () => {
            // Verify access
            await this.getNodeById(nodeId, orgContext);

            // Delete edges
            await db.delete(knowledgeEdges).where(
                or(
                    eq(knowledgeEdges.sourceId, nodeId),
                    eq(knowledgeEdges.targetId, nodeId)
                )
            );

            // Delete node
            await db.delete(knowledgeNodes).where(eq(knowledgeNodes.id, nodeId));

            logger.info("Node deleted", { nodeId });
        }, { table: "knowledge_nodes", operation: "delete" });
    },

    // ========================================================================
    // EDGES
    // ========================================================================

    /**
     * Create an edge between nodes
     */
    async createEdge(input: CreateEdgeInput, orgContext: OrgContext): Promise<KnowledgeEdge> {
        return withQueryTracking("knowledgeService.createEdge", async () => {
            // Verify both nodes exist and are accessible
            await this.getNodeById(input.sourceNodeId, orgContext);
            await this.getNodeById(input.targetNodeId, orgContext);

            // Use upsert to prevent duplicates in concurrent extraction pipelines.
            // The unique constraint on (sourceId, targetId, relation) ensures idempotency.
            const [edge] = await db.insert(knowledgeEdges).values({
                sourceId: input.sourceNodeId,
                targetId: input.targetNodeId,
                relation: input.relation,
                weight: input.weight || 1,
                organizationId: orgContext.organizationId,
            })
            .onConflictDoUpdate({
                target: [knowledgeEdges.sourceId, knowledgeEdges.targetId, knowledgeEdges.relation],
                set: {
                    weight: input.weight || 1,
                    ...(input.lastUpdatedByRunId !== undefined ? { lastUpdatedByRunId: input.lastUpdatedByRunId } : {}),
                },
            })
            .returning();

            logger.info("Edge created", {
                edgeId: edge.id,
                source: input.sourceNodeId,
                target: input.targetNodeId,
                relation: input.relation,
            });

            return edge;
        }, { table: "knowledge_edges", operation: "insert" });
    },

    /**
     * Get edges for a node
     */
    async getNodeEdges(nodeId: number, orgContext: OrgContext, direction: "both" | "outgoing" | "incoming" = "both"): Promise<KnowledgeEdge[]> {
        return withQueryTracking("knowledgeService.getNodeEdges", async () => {
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
     * List edges with optional filters
     */
    async listEdges(orgContext: OrgContext, filters?: { sourceId?: number; targetId?: number; limit?: number; offset?: number }): Promise<KnowledgeEdge[]> {
        return withQueryTracking("knowledgeService.listEdges", async () => {
            const conditions = getOrgConditions(orgContext, knowledgeEdges);

            if (filters?.sourceId) {
                conditions.push(eq(knowledgeEdges.sourceId, filters.sourceId));
            }
            if (filters?.targetId) {
                conditions.push(eq(knowledgeEdges.targetId, filters.targetId));
            }

            let query = db.select().from(knowledgeEdges).where(and(...conditions)).orderBy(desc(knowledgeEdges.createdAt));
            if (filters?.limit) query = query.limit(filters.limit) as typeof query;
            if (filters?.offset) query = query.offset(filters.offset) as typeof query;

            return await query;
        }, { table: "knowledge_edges", operation: "select" });
    },

    /**
     * Get edge by ID
     */
    async getEdgeById(edgeId: number, orgContext: OrgContext): Promise<KnowledgeEdge> {
        return withQueryTracking("knowledgeService.getEdgeById", async () => {
            const conditions = [eq(knowledgeEdges.id, edgeId), ...getOrgConditions(orgContext, knowledgeEdges)];
            const [edge] = await db.select().from(knowledgeEdges).where(and(...conditions)).limit(1);
            if (!edge) throw new NotFoundError("Edge not found");
            return edge;
        }, { table: "knowledge_edges", operation: "select" });
    },

    /**
     * Update an edge
     */
    async updateEdge(edgeId: number, input: Partial<CreateEdgeInput>, orgContext: OrgContext): Promise<KnowledgeEdge> {
        return withQueryTracking("knowledgeService.updateEdge", async () => {
            const conditions = [eq(knowledgeEdges.id, edgeId), ...getOrgConditions(orgContext, knowledgeEdges)];

            const updateData: any = { updatedAt: new Date() };
            if (input.relation) updateData.relation = input.relation;
            if (input.weight) updateData.weight = input.weight;
            // properties/metadata if they existed in schema

            const [edge] = await db.update(knowledgeEdges).set(updateData).where(and(...conditions)).returning();
            if (!edge) throw new NotFoundError("Edge not found");

            logger.info("Edge updated", { edgeId });
            return edge;
        }, { table: "knowledge_edges", operation: "update" });
    },

    /**
     * Delete an edge
     */
    async deleteEdge(edgeId: number, orgContext: OrgContext): Promise<void> {
        return withQueryTracking("knowledgeService.deleteEdge", async () => {
            // Verify access first
            await this.getEdgeById(edgeId, orgContext);
            await db.delete(knowledgeEdges).where(eq(knowledgeEdges.id, edgeId));
            logger.info("Edge deleted", { edgeId });
        }, { table: "knowledge_edges", operation: "delete" });
    },

    // ========================================================================
    // GRAPH TRAVERSAL
    // ========================================================================

    /**
     * Traverse graph from a starting node
     */
    async traverseGraph(
        startNodeId: number,
        orgContext: OrgContext,
        options: GraphTraversalOptions = {}
    ): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> {
        const depth = options.depth || 2;
        const visitedNodes = new Set<number>();
        const visitedEdges = new Set<number>();
        const nodes: KnowledgeNode[] = [];
        const edges: KnowledgeEdge[] = [];

        const startNode = await this.getNodeById(startNodeId, orgContext);
        nodes.push(startNode);
        visitedNodes.add(startNodeId);

        const traverse = async (nodeId: number, currentDepth: number): Promise<void> => {
            if (currentDepth >= depth) return;

            const nodeEdges = await this.getNodeEdges(nodeId, orgContext, options.direction || "both");

            for (const edge of nodeEdges) {
                if (visitedEdges.has(edge.id)) continue;

                // Filter by relation name if specified
                if (options.relations && !options.relations.includes(edge.relation)) continue;

                visitedEdges.add(edge.id);
                edges.push(edge);

                const nextNodeId = edge.sourceId === nodeId ? edge.targetId : edge.sourceId;

                if (!visitedNodes.has(nextNodeId)) {
                    try {
                        const nextNode = await this.getNodeById(nextNodeId, orgContext);
                        visitedNodes.add(nextNodeId);
                        nodes.push(nextNode);
                        await traverse(nextNodeId, currentDepth + 1);
                    } catch {
                        // Node not accessible, skip
                    }
                }
            }
        };

        await traverse(startNodeId, 0);

        return { nodes, edges };
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
        return withQueryTracking("knowledgeService.queryGraph", async () => {
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

    // ========================================================================
    // TOPICS
    // ========================================================================

    /**
     * List knowledge topics
     */
    async listTopics(orgContext: OrgContext, includeCounts = false) {
        return withQueryTracking("knowledgeService.listTopics", async () => {
            const conditions = orgContext.organizationId !== null
                ? [eq(knowledgeTopics.organizationId, orgContext.organizationId)]
                : [sql`${knowledgeTopics.organizationId} IS NULL`];

            const topics = await db.select().from(knowledgeTopics).where(and(...conditions)).orderBy(knowledgeTopics.name);

            if (!includeCounts) return topics;

            const counts = await db
                .select({
                    topicId: knowledgeTopicDocuments.topicId,
                    count: sql<number>`COUNT(${knowledgeTopicDocuments.documentId})`,
                })
                .from(knowledgeTopicDocuments)
                .groupBy(knowledgeTopicDocuments.topicId);

            const countMap = new Map(counts.map((row) => [row.topicId, Number(row.count)]));
            return topics.map((topic) => ({
                ...topic,
                documentCount: countMap.get(topic.id) ?? 0,
            }));
        }, { table: "knowledge_topics", operation: "select" });
    },

    // ========================================================================
    // STAGING & VERIFICATION
    // ========================================================================

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
        return withQueryTracking("knowledgeService.listStagingNodes", async () => {
            const page = options.page || 1;
            const limit = Math.min(options.limit || 50, 100);
            const offset = (page - 1) * limit;

            const conditions = [
                ...getOrgConditions(orgContext),
                eq(knowledgeNodes.verificationStatus, "staging"),
            ];

            if (options.label) conditions.push(eq(knowledgeNodes.label, options.label));
            if (options.pipelineExecutionId) conditions.push(eq(knowledgeNodes.pipelineExecutionId, options.pipelineExecutionId));
            if (options.topicId) conditions.push(eq(knowledgeNodes.knowledgeTopicId, options.topicId));

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

            const [{ count: total }] = await db.select({ count: sql<number>`count(*)` }).from(knowledgeNodes).where(and(...conditions));

            return { nodes, total: Number(total), page, limit };
        }, { table: "knowledge_nodes", operation: "select" });
    },

    // ========================================================================
    // DOCUMENTS
    // ========================================================================

    /**
     * List knowledge documents
     */
    async listDocuments(orgContext: OrgContext, options: {
        topicId?: number;
        limit?: number;
        offset?: number;
    } = {}): Promise<any[]> {
        return withQueryTracking("knowledgeService.listDocuments", async () => {
            const conditions = getOrgConditions(orgContext, knowledgeDocuments);

            if (options.topicId) {
                // Determine documents linked to topic
                const relations = await db
                    .select({ documentId: knowledgeTopicDocuments.documentId })
                    .from(knowledgeTopicDocuments)
                    .where(eq(knowledgeTopicDocuments.topicId, options.topicId));

                const docIds = relations.map(r => r.documentId);
                if (!docIds.length) return [];

                conditions.push(inArray(knowledgeDocuments.id, docIds));
            }

            let query = db
                .select()
                .from(knowledgeDocuments)
                .where(and(...conditions))
                .orderBy(desc(knowledgeDocuments.updatedAt));

            if (options.limit) query = query.limit(options.limit) as typeof query;
            if (options.offset) query = query.offset(options.offset) as typeof query;

            const documents = await query;

            // Enrich with topics
            const docIds = documents.map(d => d.id);
            const topicMap = await this.getDocumentTopicsMap(docIds);

            return documents.map(doc => ({
                ...doc,
                topics: topicMap.get(doc.id) || []
            }));
        }, { table: "knowledge_documents", operation: "select" });
    },

    /**
     * Get document topics map helper
     */
    async getDocumentTopicsMap(documentIds: number[]): Promise<Map<number, Array<{ id: number; name: string }>>> {
        if (!documentIds.length) return new Map();

        const rows = await db
            .select({
                documentId: knowledgeTopicDocuments.documentId,
                topicId: knowledgeTopicDocuments.topicId,
                topicName: knowledgeTopics.name,
            })
            .from(knowledgeTopicDocuments)
            .innerJoin(knowledgeTopics, eq(knowledgeTopicDocuments.topicId, knowledgeTopics.id))
            .where(inArray(knowledgeTopicDocuments.documentId, documentIds));

        const map = new Map<number, Array<{ id: number; name: string }>>();
        rows.forEach((row) => {
            const list = map.get(row.documentId) ?? [];
            list.push({ id: row.topicId, name: row.topicName || "Untitled Topic" });
            map.set(row.documentId, list);
        });

        return map;
    },

    /**
     * Get a single org-scoped document by its exact title.
     * Keyed on the (organization_id, title) unique index, so it returns the one
     * row that an idempotent createDocument upsert would have written.
     */
    async getDocumentByTitle(title: string, orgContext: OrgContext): Promise<any | null> {
        return withQueryTracking("knowledgeService.getDocumentByTitle", async () => {
            const conditions = getOrgConditions(orgContext, knowledgeDocuments);
            conditions.push(eq(knowledgeDocuments.title, title));

            // Title is not unique: regenerating a spec inserts a new document
            // rather than replacing the old one, so an org can hold many rows
            // under one title. Without an explicit order, `limit(1)` returned
            // whichever row Postgres happened to surface from heap order, so a
            // freshly regenerated spec could be read back as an older revision
            // and its fingerprint would never match — the spec stayed
            // permanently "outdated". Newest row wins.
            const [document] = await db
                .select()
                .from(knowledgeDocuments)
                .where(and(...conditions))
                .orderBy(desc(knowledgeDocuments.id))
                .limit(1);

            return document ?? null;
        }, { table: "knowledge_documents", operation: "select" });
    },

    /** Return an org-scoped document by id. */
    async getDocumentById(documentId: number, orgContext: OrgContext): Promise<any | null> {
        return withQueryTracking("knowledgeService.getDocumentById", async () => {
            const conditions = getOrgConditions(orgContext, knowledgeDocuments);
            conditions.push(eq(knowledgeDocuments.id, documentId));
            const [document] = await db
                .select()
                .from(knowledgeDocuments)
                .where(and(...conditions))
                .limit(1);
            return document ?? null;
        }, { table: "knowledge_documents", operation: "select" });
    },

    /**
     * List org-scoped documents emitted by a named generator. This keeps
     * lightweight operational registers in the existing knowledge store while
     * preserving organization isolation and avoiding one table per register.
     */
    async listDocumentsByGeneratedFrom(generatedFrom: string, orgContext: OrgContext, limit = 250): Promise<any[]> {
        return withQueryTracking("knowledgeService.listDocumentsByGeneratedFrom", async () => {
            const conditions = getOrgConditions(orgContext, knowledgeDocuments);
            conditions.push(sql`${knowledgeDocuments.metadata} ->> 'generatedFrom' = ${generatedFrom}`);
            return db
                .select()
                .from(knowledgeDocuments)
                .where(and(...conditions))
                .orderBy(desc(knowledgeDocuments.createdAt))
                .limit(limit);
        }, { table: "knowledge_documents", operation: "select" });
    },

    /**
     * Return a title -> { updatedAt, fingerprint } map for every org-scoped
     * document generated by the documentation service
     * (metadata.generatedFrom = "documentation-service"). The fingerprint is the
     * content hash stored at generation time; comparing it to the freshly
     * computed hash is how the Documentation page detects outdated specs
     * (robust to git mtime churn). One query backs freshness for all specs.
     */
    async getGeneratedSpecMeta(orgContext: OrgContext): Promise<Map<string, { updatedAt: Date; fingerprint: string | null; summary: string | null }>> {
        return withQueryTracking("knowledgeService.getGeneratedSpecMeta", async () => {
            const conditions = getOrgConditions(orgContext, knowledgeDocuments);
            conditions.push(sql`${knowledgeDocuments.metadata} ->> 'generatedFrom' = 'documentation-service'`);

            const rows = await db
                .select({
                    title: knowledgeDocuments.title,
                    updatedAt: knowledgeDocuments.updatedAt,
                    metadata: knowledgeDocuments.metadata,
                    summary: knowledgeDocuments.summary,
                })
                .from(knowledgeDocuments)
                .where(and(...conditions));

            const map = new Map<string, { updatedAt: Date; fingerprint: string | null; summary: string | null }>();
            for (const row of rows) {
                if (!row.updatedAt) continue;
                const updatedAt = row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt as any);
                const fingerprint = (row.metadata as { fingerprint?: string } | null)?.fingerprint ?? null;
                map.set(row.title, { updatedAt, fingerprint, summary: row.summary });
            }
            return map;
        }, { table: "knowledge_documents", operation: "select" });
    },

    /**
     * Full-text (substring) search across documentation-service generated specs
     * for an org. Returns title/summary/content/metadata for snippet building.
     */
    async searchGeneratedSpecs(orgContext: OrgContext, query: string, limit = 25): Promise<Array<{ title: string; summary: string | null; textContent: string | null; metadata: any }>> {
        return withQueryTracking("knowledgeService.searchGeneratedSpecs", async () => {
            const conditions = getOrgConditions(orgContext, knowledgeDocuments);
            conditions.push(sql`${knowledgeDocuments.metadata} ->> 'generatedFrom' = 'documentation-service'`);
            const like = `%${query}%`;
            conditions.push(sql`(${knowledgeDocuments.title} ILIKE ${like} OR ${knowledgeDocuments.textContent} ILIKE ${like})`);

            return db
                .select({
                    title: knowledgeDocuments.title,
                    summary: knowledgeDocuments.summary,
                    textContent: knowledgeDocuments.textContent,
                    metadata: knowledgeDocuments.metadata,
                })
                .from(knowledgeDocuments)
                .where(and(...conditions))
                .orderBy(desc(knowledgeDocuments.updatedAt))
                .limit(limit);
        }, { table: "knowledge_documents", operation: "select" });
    },

    /**
     * Create knowledge document
     */
    async createDocument(input: {
        title: string;
        summary?: string | null;
        sourceType?: string;
        textContent?: string | null;
        url?: string | null;
        fileData?: string | null;
        contentType?: string | null;
        fileSize?: number | null;
        metadata?: Record<string, any> | null;
        topicIds?: number[];
    }, orgContext: OrgContext): Promise<any> {
        return withQueryTracking("knowledgeService.createDocument", async () => {
            // An upload is searchable only once it has text; read it from the file.
            if ((input.sourceType || "upload") === "upload" && input.fileData && !input.textContent?.trim()) {
                const { extractUploadedText, extractionMetadata } = await import("./document-text-extraction.js");
                const result = await extractUploadedText({ fileData: input.fileData, contentType: input.contentType, title: input.title }, orgContext.organizationId);
                input = { ...input, textContent: result.text, metadata: { ...(input.metadata ?? {}), extraction: extractionMetadata(result) } };
            }
            // Get user for createdBy
            let createdBy: string | null = null;
            if (orgContext.userId) {
                const [user] = await db.select({ username: users.username }).from(users).where(eq(users.id, orgContext.userId)).limit(1);
                createdBy = user?.username ?? null;
            }

            const insertValues = {
                title: input.title,
                summary: input.summary,
                sourceType: input.sourceType || "upload",
                textContent: input.textContent,
                url: input.url,
                fileData: input.fileData,
                contentType: input.contentType,
                fileSize: input.fileSize,
                metadata: input.metadata,
                organizationId: orgContext.organizationId,
                createdBy,
                // Written only once the vector store confirms — see below.
                qdrantPointId: null,
                createdAt: new Date(),
                updatedAt: new Date(),
                // Namespacing key for the upsert below. MUST be non-null — Postgres
                // treats NULLs as distinct, so a null project would make this upsert
                // insert a duplicate instead of updating.
                projectId:
                    (input as any).projectId
                    ?? await projectService.resolveDefaultProjectId(orgContext.organizationId as number),
            };

            // Idempotent ingest: (project_id, title) is UNIQUE
            // (knowledge_docs_project_title_unique). Re-uploading a file with the
            // same name (e.g. re-attaching a suggested resource) updates the
            // existing row instead of throwing a raw constraint-violation error.
            const [document] = await db
                .insert(knowledgeDocuments)
                .values(insertValues)
                .onConflictDoUpdate({
                    target: [knowledgeDocuments.projectId, knowledgeDocuments.title],
                    set: {
                        summary: insertValues.summary,
                        sourceType: insertValues.sourceType,
                        textContent: insertValues.textContent,
                        url: insertValues.url,
                        fileData: insertValues.fileData,
                        contentType: insertValues.contentType,
                        fileSize: insertValues.fileSize,
                        metadata: insertValues.metadata,
                        updatedAt: new Date(),
                    },
                })
                .returning();

            if (input.topicIds?.length) {
                const topicAssignments = input.topicIds.map((topicId) => ({
                    topicId,
                    documentId: document.id,
                }));
                await db.insert(knowledgeTopicDocuments).values(topicAssignments);
            }

            // Trigger reindexing asynchronously.
            //
            // The key is chosen here; the column is written only after the store
            // confirms the write, so `qdrant_point_id IS NOT NULL` means the
            // document is genuinely retrievable rather than merely inserted.
            const pointId = (document as any).qdrantPointId ?? randomUUID();
            reindexKnowledgeDocument({ ...(document as any), qdrantPointId: pointId })
                .then(async (result) => {
                    if (!result.indexed) return;
                    await db
                        .update(knowledgeDocuments)
                        .set({ qdrantPointId: pointId })
                        .where(eq(knowledgeDocuments.id, document.id));
                })
                .catch((err) => {
                    logger.error('Failed to reindex document (non-blocking)', err, { documentId: document.id });
                });

            // Trigger Auto-Linking asynchronously (Phase 2)
            // Dynamic import to avoid circular dependency if any (though currently clean)
            import("@domain/knowledge/core/auto-linking.service.js").then(({ autoLinkingService }) => {
                autoLinkingService.processDocument(document.id, input.textContent || "", orgContext).catch((err) => {
                    logger.error('Failed to auto-link document (non-blocking)', err, { documentId: document.id });
                });
            });

            logger.info('Document created', { documentId: document.id });

            const topicMap = await this.getDocumentTopicsMap([document.id]);
            return {
                ...document,
                topics: topicMap.get(document.id) || []
            };
        }, { table: "knowledge_documents", operation: "insert" });
    },

    /**
     * Update knowledge document
     */
    async updateDocument(documentId: number, input: {
        title?: string;
        summary?: string | null;
        sourceType?: string;
        textContent?: string | null;
        url?: string | null;
        fileData?: string | null;
        contentType?: string | null;
        fileSize?: number | null;
        metadata?: Record<string, any> | null;
        topicIds?: number[];
    }, orgContext: OrgContext): Promise<any> {
        return withQueryTracking("knowledgeService.updateDocument", async () => {
            const conditions = [eq(knowledgeDocuments.id, documentId), ...getOrgConditions(orgContext, knowledgeDocuments)];

            // Check existence
            const [existing] = await db.select().from(knowledgeDocuments).where(and(...conditions)).limit(1);
            if (!existing) throw new NotFoundError("Document not found");

            if (input.fileData && input.textContent === undefined) {
                const { extractUploadedText, extractionMetadata } = await import("./document-text-extraction.js");
                const result = await extractUploadedText({
                    fileData: input.fileData, contentType: input.contentType ?? existing.contentType, title: input.title ?? existing.title,
                }, orgContext.organizationId);
                input = { ...input, textContent: result.text, metadata: { ...((input.metadata ?? existing.metadata) as Record<string, any> ?? {}), extraction: extractionMetadata(result) } };
            }

            const updateData: any = { updatedAt: new Date() };
            if (input.title !== undefined) updateData.title = input.title;
            if (input.summary !== undefined) updateData.summary = input.summary;
            if (input.sourceType !== undefined) updateData.sourceType = input.sourceType;
            if (input.textContent !== undefined) updateData.textContent = input.textContent;
            if (input.url !== undefined) updateData.url = input.url;
            if (input.fileData !== undefined) updateData.fileData = input.fileData;
            if (input.contentType !== undefined) updateData.contentType = input.contentType;
            if (input.fileSize !== undefined) updateData.fileSize = input.fileSize;
            if (input.metadata !== undefined) updateData.metadata = input.metadata;

            const [updated] = await db.update(knowledgeDocuments)
                .set(updateData)
                .where(and(...conditions))
                .returning();

            if (input.topicIds !== undefined) {
                await db.delete(knowledgeTopicDocuments).where(eq(knowledgeTopicDocuments.documentId, documentId));
                if (input.topicIds.length > 0) {
                    const topicAssignments = input.topicIds.map((topicId) => ({ topicId, documentId }));
                    await db.insert(knowledgeTopicDocuments).values(topicAssignments);
                }
            }

            // Trigger reindexing
            reindexKnowledgeDocument(updated as any).catch((err) => {
                logger.error('Failed to reindex document', err, { documentId });
            });

            const topicMap = await this.getDocumentTopicsMap([documentId]);
            return {
                ...updated,
                topics: topicMap.get(documentId) || []
            };
        }, { table: "knowledge_documents", operation: "update" });
    },

    /**
     * Delete knowledge document
     */
    async deleteDocument(documentId: number, orgContext: OrgContext): Promise<void> {
        return withQueryTracking("knowledgeService.deleteDocument", async () => {
            const conditions = [eq(knowledgeDocuments.id, documentId), ...getOrgConditions(orgContext, knowledgeDocuments)];

            const [existing] = await db.select().from(knowledgeDocuments).where(and(...conditions)).limit(1);
            if (!existing) throw new NotFoundError("Document not found");

            // Delete from DB
            await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, documentId));

            // Delete vectors
            if (existing.qdrantPointId) {
                deleteKnowledgeDocumentVectors(existing as any).catch((err) =>
                    logger.error('Vector deletion error', err, { documentId })
                );
            }

            logger.info('Document deleted', { documentId });
        }, { table: "knowledge_documents", operation: "delete" });
    },

    /**
     * Delete all documents (utility)
     */
    async deleteAllDocuments(orgContext: OrgContext): Promise<number> {
        return withQueryTracking("knowledgeService.deleteAllDocuments", async () => {
            const conditions = getOrgConditions(orgContext, knowledgeDocuments);
            const toDelete = await db.select().from(knowledgeDocuments).where(and(...conditions));

            if (toDelete.length === 0) return 0;

            await db.delete(knowledgeDocuments).where(and(...conditions));

            toDelete.forEach((doc) => {
                if (doc.qdrantPointId) {
                    deleteKnowledgeDocumentVectors(doc as any).catch(err =>
                        logger.error('Vector deletion error', err, { documentId: doc.id })
                    );
                }
            });

            return toDelete.length;
        }, { table: "knowledge_documents", operation: "delete" });
    },

    // ========================================================================
    // CONTEXT (Run / Dataset)
    // ========================================================================

    /**
     * Get graph context for a pipeline run
     */
    async getRunContext(runId: number, orgContext: OrgContext): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> {
        return withQueryTracking("knowledgeService.getRunContext", async () => {
            const orgCond = orgContext.organizationId
                ? eq(knowledgeEdges.organizationId, orgContext.organizationId)
                : sql`1=1`;
            const nodeOrgCond = orgContext.organizationId
                ? eq(knowledgeNodes.organizationId, orgContext.organizationId)
                : sql`1=1`;

            // 1. Get Edges created by this run — scoped to caller's org
            let runEdges = await db
                .select()
                .from(knowledgeEdges)
                .where(and(eq(knowledgeEdges.lastUpdatedByRunId, runId), orgCond));

            const nodeIds = new Set<number>();

            if (runEdges.length === 0) {
                const runNodes = await db
                    .select({ id: knowledgeNodes.id })
                    .from(knowledgeNodes)
                    .where(and(eq(knowledgeNodes.pipelineExecutionId, runId), nodeOrgCond));

                if (runNodes.length > 0) {
                    const ids = runNodes.map(n => n.id);
                    runEdges = await db
                        .select()
                        .from(knowledgeEdges)
                        .where(and(
                            or(inArray(knowledgeEdges.sourceId, ids), inArray(knowledgeEdges.targetId, ids)),
                            orgCond
                        ));
                }
            }

            const explicitRunNodes = await db.select({ id: knowledgeNodes.id }).from(knowledgeNodes)
                .where(and(eq(knowledgeNodes.pipelineExecutionId, runId), nodeOrgCond));

            if (runEdges.length === 0 && explicitRunNodes.length === 0) {
                return { nodes: [], edges: [] };
            }

            // 2. Identify Semantic Targets and history — org-scoped
            const targetIds = Array.from(new Set(runEdges.map(e => e.targetId)));
            let historyEdges: KnowledgeEdge[] = [];
            if (targetIds.length > 0) {
                historyEdges = await db.select().from(knowledgeEdges)
                    .where(and(
                        inArray(knowledgeEdges.targetId, targetIds),
                        ne(knowledgeEdges.lastUpdatedByRunId, runId),
                        orgCond
                    ))
                    .limit(500);
            }

            const allEdges = [...runEdges, ...historyEdges];
            allEdges.forEach(e => { nodeIds.add(e.sourceId); nodeIds.add(e.targetId); });
            explicitRunNodes.forEach(n => nodeIds.add(n.id));

            if (nodeIds.size === 0) return { nodes: [], edges: [] };

            const nodes = await db.select().from(knowledgeNodes)
                .where(and(inArray(knowledgeNodes.id, Array.from(nodeIds)), nodeOrgCond));
            return { nodes, edges: allEdges };
        }, { table: "knowledge_edges", operation: "select" });
    },

    /**
     * Get graph context for a dataset
     */
    async getDatasetContext(datasetId: number, orgContext: OrgContext): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> {
        return withQueryTracking("knowledgeService.getDatasetContext", async () => {
            // 1. Find Pipeline Execution IDs linked to this Dataset
            const items = await db
                .selectDistinct({ pipelineExecutionId: datasetItems.pipelineExecutionId })
                .from(datasetItems)
                .where(eq(datasetItems.datasetId, datasetId));

            const executionIds = items
                .map(i => i.pipelineExecutionId)
                .filter((id): id is number => id !== null);

            if (executionIds.length === 0) {
                return { nodes: [], edges: [] };
            }

            // 2. Get Edges created by these runs
            const runEdges = await db
                .select()
                .from(knowledgeEdges)
                .where(inArray(knowledgeEdges.lastUpdatedByRunId, executionIds));

            const nodeIds = new Set<number>();

            // 3. Get Nodes directly linked to these runs
            const explicitRunNodes = await db
                .select({ id: knowledgeNodes.id })
                .from(knowledgeNodes)
                .where(inArray(knowledgeNodes.pipelineExecutionId, executionIds));

            if (runEdges.length === 0 && explicitRunNodes.length === 0) {
                return { nodes: [], edges: [] };
            }

            // 4. Identify Semantic Targets (History) within context
            const targetIds = Array.from(new Set(runEdges.map(e => e.targetId)));
            const sourceIds = Array.from(new Set(runEdges.map(e => e.sourceId)));

            explicitRunNodes.forEach(n => nodeIds.add(n.id));
            sourceIds.forEach(id => nodeIds.add(id));
            targetIds.forEach(id => nodeIds.add(id));

            if (nodeIds.size === 0) return { nodes: [], edges: [] };

            const nodes = await db
                .select()
                .from(knowledgeNodes)
                .where(inArray(knowledgeNodes.id, Array.from(nodeIds)));

            return { nodes, edges: runEdges };
        }, { table: "knowledge_edges", operation: "select" });
    },

    /**
     * Verify a node
     */
    async verifyNode(nodeId: number, orgContext: OrgContext, input: {
        action: "approve" | "reject" | "correct";
        corrections?: { label?: string; name?: string; data?: Record<string, any> };
        username?: string;
    }) {
        return withQueryTracking("knowledgeService.verifyNode", async () => {
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

            const conditions = [eq(knowledgeNodes.id, nodeId), ...getOrgConditions(orgContext)];
            const [updated] = await db.update(knowledgeNodes).set(updateData).where(and(...conditions)).returning();

            if (!updated) throw new NotFoundError("Node not found");
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
        return withQueryTracking("knowledgeService.bulkVerifyNodes", async () => {
            const newStatus = input.action === "approve" ? "verified" : "rejected";
            const updateData = {
                verificationStatus: newStatus,
                verifiedBy: input.username || "system",
                verifiedAt: new Date(),
                updatedAt: new Date()
            };

            const conditions = [
                ...getOrgConditions(orgContext),
                eq(knowledgeNodes.verificationStatus, "staging")
            ];

            if (input.nodeIds?.length) {
                conditions.push(inArray(knowledgeNodes.id, input.nodeIds));
            } else if (input.pipelineExecutionId) {
                conditions.push(eq(knowledgeNodes.pipelineExecutionId, input.pipelineExecutionId));
                if (input.label) conditions.push(eq(knowledgeNodes.label, input.label));
            } else if (input.label) {
                conditions.push(eq(knowledgeNodes.label, input.label));
            } else {
                throw new BadRequestError("Must provide selection criteria (nodeIds, pipelineExecutionId, or label)");
            }

            const result = await db.update(knowledgeNodes)
                .set(updateData)
                .where(and(...conditions))
                .returning({ id: knowledgeNodes.id });

            return { success: true, action: newStatus, count: result.length, nodeIds: result.map(r => r.id) };
        }, { table: "knowledge_nodes", operation: "update" });
    },

    async getTopicById(topicId: number, orgContext: OrgContext) {
        return withQueryTracking("knowledgeService.getTopicById", async () => {
            const conditions = [
                eq(knowledgeTopics.id, topicId),
                orgContext.organizationId !== null
                    ? eq(knowledgeTopics.organizationId, orgContext.organizationId)
                    : sql`${knowledgeTopics.organizationId} IS NULL`
            ];

            const [topic] = await db.select().from(knowledgeTopics).where(and(...conditions)).limit(1);
            if (!topic) throw new NotFoundError("Topic not found");
            return topic;
        }, { table: "knowledge_topics", operation: "select" });
    },

    async createTopic(input: { name: string; description?: string | null; parentTopicId?: number | null }, orgContext: OrgContext) {
        return withQueryTracking("knowledgeService.createTopic", async () => {
            const [topic] = await db.insert(knowledgeTopics).values({
                name: input.name,
                description: input.description,
                parentTopicId: input.parentTopicId,
                organizationId: orgContext.organizationId,
                createdAt: new Date(),
                updatedAt: new Date(),
            }).returning();
            logger.info("Topic created", { topicId: topic.id });
            return topic;
        }, { table: "knowledge_topics", operation: "insert" });
    },

    async updateTopic(topicId: number, input: { name?: string; description?: string | null; parentTopicId?: number | null }, orgContext: OrgContext) {
        return withQueryTracking("knowledgeService.updateTopic", async () => {
            const current = await this.getTopicById(topicId, orgContext); // Verify access

            const [updated] = await db.update(knowledgeTopics)
                .set({ ...input, updatedAt: new Date() })
                .where(eq(knowledgeTopics.id, topicId))
                .returning();

            logger.info("Topic updated", { topicId });
            return updated;
        }, { table: "knowledge_topics", operation: "update" });
    },

    async deleteTopic(topicId: number, orgContext: OrgContext) {
        return withQueryTracking("knowledgeService.deleteTopic", async () => {
            await this.getTopicById(topicId, orgContext); // Verify access
            await db.delete(knowledgeTopics).where(eq(knowledgeTopics.id, topicId));
            logger.info("Topic deleted", { topicId });
        }, { table: "knowledge_topics", operation: "delete" });
    },

    /**
     * Get graph statistics
     */
    async getStats(orgContext: OrgContext): Promise<{
        totalNodes: number;
        totalEdges: number;
        nodesByType: Record<string, number>;
        edgesByType: Record<string, number>;
    }> {
        const orgNodeCond = orgContext.organizationId ? eq(knowledgeNodes.organizationId, orgContext.organizationId) : sql`1=1`;
        const orgEdgeCond = orgContext.organizationId ? eq(knowledgeEdges.organizationId, orgContext.organizationId) : sql`1=1`;

        // Aggregate queries — no full-row materialization
        const [nodeCounts, edgeCounts] = await Promise.all([
            db.select({ label: knowledgeNodes.label, count: sql<number>`count(*)::int` })
                .from(knowledgeNodes)
                .where(orgNodeCond)
                .groupBy(knowledgeNodes.label),
            db.select({ relation: knowledgeEdges.relation, count: sql<number>`count(*)::int` })
                .from(knowledgeEdges)
                .where(orgEdgeCond)
                .groupBy(knowledgeEdges.relation),
        ]);

        const nodesByType: Record<string, number> = {};
        let totalNodes = 0;
        for (const row of nodeCounts) {
            nodesByType[row.label] = Number(row.count);
            totalNodes += Number(row.count);
        }

        const edgesByType: Record<string, number> = {};
        let totalEdges = 0;
        for (const row of edgeCounts) {
            edgesByType[row.relation] = Number(row.count);
            totalEdges += Number(row.count);
        }

        return { totalNodes, totalEdges, nodesByType, edgesByType };
    },

    async getStagingStats(orgContext: OrgContext): Promise<any> {
        return withQueryTracking("knowledgeService.getStagingStats", async () => {
            const orgCondition = orgContext.organizationId ? eq(knowledgeNodes.organizationId, orgContext.organizationId) : sql`1=1`;

            const stats = await db.select({ status: knowledgeNodes.verificationStatus, label: knowledgeNodes.label, count: sql<number>`count(*)` })
                .from(knowledgeNodes).where(orgCondition).groupBy(knowledgeNodes.verificationStatus, knowledgeNodes.label);

            const topicStats = await db.select({ topicId: knowledgeNodes.knowledgeTopicId, topicName: knowledgeTopics.name, status: knowledgeNodes.verificationStatus, count: sql<number>`count(*)` })
                .from(knowledgeNodes).leftJoin(knowledgeTopics, eq(knowledgeNodes.knowledgeTopicId, knowledgeTopics.id)).where(orgCondition)
                .groupBy(knowledgeNodes.knowledgeTopicId, knowledgeTopics.name, knowledgeNodes.verificationStatus);

            const byStatus: Record<string, number> = { staging: 0, verified: 0, rejected: 0 };
            const byLabel: Record<string, any> = {};
            const byTopic: Record<string, any> = {};

            stats.forEach((row: any) => {
                const st = row.status as string || 'unknown';
                byStatus[st] = (byStatus[st] || 0) + Number(row.count);
                if (!byLabel[row.label]) byLabel[row.label] = { staging: 0, verified: 0, rejected: 0 };
                if (byLabel[row.label][st] !== undefined) byLabel[row.label][st] += Number(row.count);
            });

            topicStats.forEach((row: any) => {
                const key = row.topicId ? String(row.topicId) : 'none';
                if (!byTopic[key]) byTopic[key] = { id: row.topicId, name: row.topicName || '(No Topic)', staging: 0, verified: 0, rejected: 0 };
                const st = row.status as string || 'unknown';
                if (byTopic[key][st] !== undefined) byTopic[key][st] += Number(row.count);
            });

            return { byStatus, byLabel, byTopic, totalStaging: byStatus.staging };
        }, { table: 'knowledge_nodes', operation: 'select' });
    },

    async getDashboardStats(orgContext: OrgContext) {
        return withQueryTracking("knowledgeService.getDashboardStats", async () => {
            const orgCondition = orgContext.organizationId ? eq(knowledgeNodes.organizationId, orgContext.organizationId) : sql`1=1`;
            const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);


            // Main Stats — group by status only (not verifiedAt which has unique values per row)
            const stats = await db.select({ status: knowledgeNodes.verificationStatus, count: sql<number>`count(*)::int` })
                .from(knowledgeNodes).where(orgCondition).groupBy(knowledgeNodes.verificationStatus);

            // Count nodes verified/rejected today via a separate targeted query
            const recentActivity = await db.select({ status: knowledgeNodes.verificationStatus, count: sql<number>`count(*)::int` })
                .from(knowledgeNodes)
                .where(and(orgCondition, sql`verified_at >= ${todayStart}`))
                .groupBy(knowledgeNodes.verificationStatus);

            let [totalNodes, pendingApprovals] = [0, 0];
            stats.forEach((row: any) => {
                const count = Number(row.count);
                totalNodes += count;
                if (row.status === "staging") pendingApprovals += count;
            });

            let [verifiedToday, rejectedToday] = [0, 0];
            recentActivity.forEach((row: any) => {
                if (row.status === "verified") verifiedToday += Number(row.count);
                else if (row.status === "rejected") rejectedToday += Number(row.count);
            });

            const topPending = await db.select({ id: knowledgeNodes.id, name: knowledgeNodes.name, label: knowledgeNodes.label, confidenceScore: knowledgeNodes.confidenceScore, createdAt: knowledgeNodes.createdAt, topicName: knowledgeTopics.name })
                .from(knowledgeNodes).leftJoin(knowledgeTopics, eq(knowledgeNodes.knowledgeTopicId, knowledgeTopics.id))
                .where(and(orgCondition, eq(knowledgeNodes.verificationStatus, "staging"))).orderBy(desc(knowledgeNodes.confidenceScore)).limit(5);

            // Calculate topics summary
            const topicStatsRaw = await db.select({
                topicId: knowledgeNodes.knowledgeTopicId,
                topicName: knowledgeTopics.name,
                total: sql<number>`count(*)`,
                verified: sql<number>`count(case when ${knowledgeNodes.verificationStatus} = 'verified' then 1 end)`,
                staging: sql<number>`count(case when ${knowledgeNodes.verificationStatus} = 'staging' then 1 end)`
            })
                .from(knowledgeNodes)
                .leftJoin(knowledgeTopics, eq(knowledgeNodes.knowledgeTopicId, knowledgeTopics.id))
                .where(orgCondition)
                .groupBy(knowledgeNodes.knowledgeTopicId, knowledgeTopics.name);

            const topicsSummary = topicStatsRaw
                .filter(r => r.topicId !== null)
                .map(r => ({
                    id: r.topicId!,
                    name: r.topicName || 'Unknown Topic',
                    total: Number(r.total),
                    verified: Number(r.verified),
                    staging: Number(r.staging)
                }));

            // Dataset Stats
            const datasetOrgCondition = orgContext.organizationId
                ? eq(fineTuningDatasets.organizationId, orgContext.organizationId)
                : sql`1=1`;

            const [datasetCount] = await db.select({ count: sql<number>`count(*)` })
                .from(fineTuningDatasets)
                .where(datasetOrgCondition);

            const [exampleCount] = await db.select({ count: sql<number>`count(*)` })
                .from(fineTuningExamples)
                .innerJoin(fineTuningDatasets, eq(fineTuningExamples.datasetId, fineTuningDatasets.id))
                .where(datasetOrgCondition);

            // Recent Examples (last 5)
            const recentExamples = await db.select({
                id: fineTuningExamples.id,
                input: fineTuningExamples.input,
                output: fineTuningExamples.output,
                datasetId: fineTuningExamples.datasetId,
                datasetName: fineTuningDatasets.name,
                createdAt: fineTuningExamples.createdAt,
                humanConfidence: fineTuningExamples.humanConfidence
            })
                .from(fineTuningExamples)
                .innerJoin(fineTuningDatasets, eq(fineTuningExamples.datasetId, fineTuningDatasets.id))
                .where(datasetOrgCondition)
                .orderBy(desc(fineTuningExamples.createdAt))
                .limit(5);

            // Extraction Trends
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            sevenDaysAgo.setHours(0, 0, 0, 0);

            const extractionTrendsRaw = await db.select({
                date: sql<string>`date(${knowledgeNodes.createdAt})`,
                verified: sql<number>`count(case when ${knowledgeNodes.verificationStatus} = 'verified' then 1 end)`,
                staging: sql<number>`count(case when ${knowledgeNodes.verificationStatus} = 'staging' then 1 end)`,
                rejected: sql<number>`count(case when ${knowledgeNodes.verificationStatus} = 'rejected' then 1 end)`,
            })
                .from(knowledgeNodes)
                .where(and(orgCondition, sql`${knowledgeNodes.createdAt} >= ${sevenDaysAgo.toISOString()}`))
                .groupBy(sql`date(${knowledgeNodes.createdAt})`)
                .orderBy(sql`date(${knowledgeNodes.createdAt})`);

            // Fill in missing days
            const extractionTrends: { date: string; verified: number; staging: number; rejected: number }[] = [];
            const today = new Date();
            for (let i = 6; i >= 0; i--) {
                const d = new Date(today);
                d.setDate(d.getDate() - i);
                const dateStr = d.toISOString().split('T')[0];
                const existing = extractionTrendsRaw.find(r => r.date === dateStr);
                extractionTrends.push({
                    date: dateStr,
                    verified: Number(existing?.verified || 0),
                    staging: Number(existing?.staging || 0),
                    rejected: Number(existing?.rejected || 0)
                });
            }

            return {
                totalNodes,
                pendingApprovals,
                verifiedToday,
                rejectedToday,
                pendingNodes: topPending,
                topicsSummary,
                extractionTrends,
                datasetStats: {
                    totalDatasets: Number(datasetCount?.count || 0),
                    totalExamples: Number(exampleCount?.count || 0),
                    recentExamples: recentExamples.map(ex => ({
                        id: ex.id,
                        input: ex.input?.substring(0, 100) + (ex.input?.length > 100 ? '...' : ''),
                        output: ex.output?.substring(0, 100) + (ex.output?.length > 100 ? '...' : ''),
                        datasetId: ex.datasetId,
                        datasetName: ex.datasetName,
                        createdAt: ex.createdAt,
                        humanConfidence: ex.humanConfidence
                    }))
                }
            };
        }, { table: 'knowledge_nodes', operation: 'select' });
    },

    /**
     * Compare Pipeline Runs (Forensics)
     */
    async comparePipelineRuns(
        pipelineIds: number[],
        baselineWindow: { start_time: string; end_time: string },
        comparisonWindow: { start_time: string; end_time: string }
    ) {
        return withQueryTracking("knowledgeService.comparePipelineRuns", async () => {
            const { storage } = await import("@domain/knowledge/core/storage.service.js");

            const baselineExecutions = await storage.getPipelineExecutionsByTimeRange(
                pipelineIds,
                new Date(baselineWindow.start_time),
                new Date(baselineWindow.end_time)
            );
            const baselineNodes = await storage.getKnowledgeNodesByExecutionIds(baselineExecutions.map(e => e.id));

            const comparisonExecutions = await storage.getPipelineExecutionsByTimeRange(
                pipelineIds,
                new Date(comparisonWindow.start_time),
                new Date(comparisonWindow.end_time)
            );
            const comparisonNodes = await storage.getKnowledgeNodesByExecutionIds(comparisonExecutions.map(e => e.id));

            return {
                baselineResults: {
                    executionCount: baselineExecutions.length,
                    nodeCount: baselineNodes.length,
                    executions: baselineExecutions.map(e => ({ id: e.id, startedAt: e.startedAt, status: e.status })),
                    nodes: baselineNodes
                },
                comparisonResults: {
                    executionCount: comparisonExecutions.length,
                    nodeCount: comparisonNodes.length,
                    executions: comparisonExecutions.map(e => ({ id: e.id, startedAt: e.startedAt, status: e.status })),
                    nodes: comparisonNodes
                }
            };
        }, { table: "pipeline_executions", operation: "select" });
    },

    /**
     * Find shortest path between two nodes (BFS)
     */
    async findPath(sourceId: number, targetId: number, orgContext: OrgContext): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> {
        return withQueryTracking("knowledgeService.findPath", async () => {
            if (sourceId === targetId) {
                const node = await this.getNodeById(sourceId, orgContext);
                return { nodes: [node], edges: [] };
            }

            const MAX_DEPTH = 6;
            const MAX_NODES = 500;
            const queue: Array<{ id: number; depth: number }> = [{ id: sourceId, depth: 0 }];
            const visited = new Map<number, { parentId: number; edgeId: number } | null>();
            visited.set(sourceId, null);

            let reached = false;
            while (queue.length > 0 && !reached) {
                const { id: currentId, depth } = queue.shift()!;
                if (currentId === targetId) { reached = true; break; }
                if (depth >= MAX_DEPTH || visited.size > MAX_NODES) break;

                const edges = await this.getNodeEdges(currentId, orgContext, "both");
                for (const edge of edges) {
                    const neighborId = edge.sourceId === currentId ? edge.targetId : edge.sourceId;
                    if (!visited.has(neighborId)) {
                        visited.set(neighborId, { parentId: currentId, edgeId: edge.id });
                        queue.push({ id: neighborId, depth: depth + 1 });
                        if (neighborId === targetId) { reached = true; break; }
                    }
                }
            }

            if (!reached) return { nodes: [], edges: [] };

            // Reconstruct path
            const pathNodes: KnowledgeNode[] = [];
            const pathEdges: KnowledgeEdge[] = [];
            let curr = targetId;

            while (curr !== sourceId) {
                const info = visited.get(curr)!;
                pathNodes.push(await this.getNodeById(curr, orgContext));
                pathEdges.push(await this.getEdgeById(info.edgeId, orgContext));
                curr = info.parentId;
            }
            pathNodes.push(await this.getNodeById(sourceId, orgContext));

            return { nodes: pathNodes.reverse(), edges: pathEdges.reverse() };
        }, { table: "knowledge_edges", operation: "select" });
    },
    /**
     * Compare two pipeline executions to find added, removed, and changed nodes/edges.
     */
    async compareExecutions(baselineRunId: number, candidateRunId: number, orgContext: OrgContext) {
        return withQueryTracking("knowledgeService.compareExecutions", async () => {
            const [baseline, candidate] = await Promise.all([
                this.getRunContext(baselineRunId, orgContext),
                this.getRunContext(candidateRunId, orgContext)
            ]);

            // Helper to generate unique key for logical entity comparison
            const getNodeKey = (n: KnowledgeNode) => n.externalId || `${n.label}:${n.name}`;

            // Helper to generate content hash/fingerprint if not present
            const getNodeHash = (n: KnowledgeNode) => n.fingerprint || JSON.stringify(n.data);

            const baselineMap = new Map<string, KnowledgeNode>();
            baseline.nodes.forEach(n => baselineMap.set(getNodeKey(n), n));

            const added: KnowledgeNode[] = [];
            const removed: KnowledgeNode[] = [];
            const changed: { from: KnowledgeNode, to: KnowledgeNode }[] = [];
            const unchanged: KnowledgeNode[] = [];

            // 1. Compare Nodes
            for (const node of candidate.nodes) {
                const key = getNodeKey(node);
                const baseNode = baselineMap.get(key);

                if (!baseNode) {
                    added.push(node);
                } else {
                    // Start by assuming unchanged
                    let isChanged = false;

                    // If fingerprints exist, use them
                    if (node.fingerprint && baseNode.fingerprint) {
                        if (node.fingerprint !== baseNode.fingerprint) isChanged = true;
                    } else {
                        // Fallback to data content comparison
                        if (getNodeHash(node) !== getNodeHash(baseNode)) isChanged = true;
                    }

                    if (isChanged) {
                        changed.push({ from: baseNode, to: node });
                    } else {
                        unchanged.push(node);
                    }
                    baselineMap.delete(key);
                }
            }

            // Remaining in baseline are removed
            baselineMap.forEach(node => removed.push(node));

            // 2. Compare Edges — resolve source/target IDs to logical node keys
            const allBaselineNodes = new Map<number, KnowledgeNode>(baseline.nodes.map(n => [n.id, n]));
            const allCandidateNodes = new Map<number, KnowledgeNode>(candidate.nodes.map(n => [n.id, n]));

            const edgeKey = (
                nodeMap: Map<number, KnowledgeNode>,
                sourceId: number,
                relation: string,
                targetId: number
            ): string => {
                const srcKey = nodeMap.has(sourceId) ? getNodeKey(nodeMap.get(sourceId)!) : String(sourceId);
                const tgtKey = nodeMap.has(targetId) ? getNodeKey(nodeMap.get(targetId)!) : String(targetId);
                return `${srcKey}::${relation}::${tgtKey}`;
            };

            const baselineEdgeMap = new Map<string, KnowledgeEdge>();
            baseline.edges.forEach(e => {
                baselineEdgeMap.set(edgeKey(allBaselineNodes, e.sourceId, e.relation, e.targetId), e);
            });

            const addedEdges: KnowledgeEdge[] = [];
            const removedEdges: KnowledgeEdge[] = [];
            const unchangedEdges: KnowledgeEdge[] = [];

            for (const edge of candidate.edges) {
                const key = edgeKey(allCandidateNodes, edge.sourceId, edge.relation, edge.targetId);
                if (baselineEdgeMap.has(key)) {
                    unchangedEdges.push(edge);
                    baselineEdgeMap.delete(key);
                } else {
                    addedEdges.push(edge);
                }
            }
            baselineEdgeMap.forEach(e => removedEdges.push(e));

            return {
                nodes: {
                    added,
                    removed,
                    changed,
                    unchanged
                },
                edges: {
                    added: addedEdges,
                    removed: removedEdges,
                    unchanged: unchangedEdges,
                    baselineCount: baseline.edges.length,
                    candidateCount: candidate.edges.length
                }
            };

        }, { operation: "select" });
    },

    /**
     * Analysis Session Management
     */
    async createSession(input: CreateAnalysisSessionInput, orgContext: OrgContext) {
        return withQueryTracking("knowledgeService.createSession", async () => {
            const [session] = await db.insert(analysisSessions).values({
                ...input,
                organizationId: orgContext.organizationId,
                createdBy: orgContext.userId.toString(),
            }).returning();
            return session;
        }, { table: "analysis_sessions", operation: "insert" });
    },

    async getSession(id: number, orgContext: OrgContext) {
        return withQueryTracking("knowledgeService.getSession", async () => {
            const [session] = await db.select().from(analysisSessions)
                .where(and(
                    eq(analysisSessions.id, id),
                    orgContext.organizationId !== null
                        ? eq(analysisSessions.organizationId, orgContext.organizationId)
                        : sql`${analysisSessions.organizationId} IS NULL`
                ));

            if (!session) throw new NotFoundError(`Session not found with ID ${id}`);
            return session;
        }, { table: "analysis_sessions", operation: "select" });
    },

    async listSessions(orgContext: OrgContext, limit = 100) {
        return withQueryTracking("knowledgeService.listSessions", async () => {
            return db.select().from(analysisSessions)
                .where(eq(analysisSessions.organizationId, orgContext.organizationId as number))
                .orderBy(desc(analysisSessions.updatedAt))
                .limit(limit);
        }, { table: "analysis_sessions", operation: "select" });
    },

    /**
     * Re-index ALL knowledge documents
     */
    async reindexAllDocuments(orgContext: OrgContext): Promise<{ count: number; errors: number }> {
        return withQueryTracking("knowledgeService.reindexAllDocuments", async () => {
            const orgId = orgContext.organizationId as number || 0;
            const conditions = getOrgConditions(orgContext, knowledgeDocuments);
            const docs = await db.select().from(knowledgeDocuments).where(and(...conditions));

            reindexProgress.set(orgId, {
                total: docs.length,
                processed: 0,
                errors: 0,
                active: true,
                lastUpdated: new Date()
            });

            let errors = 0;
            let processed = 0;
            for (const doc of docs) {
                try {
                    await reindexKnowledgeDocument(doc);
                } catch (error) {
                    console.error(`Failed to reindex document ${doc.id}`, error);
                    errors++;
                } finally {
                    processed++;
                    reindexProgress.set(orgId, {
                        total: docs.length,
                        processed,
                        errors,
                        active: processed < docs.length,
                        lastUpdated: new Date()
                    });
                }
            }

            // Final update to mark as inactive once all are processed
            reindexProgress.set(orgId, {
                total: docs.length,
                processed,
                errors,
                active: false,
                lastUpdated: new Date()
            });

            return { count: docs.length, errors };
        }, { table: "knowledge_documents", operation: "update" });
    },

    /**
     * Get reindex status for an organization
     */
    async getReindexStatus(orgId: number) {
        return reindexProgress.get(orgId) || { active: false, total: 0, processed: 0, errors: 0, lastUpdated: new Date(0) };
    }
};

export default knowledgeService;


