/**
 * Mission Context Enrichment Service
 *
 * Auto-populates mission blackboard with relevant knowledge graph insights
 * to reduce manual context setup and improve mission accuracy.
 *
 * Features:
 * - Semantic similarity search against knowledge graph
 * - Relationship depth traversal for context discovery
 * - Entity extraction from mission objective
 * - Auto-context scoring and relevance ranking
 * - Blackboard auto-population with structured context
 */

import { createLogger } from "@server/utils/logger.js";
import { getSystemOrgContext } from "@server/utils/auth-context.js";
import { db } from "@server/database_service.js";
import { eq, and, or, isNull, sql, desc, inArray } from "drizzle-orm";
import {
  missions,
  missionMembers,
} from "@shared/schema/missions/core.js";
import { pipelineSteps, pipelines } from "@shared/schema/pipelines/index.js";
import { jobs } from "@shared/schema/jobs/index.js";
import { knowledgeEdges } from "@shared/schema/knowledge/graph.js";
import { graphService } from "@domain/knowledge/core/graph/graph-service.js";
import { topicService } from "@domain/knowledge/core/topic-service.js";

const logger = createLogger("MissionContextEnrichment");

export interface EnrichmentConfig {
  maxEntities?: number;
  relationshipDepth?: number;
  minRelevanceScore?: number;
  includeRelatedMissions?: boolean;
  autoPopulate?: boolean;
}

export interface EnrichedContext {
  entities: KnowledgeEntity[];
  relationships: EntityRelationship[];
  relatedMissions: RelatedMission[];
  suggestedActions: SuggestedAction[];
  relevanceScore: number;
  confidence: number;
}

export interface KnowledgeEntity {
  id: number;
  name: string;
  type: string;
  label: string;
  fingerprint: string | null;
  data: any;
  relevanceScore: number;
  source: "direct" | "related" | "inferred";
}

export interface EntityRelationship {
  sourceId: number;
  targetId: number;
  sourceName: string;
  targetName: string;
  relation: string;
  weight: number | null;
}

export interface RelatedMission {
  missionId: number;
  missionName: string;
  objective: string;
  similarity: number;
  outcome: string;
  keyLearnings: string[];
}

export interface SuggestedAction {
  type: "pipeline" | "job" | "knowledge_topic" | "dataset";
  id: number;
  name: string;
  reason: string;
  confidence: number;
}

const DEFAULT_CONFIG: EnrichmentConfig = {
  maxEntities: 20,
  relationshipDepth: 2,
  minRelevanceScore: 0.6,
  includeRelatedMissions: true,
  autoPopulate: true,
};

