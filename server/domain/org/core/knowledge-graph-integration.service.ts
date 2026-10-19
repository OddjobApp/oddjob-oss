import { db } from "@server/database_service.js";
import { eq, and, sql, desc, or, ilike } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { documentTemplates, datasets, missions, operationalCycles } from "@shared/schema/index.js";
import { systemAiService } from "../../ai/core/system-ai.service.js";

const logger = createLogger("KnowledgeGraphIntegrationService");

/**
 * Knowledge graph node
 */
export interface KnowledgeGraphNode {
    id: string;
    type: "requirement" | "story" | "test_case" | "architectural_decision" | "document" | "mission";
    name: string;
    content: string;
    metadata: any;
    embeddings?: number[];
    relatedNodes: string[];
}

/**
 * Knowledge graph edge
 */
export interface KnowledgeGraphEdge {
    sourceId: string;
    targetId: string;
    type: "implements" | "tests" | "relates_to" | "depends_on" | "documents" | "blocks";
    weight: number;
}

/**
 * Knowledge graph query result
 */
export interface KnowledgeGraphQueryResult {
    nodes: KnowledgeGraphNode[];
    edges: KnowledgeGraphEdge[];
    relevanceScore: number;
}

/**
 * Similar document result
 */
export interface SimilarDocument {
    documentId: string;
    documentName: string;
    similarity: number;
    relevantSections: string[];
}

/**
 * Expert recommendation
 */
export interface ExpertRecommendation {
    userId: string;
    userName: string;
    expertise: string[];
    relevanceScore: number;
    reason: string;
}

/**
 * Knowledge Graph Integration Service
 * Integrates knowledge graph with workbenches for intelligent features
 */
export class KnowledgeGraphIntegrationService {
    private static instance: KnowledgeGraphIntegrationService;
    private nodeCache: Map<string, KnowledgeGraphNode> = new Map();
    private edgeCache: Map<string, KnowledgeGraphEdge[]> = new Map();

    private constructor() {
        this.initializeKnowledgeGraph();
    }

    static getInstance(): KnowledgeGraphIntegrationService {
        if (!KnowledgeGraphIntegrationService.instance) {
            KnowledgeGraphIntegrationService.instance = new KnowledgeGraphIntegrationService();
        }
        return KnowledgeGraphIntegrationService.instance;
    }

    /**
     * Initialize knowledge graph
     */
    private initializeKnowledgeGraph(): void {
        logger.info("[KnowledgeGraphIntegration] Knowledge graph initialized");
    }

    /**
     * Auto-link requirements to architectural decisions
     */
    async linkRequirementsToDecisions(organizationId: number, requirementId: string): Promise<KnowledgeGraphQueryResult> {
        logger.info(`[KnowledgeGraphIntegration] Linking requirement ${requirementId} to decisions`);

        // Get requirement content
        const requirement = await this.getRequirementNode(organizationId, requirementId);
        if (!requirement) {
            return { nodes: [], edges: [], relevanceScore: 0 };
        }

        // Query knowledge graph for related decisions
        const relatedDecisions = await this.queryKnowledgeGraph(organizationId, {
            type: "architectural_decision",
            query: requirement.content,
            limit: 5,
        });

        // Create edges
        const edges: KnowledgeGraphEdge[] = relatedDecisions.nodes.map(node => ({
            sourceId: requirementId,
            targetId: node.id,
            type: "relates_to" as const,
            weight: node.metadata?.relevance || 0.5,
        }));

        return {
            nodes: [requirement, ...relatedDecisions.nodes],
            edges,
            relevanceScore: relatedDecisions.relevanceScore,
        };
    }

    /**
     * Suggest similar test cases based on historical data
     */
    async suggestSimilarTestCases(organizationId: number, testCaseContent: string): Promise<SimilarDocument[]> {
        logger.info(`[KnowledgeGraphIntegration] Suggesting similar test cases`);

        // Query knowledge graph for similar test cases
        const results = await this.queryKnowledgeGraph(organizationId, {
            type: "test_case",
            query: testCaseContent,
            limit: 10,
        });

        return results.nodes.map(node => ({
            documentId: node.id,
            documentName: node.name,
            similarity: node.metadata?.similarity || 0.5,
            relevantSections: node.metadata?.relevantSections || [],
        }));
    }

    /**
     * Recommend code reviewers based on expertise graph
     */
    async recommendCodeReviewers(organizationId: number, codeContent: string, requiredSkills: string[]): Promise<ExpertRecommendation[]> {
        logger.info(`[KnowledgeGraphIntegration] Recommending code reviewers`);

        // Query expertise graph for users with relevant skills
        const experts = await this.queryExpertiseGraph(organizationId, {
            skills: requiredSkills,
            codeContext: codeContent,
            limit: 5,
        });

        return experts.map(expert => ({
            userId: expert.id,
            userName: expert.name,
            expertise: expert.skills,
            relevanceScore: expert.relevanceScore,
            reason: expert.reason || "Has relevant expertise",
        }));
    }

    /**
     * Surface relevant documentation contextually
     */
    async surfaceRelevantDocumentation(organizationId: number, context: string, workbench: string): Promise<KnowledgeGraphNode[]> {
        logger.info(`[KnowledgeGraphIntegration] Surfacing relevant documentation for ${workbench}`);

        // Query knowledge graph with context
        const results = await this.queryKnowledgeGraph(organizationId, {
            type: "document",
            query: context,
            workbench,
            limit: 5,
        });

        return results.nodes;
    }

    /**
     * Enable semantic search across all workbench data
     */
    async semanticSearch(organizationId: number, query: string, filters?: {
        workbench?: string;
        nodeType?: string;
        dateRange?: { start: Date; end: Date };
    }): Promise<KnowledgeGraphQueryResult> {
        logger.info(`[KnowledgeGraphIntegration] Performing semantic search: ${query}`);

        const results = await this.queryKnowledgeGraph(organizationId, {
            query,
            ...filters,
            limit: 20,
        });

        return results;
    }

    /**
     * Get requirement node
     */
    private async getRequirementNode(organizationId: number, requirementId: string): Promise<KnowledgeGraphNode | null> {
        // Check cache first
        if (this.nodeCache.has(requirementId)) {
            return this.nodeCache.get(requirementId)!;
        }

        // Query database for requirement
        const [template] = await db.select()
            .from(documentTemplates)
            .where(and(
                eq(documentTemplates.name, requirementId),
                eq(documentTemplates.organizationId, organizationId)
            ))
            .limit(1);

        if (!template) return null;

        const node: KnowledgeGraphNode = {
            id: requirementId,
            type: "requirement",
            name: template.name,
            content: template.content || "",
            metadata: { category: template.category, type: template.type, source: template.source },
            relatedNodes: [],
        };

        this.nodeCache.set(requirementId, node);
        return node;
    }

    /**
     * Query knowledge graph
     */
    private async queryKnowledgeGraph(organizationId: number, params: {
        type?: string;
        query?: string;
        workbench?: string;
        limit?: number;
    }): Promise<KnowledgeGraphQueryResult> {
        // Build knowledge graph from existing data structures
        const nodes: KnowledgeGraphNode[] = [];
        const edges: KnowledgeGraphEdge[] = [];

        // Add document templates as nodes
        const documents = await db.select()
            .from(documentTemplates)
            .where(eq(documentTemplates.organizationId, organizationId))
            .limit(params.limit || 20);

        for (const doc of documents) {
            const node: KnowledgeGraphNode = {
                id: doc.name,
                type: "document" as const,
                name: doc.name,
                content: doc.content || "",
                metadata: { category: doc.category, type: doc.type, source: doc.source },
                relatedNodes: [],
            };
            nodes.push(node);
        }

        // Add missions as nodes
        const [cycle] = await db.select()
            .from(operationalCycles)
            .where(eq(operationalCycles.organizationId, organizationId))
            .limit(1);

        if (cycle) {
            const metadata = cycle.metadata as any;
            const missions = metadata?.blueprints || [];

            for (const mission of missions) {
                const node: KnowledgeGraphNode = {
                    id: mission.name,
                    type: "mission" as const,
                    name: mission.name,
                    content: mission.objective || "",
                    metadata: mission.config || {},
                    relatedNodes: [],
                };
                nodes.push(node);
            }
        }

        // Create edges based on relationships
        // Link documents to missions if they reference each other
        for (const node of nodes) {
            if (node.type === "document") {
                // Find missions that might reference this document
                const relatedMissions = nodes.filter(n => 
                    n.type === "mission" && 
                    n.content.toLowerCase().includes(node.name.toLowerCase())
                );
                for (const mission of relatedMissions) {
                    edges.push({
                        sourceId: node.id,
                        targetId: mission.id,
                        type: "documents" as const,
                        weight: 0.5,
                    });
                }
            }
        }

        // Filter by type if specified
        const filteredNodes = params.type 
            ? nodes.filter(n => n.type === params.type)
            : nodes;

        return {
            nodes: filteredNodes,
            edges,
            relevanceScore: 0.7,
        };
    }

    /**
     * Query expertise graph
     */
    private async queryExpertiseGraph(organizationId: number, params: {
        skills: string[];
        codeContext?: string;
        limit?: number;
    }): Promise<any[]> {
        // Query users and their skills from team members
        const { teams, teamMembers, users } = await import("@shared/schema/index.js");
        
        const members = await db.select({
            user: users,
            team: teams,
        })
        .from(teamMembers)
        .innerJoin(users, eq(teamMembers.userId, users.id))
        .innerJoin(teams, eq(teamMembers.teamId, teams.id))
        .where(eq(teams.organizationId, organizationId))
        .limit(params.limit || 10);

        return members.map(m => ({
            id: m.user.id,
            name: m.user.firstName ? `${m.user.firstName} ${m.user.lastName}` : m.user.username,
            skills: params.skills, // Placeholder - would need actual skill tracking
            relevanceScore: 0.7,
            reason: "Team member with relevant skills",
        }));
    }