export const missionContextEnrichmentService = {
  /**
   * Main entry point: enrich a mission with knowledge context
   */
  async enrichMissionContext(
    missionId: number,
    config: EnrichmentConfig = {}
  ): Promise<EnrichedContext> {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    logger.info(
      `[ContextEnrichment] Enriching mission ${missionId} with depth ${mergedConfig.relationshipDepth}`
    );

    try {
      // 1. Get mission details
      const mission = await this.getMissionDetails(missionId);
      if (!mission) {
        throw new Error(`Mission ${missionId} not found`);
      }

      // 2. Extract entities from mission objective
      const extractedEntities = await this.extractEntitiesFromObjective(
        mission.objective || mission.name,
        mission.organizationId
      );

      // 3. Find knowledge nodes by semantic similarity
      const semanticMatches = await this.findSemanticMatches(
        mission.objective || mission.name,
        mission.organizationId,
        mergedConfig.maxEntities!
      );

      // 4. Get related entities by traversing knowledge graph
      const relatedEntities = await this.traverseKnowledgeGraph(
        [...extractedEntities, ...semanticMatches],
        mergedConfig.relationshipDepth!,
        mergedConfig.maxEntities!,
        mission.organizationId
      );

      // 5. Deduplicate and rank all entities
      const allEntities = this.deduplicateAndRank([
        ...extractedEntities,
        ...semanticMatches,
        ...relatedEntities,
      ]);

      // 6. Get relationships between entities
      const relationships = await this.getEntityRelationships(
        allEntities,
        mission.organizationId
      );

      // 7. Find related missions by similarity
      let relatedMissions: RelatedMission[] = [];
      if (mergedConfig.includeRelatedMissions) {
        relatedMissions = await this.findRelatedMissions(
          missionId,
          mission.objective || mission.name,
          mission.organizationId
        );
      }

      // 8. Generate suggested actions based on context
      const suggestedActions = await this.generateSuggestedActions(
        allEntities,
        relationships,
        mission.organizationId
      );

      // 9. Calculate overall confidence
      const confidence = this.calculateConfidence(
        allEntities,
        relatedMissions,
        suggestedActions
      );

      const enrichedContext: EnrichedContext = {
        entities: allEntities.slice(0, mergedConfig.maxEntities),
        relationships,
        relatedMissions: relatedMissions.slice(0, 5),
        suggestedActions: suggestedActions.slice(0, 10),
        relevanceScore: this.calculateRelevanceScore(allEntities),
        confidence,
      };

      // 10. Auto-populate blackboard if enabled
      if (mergedConfig.autoPopulate && enrichedContext.confidence > 0.7) {
        await this.populateBlackboard(missionId, enrichedContext);
      }

      logger.info(
        `[ContextEnrichment] Mission ${missionId} enriched with ${enrichedContext.entities.length} entities, ${enrichedContext.relationships.length} relationships`
      );

      return enrichedContext;
    } catch (error: any) {
      logger.error(
        `[ContextEnrichment] Failed to enrich mission ${missionId}:`,
        error.message
      );
      throw error;
    }
  },

  /**
   * Get mission details from database
   */
  async getMissionDetails(missionId: number): Promise<
    | {
        id: number;
        name: string;
        objective: string | null;
        description: string | null;
        organizationId: number | null;
        blackboard: any;
      }
    | undefined
  > {
    const [mission] = await db
      .select({
        id: missions.id,
        name: missions.name,
        objective: missions.objective,
        description: missions.description,
        organizationId: missions.organizationId,
        blackboard: missions.blackboard,
      })
      .from(missions)
      .where(eq(missions.id, missionId))
      .limit(1);

    return mission;
  },

  /**
   * Extract entities from mission objective using keyword analysis
   */
  async extractEntitiesFromObjective(
    objective: string,
    organizationId: number | null
  ): Promise<KnowledgeEntity[]> {
    // Extract key terms from objective
    const terms = this.extractKeyTerms(objective);
    if (terms.length === 0) return [];

    // Search knowledge nodes matching these terms
    const matchingNodes: any[] = [];
    const orgContext = getSystemOrgContext(organizationId);
    
    for (const term of terms) {
      const { nodes } = await graphService.searchNodes(orgContext, { query: term, limit: 10 });
      matchingNodes.push(...nodes);
    }
    
    // Deduplicate
    const uniqueNodes = Array.from(new Map(matchingNodes.map(n => [n.id, n])).values());

    return uniqueNodes.map((node) => ({
      ...node,
      type: node.label,
      relevanceScore: this.calculateTermMatchScore(node.name, terms),
      source: "direct" as const,
    }));
  },

  /**
   * Extract key terms from text
   */
  extractKeyTerms(text: string): string[] {
    // Remove common stop words and extract meaningful terms
    const stopWords = new Set([
      "the",
      "a",
      "an",
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "being",
      "have",
      "has",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "could",
      "should",
      "may",
      "might",
      "must",
      "shall",
      "can",
      "need",
      "dare",
      "ought",
      "used",
      "to",
      "of",
      "in",
      "for",
      "on",
      "with",
      "at",
      "by",
      "from",
      "as",
      "into",
      "through",
      "during",
      "before",
      "after",
      "above",
      "below",
      "between",
      "under",
      "and",
      "or",
      "but",
      "so",
      "yet",
      "that",
      "which",
      "who",
      "whom",
      "whose",
      "what",
      "this",
      "these",
      "those",
      "i",
      "me",
      "my",
      "myself",
      "we",
      "our",
      "ours",
      "ourselves",
      "you",
      "your",
      "yours",
      "yourself",
      "yourselves",
      "he",
      "him",
      "his",
      "himself",
      "she",
      "her",
      "hers",
      "herself",
      "it",
      "its",
      "itself",
      "they",
      "them",
      "their",
      "theirs",
      "themselves",
    ]);

    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.has(word))
      .slice(0, 10);
  },

  /**
   * Find knowledge nodes by semantic similarity to objective
   */
  async findSemanticMatches(
    objective: string,
    organizationId: number | null,
    maxResults: number
  ): Promise<KnowledgeEntity[]> {
    const orgContext = getSystemOrgContext(organizationId);
    
    // Get recent knowledge nodes as candidates for semantic matching
    const { nodes: candidates } = await graphService.searchNodes(orgContext, { limit: 100 });

    // Calculate semantic similarity (simplified word overlap)
    const objectiveTerms = new Set(this.extractKeyTerms(objective));

    const scored = candidates.map((node) => {
      const nodeTerms = new Set(this.extractKeyTerms(node.name));
      const intersection = new Set(
        [...objectiveTerms].filter((x) => nodeTerms.has(x))
      );
      const similarity =
        intersection.size /
        Math.sqrt(objectiveTerms.size * nodeTerms.size || 1);

      return {
        ...node,
        type: node.label,
        relevanceScore: similarity,
        source: "related" as const,
      };
    });

    return scored
      .filter((n) => n.relevanceScore > 0.1)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, maxResults);
  },

  /**
   * Traverse knowledge graph to find related entities
   */
  async traverseKnowledgeGraph(
    seedEntities: KnowledgeEntity[],
    depth: number,
    maxResults: number,
    organizationId: number | null
  ): Promise<KnowledgeEntity[]> {
    if (depth <= 0 || seedEntities.length === 0) return [];

    const seedIds = seedEntities.map((e) => e.id);
    const foundIds = new Set(seedIds);
    const results: KnowledgeEntity[] = [];
    const orgContext = getSystemOrgContext(organizationId);

    // Get edges from seed entities
    const edges = await graphService.getNodeEdgesBatch(seedIds, orgContext, "both");

    // Get connected node IDs
    const connectedIds = edges.flatMap((e) => [e.sourceId, e.targetId]);
    const newIds = connectedIds.filter((id) => !foundIds.has(id));

    if (newIds.length === 0) return [];

    // Fetch connected nodes
    const connectedNodes = await graphService.getNodesByIds(newIds, orgContext);

    // Calculate relevance based on edge weights and distance
    const scoredNodes = connectedNodes.map((node) => {
      const nodeEdges = edges.filter(
        (e) => e.sourceId === node.id || e.targetId === node.id
      );
      const maxWeight = Math.max(...nodeEdges.map((e) => e.weight || 1), 1);
      const distancePenalty = Math.pow(0.5, 1); // depth 1

      return {
        ...node,
        type: node.label,
        relevanceScore: (maxWeight / 10) * distancePenalty * 0.7, // Lower score for indirect
        source: "inferred" as const,
      };
    });

    results.push(...scoredNodes);

    // Recurse if depth > 1
    if (depth > 1 && results.length > 0) {
      const deeper = await this.traverseKnowledgeGraph(
        scoredNodes,
        depth - 1,
        maxResults - results.length,
        organizationId
      );
      results.push(...deeper);
    }

    return results.slice(0, maxResults);
  },

  /**
   * Deduplicate entities and keep highest relevance scores
   */
  deduplicateAndRank(entities: KnowledgeEntity[]): KnowledgeEntity[] {
    const byId = new Map<number, KnowledgeEntity>();

    for (const entity of entities) {
      const existing = byId.get(entity.id);
      if (!existing || entity.relevanceScore > existing.relevanceScore) {
        byId.set(entity.id, entity);
      }
    }

    return Array.from(byId.values()).sort(
      (a, b) => b.relevanceScore - a.relevanceScore
    );
  },

  /**
   * Get relationships between entities
   */
  async getEntityRelationships(
    entities: KnowledgeEntity[],
    organizationId: number | null
  ): Promise<EntityRelationship[]> {
    const entityIds = entities.map((e) => e.id);
    if (entityIds.length < 2) return [];

    const orgFilter = organizationId
      ? eq(knowledgeEdges.organizationId, organizationId)
      : isNull(knowledgeEdges.organizationId);

    const edges = await db
      .select({
        sourceId: knowledgeEdges.sourceId,
        targetId: knowledgeEdges.targetId,
        relation: knowledgeEdges.relation,
        weight: knowledgeEdges.weight,
      })
      .from(knowledgeEdges)
      .where(
        and(
          inArray(knowledgeEdges.sourceId, entityIds),
          inArray(knowledgeEdges.targetId, entityIds),
          orgFilter
        )
      );

    const entityMap = new Map(entities.map((e) => [e.id, e.name]));

    return edges.map((edge) => ({
      ...edge,
      sourceName: entityMap.get(edge.sourceId) || "Unknown",
      targetName: entityMap.get(edge.targetId) || "Unknown",
    }));
  },

  /**
   * Find related missions by objective similarity
   */
  async findRelatedMissions(
    currentMissionId: number,
    objective: string,
    organizationId: number | null
  ): Promise<RelatedMission[]> {
    const orgFilter = organizationId
      ? eq(missions.organizationId, organizationId)
      : isNull(missions.organizationId);

    const pastMissions = await db
      .select({
        id: missions.id,
        name: missions.name,
        objective: missions.objective,
        blackboard: missions.blackboard,
      })
      .from(missions)
      .where(
        and(
          orgFilter,
          eq(missions.status, "completed"),
          sql`${missions.id} != ${currentMissionId}`
        )
      )
      .orderBy(desc(missions.createdAt))
      .limit(50);

    const objectiveTerms = new Set(this.extractKeyTerms(objective));

    const scored = pastMissions.map((m) => {
      const missionText = `${m.name} ${m.objective || ""}`;
      const missionTerms = new Set(this.extractKeyTerms(missionText));
      const intersection = new Set(
        [...objectiveTerms].filter((x) => missionTerms.has(x))
      );
      const similarity =
        intersection.size /
        Math.sqrt(objectiveTerms.size * missionTerms.size || 1);

      const outcome = m.blackboard?.outcome || "completed";
      const keyLearnings = m.blackboard?.keyLearnings || [];

      return {
        missionId: m.id,
        missionName: m.name,
        objective: m.objective || "",
        similarity,
        outcome,
        keyLearnings: Array.isArray(keyLearnings) ? keyLearnings : [],
      };
    });

    return scored
      .filter((m) => m.similarity > 0.2)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);
  },

  /**
   * Generate suggested actions based on context
   */
  async generateSuggestedActions(
    entities: KnowledgeEntity[],
    relationships: EntityRelationship[],
    organizationId: number | null
  ): Promise<SuggestedAction[]> {
    const suggestions: SuggestedAction[] = [];

    // Suggest pipelines that use similar entities
    const orgFilter = organizationId
      ? eq(pipelines.organizationId, organizationId)
      : isNull(pipelines.organizationId);

    const relevantPipelines = await db
      .select({
        id: pipelines.id,
        name: pipelines.name,
      })
      .from(pipelines)
      .where(and(eq(pipelines.isActive, true), orgFilter))
      .limit(20);

    for (const pipeline of relevantPipelines) {
      // Check if pipeline steps reference similar entities
      const steps = await db
        .select({
          jobId: pipelineSteps.jobId,
        })
        .from(pipelineSteps)
        .where(eq(pipelineSteps.pipelineId, pipeline.id));

      if (steps.length > 0) {
        suggestions.push({
          type: "pipeline",
          id: pipeline.id,
          name: pipeline.name,
          reason: `Pipeline with ${steps.length} steps may help process this context`,
          confidence: 0.6,
        });
      }
    }

    // Suggest knowledge topics for additional context
    const topics = await topicService.listTopics(getSystemOrgContext(organizationId));

    for (const topic of topics.slice(0, 3)) {
      suggestions.push({
        type: "knowledge_topic",
        id: topic.id,
        name: topic.name,
        reason: "Knowledge topic may provide additional context",
        confidence: 0.5,
      });
    }

    return suggestions.sort((a, b) => b.confidence - a.confidence);
  },

  /**
   * Calculate term match score
   */
  calculateTermMatchScore(name: string, terms: string[]): number {
    const nameLower = name.toLowerCase();
    let matches = 0;
    for (const term of terms) {
      if (nameLower.includes(term.toLowerCase())) {
        matches++;
      }
    }
    return matches / terms.length;
  },

  /**
   * Calculate overall relevance score
   */
  calculateRelevanceScore(entities: KnowledgeEntity[]): number {
    if (entities.length === 0) return 0;
    const avgScore =
      entities.reduce((sum, e) => sum + e.relevanceScore, 0) / entities.length;
    return Math.min(avgScore * 1.5, 1.0); // Boost and cap
  },

  /**
   * Calculate overall confidence
   */
  calculateConfidence(
    entities: KnowledgeEntity[],
    relatedMissions: RelatedMission[],
    suggestedActions: SuggestedAction[]
  ): number {
    let confidence = 0.5; // Base

    // Boost for high-quality entities
    const highRelevanceEntities = entities.filter((e) => e.relevanceScore > 0.7);
    confidence += highRelevanceEntities.length * 0.05;

    // Boost for similar past missions
    if (relatedMissions.length > 0) {
      confidence += 0.1;
      if (relatedMissions.some((m) => m.similarity > 0.5)) {
        confidence += 0.15;
      }
    }

    // Boost for actionable suggestions
    if (suggestedActions.length > 0) {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  },

  /**
   * Populate mission blackboard with enriched context
   */
  async populateBlackboard(
    missionId: number,
    context: EnrichedContext
  ): Promise<void> {
    const blackboardUpdate = {
      autoContext: {
        entities: context.entities.map((e) => ({
          id: e.id,
          name: e.name,
          type: e.type,
          relevance: e.relevanceScore,
          source: e.source,
        })),
        keyRelationships: context.relationships.slice(0, 5).map((r) => ({
          from: r.sourceName,
          to: r.targetName,
          relation: r.relation,
        })),
        similarPastMissions: context.relatedMissions.map((m) => ({
          id: m.missionId,
          name: m.missionName,
          outcome: m.outcome,
          learnings: m.keyLearnings,
        })),
        suggestedActions: context.suggestedActions.slice(0, 5),
        enrichmentScore: context.confidence,
        enrichedAt: new Date().toISOString(),
      },
    };

    await db
      .update(missions)
      .set({
        blackboard: sql`blackboard || ${JSON.stringify(blackboardUpdate)}::jsonb`,
      })
      .where(eq(missions.id, missionId));

    logger.info(`[ContextEnrichment] Populated blackboard for mission ${missionId}`);
  },

  /**
   * Batch enrich multiple missions
   */
  async batchEnrich(
    missionIds: number[],
    config?: EnrichmentConfig
  ): Promise<{ missionId: number; success: boolean; error?: string }[]> {
    const results = [];

    for (const missionId of missionIds) {
      try {
        await this.enrichMissionContext(missionId, config);
        results.push({ missionId, success: true });
      } catch (error: any) {
        results.push({ missionId, success: false, error: error.message });
      }
    }

    return results;
  },

  /**
   * Get enrichment status for a mission
   */
  async getEnrichmentStatus(missionId: number): Promise<{
    enriched: boolean;
    entityCount: number;
    enrichmentScore: number;
    enrichedAt?: string;
  }> {
    const [mission] = await db
      .select({
        blackboard: missions.blackboard,
      })
      .from(missions)
      .where(eq(missions.id, missionId))
      .limit(1);

    if (!mission || !mission.blackboard?.autoContext) {
      return { enriched: false, entityCount: 0, enrichmentScore: 0 };
    }

    const autoContext = mission.blackboard.autoContext as any;
    return {
      enriched: true,
      entityCount: autoContext.entities?.length || 0,
      enrichmentScore: autoContext.enrichmentScore || 0,
      enrichedAt: autoContext.enrichedAt,
    };
  },
};

export default missionContextEnrichmentService;