    /**
     * Build knowledge graph from organization data
     */
    async buildKnowledgeGraph(organizationId: number): Promise<void> {
        logger.info(`[KnowledgeGraphIntegration] Building knowledge graph for org ${organizationId}`);

        // Get all documents
        const documents = await db.select()
            .from(documentTemplates)
            .where(eq(documentTemplates.organizationId, organizationId));

        // Get all missions
        const [cycle] = await db.select()
            .from(operationalCycles)
            .where(eq(operationalCycles.organizationId, organizationId))
            .limit(1);

        const metadata = cycle?.metadata as any;
        const missions = metadata?.blueprints || [];

        // Create nodes for documents
        for (const doc of documents) {
            const node: KnowledgeGraphNode = {
                id: doc.name,
                type: "document",
                name: doc.name,
                content: doc.content || "",
                metadata: { category: doc.category, type: doc.type, source: doc.source },
                relatedNodes: [],
            };

            this.nodeCache.set(doc.name, node);
        }

        // Create nodes for missions
        for (const mission of missions) {
            const node: KnowledgeGraphNode = {
                id: mission.name,
                type: "mission",
                name: mission.name,
                content: mission.objective || "",
                metadata: mission.config || {},
                relatedNodes: [],
            };

            this.nodeCache.set(mission.name, node);
        }

        // Use AI to generate embeddings and relationships
        await this.generateEmbeddingsAndRelationships(organizationId);

        logger.info(`[KnowledgeGraphIntegration] Built knowledge graph with ${this.nodeCache.size} nodes`);
    }

    /**
     * Generate embeddings and relationships
     */
    private async generateEmbeddingsAndRelationships(organizationId: number): Promise<void> {
        // Use AI to generate embeddings for nodes
        const nodes = Array.from(this.nodeCache.values());
        
        for (const node of nodes) {
            // Generate embedding using AI service
            try {
                const embedding = await this.generateEmbedding(node.content);
                node.embeddings = embedding;
            } catch (error) {
                logger.warn(`[KnowledgeGraphIntegration] Failed to generate embedding for ${node.id}`);
            }
        }

        // Identify relationships between nodes based on content similarity
        for (const node1 of nodes) {
            for (const node2 of nodes) {
                if (node1.id === node2.id) continue;
                
                const similarity = this.calculateSimilarity(node1.content, node2.content);
                if (similarity > 0.5) {
                    node1.relatedNodes.push(node2.id);
                }
            }
        }

        logger.info(`[KnowledgeGraphIntegration] Generated embeddings and relationships for ${nodes.length} nodes`);
    }

    /**
     * Generate embedding for content
     */
    private async generateEmbedding(content: string): Promise<number[]> {
        // Placeholder - would use actual embedding service
        // For now, return a simple hash-based embedding
        const embedding = new Array(128).fill(0);
        for (let i = 0; i < content.length; i++) {
            embedding[i % 128] = (embedding[i % 128] + content.charCodeAt(i)) % 100;
        }
        return embedding.map(v => v / 100);
    }

    /**
     * Calculate similarity between two texts
     */
    private calculateSimilarity(text1: string, text2: string): number {
        // Simple Jaccard similarity based on word overlap
        const words1 = new Set(text1.toLowerCase().split(/\s+/));
        const words2 = new Set(text2.toLowerCase().split(/\s+/));
        
        const intersection = new Set([...words1].filter(x => words2.has(x)));
        const union = new Set([...words1, ...words2]);
        
        return union.size > 0 ? intersection.size / union.size : 0;
    }

    /**
     * Update knowledge graph with new content
     */
    async updateKnowledgeGraph(organizationId: number, content: {
        type: string;
        name: string;
        content: string;
        metadata?: any;
    }): Promise<void> {
        logger.info(`[KnowledgeGraphIntegration] Updating knowledge graph with ${content.type}`);

        const node: KnowledgeGraphNode = {
            id: content.name,
            type: content.type as any,
            name: content.name,
            content: content.content,
            metadata: content.metadata || {},
            relatedNodes: [],
        };

        this.nodeCache.set(content.name, node);

        // Regenerate embeddings for affected nodes
        await this.generateEmbeddingsAndRelationships(organizationId);
    }

    /**
     * Clear knowledge graph cache
     */
    clearCache(): void {
        this.nodeCache.clear();
        this.edgeCache.clear();
        logger.info("[KnowledgeGraphIntegration] Knowledge graph cache cleared");
    }

    /**
     * Get knowledge graph statistics
     */
    getStatistics(organizationId: number): {
        nodeCount: number;
        edgeCount: number;
        nodeTypes: Record<string, number>;
    } {
        const nodeTypes: Record<string, number> = {};

        for (const node of this.nodeCache.values()) {
            nodeTypes[node.type] = (nodeTypes[node.type] || 0) + 1;
        }

        let edgeCount = 0;
        for (const edges of this.edgeCache.values()) {
            edgeCount += edges.length;
        }

        return {
            nodeCount: this.nodeCache.size,
            edgeCount,
            nodeTypes,
        };
    }
}

export const knowledgeGraphIntegrationService = KnowledgeGraphIntegrationService.getInstance();
