/**
 * Knowledge Ingestion Service
 *
 * Processes collected content into Knowledge Graph entities and relationships.
 * For each content item: generates dynamic EntityRules based on the research
 * subject domain, extracts entities, creates/merges KG nodes, extracts
 * relationships, creates KG edges, and embeds each node for semantic search.
 *
 * @module ingestion/knowledge-ingestion
 */

import { createLogger } from "@server/utils/logger.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import type { EntityRule, RelationshipRule } from "@shared/schema/index.js";
import type { KnowledgeNode } from "@shared/schema/index.js";
import type { CollectedContent } from "./collectors/collector.interface.js";
import type { ClassifiedInput } from "./types.js";
import type { ExtractingPayload } from "./progress.types.js";
import {
  extractEntities,
  type ExtractedEntity,
} from "../extraction/EntityExtractor.js";
import {
  extractRelationships,
  type ExtractedRelationship,
} from "../extraction/RelationshipExtractor.js";
import {
  createKnowledgeGraphNodes,
  createKnowledgeGraphEdges,
} from "../extraction/knowledge-graph-extractor.js";
import { embedKnowledgeNode } from "../graph/graph-service.js";
import { developmentProviderKey, resolveOrgGeminiKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("KnowledgeIngestion");

// ─── Public Interfaces ─────────────────────────────────────────────────────────

/** Options for configuring knowledge ingestion */
export interface KnowledgeIngestionOptions {
  /** Callback invoked with cumulative extraction progress */
  onProgress?: (payload: ExtractingPayload) => void;
}

/** Result of processing collected content into KG entities */
export interface KnowledgeIngestionResult {
  /** Total entities created or updated */
  entitiesCreated: number;
  /** Total relationships created or updated */
  relationshipsCreated: number;
  /** IDs of all KG nodes created/updated */
  nodeIds: number[];
}

// ─── Service ───────────────────────────────────────────────────────────────────

export const knowledgeIngestionService = {
  /**
   * Ingest collected content into the Knowledge Graph.
   *
   * For each content item:
   * 1. Generate EntityRules dynamically based on the research subject domain
   * 2. Extract entities using those rules
   * 3. Create/merge KG nodes (duplicate externalIds are updated, not duplicated)
   * 4. Extract relationships between entities
   * 5. Create KG edges for those relationships
   * 6. Embed each node for Qdrant semantic search
   *
   * Progress events are emitted with cumulative entity/relationship counts.
   */
  async ingest(
    content: CollectedContent[],
    researchSubject: ClassifiedInput,
    pipelineExecutionId: number,
    orgContext: OrgContext,
    options?: KnowledgeIngestionOptions
  ): Promise<KnowledgeIngestionResult> {
    const onProgress = options?.onProgress;

    logger.info("Starting knowledge ingestion", {
      contentItems: content.length,
      subject: researchSubject.normalizedValue,
      pipelineExecutionId,
    });

    let totalEntitiesCreated = 0;
    let totalRelationshipsCreated = 0;
    const allNodeIds: number[] = [];

    for (const item of content) {
      try {
        // 1. Generate EntityRules dynamically for this content
        const entityRules = await generateEntityRules(researchSubject, item);
        const relationshipRules = generateRelationshipRules(researchSubject);

        // 2. Prepare content data for extraction
        const contentData = buildContentData(item);

        // 3. Extract entities using the dynamic rules
        const entities = extractEntities(contentData, entityRules);

        if (entities.length === 0) {
          logger.debug("No entities extracted from content item", {
            url: item.url,
            title: item.title,
          });
          continue;
        }

        // 4. Create/merge KG nodes (handles duplicate externalIds via upsert)
        const nodes = await createKnowledgeGraphNodes(
          entities,
          orgContext.organizationId!,
          orgContext.userId,
          pipelineExecutionId,
          null, // knowledgeDocumentId
          "pipeline" // extractionSource
        );

        totalEntitiesCreated += nodes.length;
        allNodeIds.push(...nodes.map((n) => n.id));

        // 5. Extract relationships between entities
        const relationships = extractRelationships(
          contentData,
          relationshipRules,
          entities
        );

        // 6. Create KG edges
        const edges = await createKnowledgeGraphEdges(
          relationships,
          nodes,
          orgContext.organizationId!,
          orgContext.userId,
          pipelineExecutionId
        );

        totalRelationshipsCreated += edges.length;

        // 7. Embed each node for Qdrant semantic search
        await embedNodes(nodes);

        // 8. Emit progress event
        onProgress?.({
          stage: "extracting",
          entitiesCreated: totalEntitiesCreated,
          relationshipsCreated: totalRelationshipsCreated,
          datasetItemsStored: 0, // Dataset items are handled by dataset-ingestion service
        });

        logger.debug("Processed content item", {
          url: item.url,
          entities: nodes.length,
          relationships: edges.length,
        });
      } catch (error) {
        logger.error("Error processing content item for KG ingestion", error, {
          url: item.url,
          title: item.title,
        });
        // Continue processing remaining items
      }
    }

    logger.info("Knowledge ingestion completed", {
      totalEntitiesCreated,
      totalRelationshipsCreated,
      totalNodes: allNodeIds.length,
      pipelineExecutionId,
    });

    return {
      entitiesCreated: totalEntitiesCreated,
      relationshipsCreated: totalRelationshipsCreated,
      nodeIds: allNodeIds,
    };
  },
};

// ─── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * Generate EntityRules dynamically based on the research subject domain.
 *
 * Uses LLM to produce domain-specific entity extraction rules tailored
 * to the research topic. Falls back to heuristic rules if LLM is unavailable.
 */
async function generateEntityRules(
  researchSubject: ClassifiedInput,
  contentItem: CollectedContent
): Promise<EntityRule[]> {
  try {
    const { systemAiService } = await import(
      "@domain/ai/core/system-ai.service.js"
    );
    const { AIClientFactory } = await import(
      "@domain/ai/core/ai-client.service.js"
    );

    const config = (await systemAiService.getAiConfig("copilot")) || {
      provider: "google",
      model: "gemini-2.0-flash",
    };

    const aiClient = AIClientFactory.getClient({
      provider: config.provider,
    } as any);

    const apiKey =
      config.apiKey ||
      (config.provider === "google"
        ? await resolveOrgGeminiKey(null)
        : developmentProviderKey("openai")) ||
      "";

    if (!apiKey) {
      logger.warn("No API key for entity rule generation, using heuristic rules");
      return buildHeuristicEntityRules(researchSubject, contentItem);
    }

    const systemPrompt = `You are a Knowledge Graph entity extraction rule generator.
Given a research subject and a content item, generate EntityRules that will extract meaningful entities from the content.

Output ONLY valid JSON with this structure:
{
  "entityRules": [
    {
      "entityType": "string",
      "label": "string",
      "rootPath": "string or omit",
      "mappings": {
        "name": "string (path to name field)",
        "externalId": "string (path to ID field, optional)",
        "data": { "key": "path" }
      }
    }
  ]
}

Rules:
- Generate 2-5 entity rules relevant to the research domain
- entityType and label should reflect the domain (e.g., for "machine learning": "Algorithm", "Dataset", "Framework")
- Map "name" to "title" since the content data has a "title" field
- Map "externalId" to "url" since the content data has a "url" field
- Include data mappings for "description" -> "content", "sourceType" -> "sourceType", and "url" -> "url"
- Keep rules practical for the content structure: { title, url, content, sourceType, metadata }`;

    const userPrompt = `Research subject: "${researchSubject.normalizedValue}" (type: ${researchSubject.type})
Content title: "${contentItem.title}"
Content type: ${contentItem.contentType}
Source type: ${contentItem.sourceType}
Content preview: ${contentItem.content.substring(0, 500)}`;

    const res = await aiClient.execute(
      {
        model: config.model,
        systemPrompt,
        userPrompt,
        provider: config.provider as any,
        requestType: "json",
      } as any,
      userPrompt,
      apiKey
    );

    if (!res.success || !res.output) {
      logger.warn("LLM entity rule generation returned no output, using heuristic rules");
      return buildHeuristicEntityRules(researchSubject, contentItem);
    }

    const cleanOutput = res.output.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleanOutput);

    if (!Array.isArray(parsed.entityRules) || parsed.entityRules.length === 0) {
      logger.warn("LLM returned empty entity rules, using heuristic rules");
      return buildHeuristicEntityRules(researchSubject, contentItem);
    }

    // Validate and sanitize rules
    return parsed.entityRules.map((rule: any) => ({
      entityType: String(rule.entityType || "Entity"),
      label: String(rule.label || "Entity"),
      rootPath: rule.rootPath || undefined,
      mappings: {
        name: String(rule.mappings?.name || "title"),
        externalId: rule.mappings?.externalId
          ? String(rule.mappings.externalId)
          : "url",
        data: rule.mappings?.data || { description: "content", url: "url" },
      },
    }));
  } catch (error) {
    logger.warn("Failed to generate entity rules via LLM, using heuristic fallback", {
      error: error instanceof Error ? error.message : String(error),
    });
    return buildHeuristicEntityRules(researchSubject, contentItem);
  }
}

/**
 * Build heuristic entity rules when LLM is unavailable.
 * Creates a general-purpose rule based on the research subject domain.
 */
function buildHeuristicEntityRules(
  researchSubject: ClassifiedInput,
  contentItem: CollectedContent
): EntityRule[] {
  const subjectLabel = capitalizeFirstLetter(
    researchSubject.normalizedValue.split(/\s+/).slice(0, 2).join("_")
  );

  // Primary rule: extract the content item as a research source entity
  const sourceRule: EntityRule = {
    entityType: "ResearchSource",
    label: "ResearchSource",
    mappings: {
      name: "title",
      externalId: "url",
      data: {
        description: "content",
        sourceType: "sourceType",
        url: "url",
        contentType: "contentType",
      },
    },
  };

  // Domain-specific entity rule based on subject
  const domainRule: EntityRule = {
    entityType: subjectLabel,
    label: subjectLabel,
    mappings: {
      name: "title",
      externalId: "url",
      data: {
        description: "content",
        url: "url",
        sourceType: "sourceType",
      },
    },
  };

  return [sourceRule, domainRule];
}

/**
 * Generate relationship rules for linking entities.
 * Creates basic relationships between research sources and domain entities.
 */
function generateRelationshipRules(
  researchSubject: ClassifiedInput
): RelationshipRule[] {
  return [
    {
      relation: "RELATED_TO",
      sourceEntity: "ResearchSource",
      targetEntity: capitalizeFirstLetter(
        researchSubject.normalizedValue.split(/\s+/).slice(0, 2).join("_")
      ),
      sourcePath: "url",
      targetPath: "url",
      weight: 1,
    },
  ];
}

/**
 * Build a data structure from CollectedContent suitable for entity extraction.
 * The extractEntities function expects data with paths matching the EntityRule mappings.
 */
function buildContentData(item: CollectedContent): Record<string, unknown> {
  return {
    title: item.title,
    url: item.url,
    content: item.content,
    sourceType: item.sourceType,
    contentType: item.contentType,
    contentSize: item.contentSize,
    metadata: item.metadata,
  };
}

/**
 * Embed all created/updated nodes for Qdrant semantic search.
 * Failures are logged but do not block the pipeline.
 */
async function embedNodes(nodes: KnowledgeNode[]): Promise<void> {
  for (const node of nodes) {
    try {
      await embedKnowledgeNode(node);
    } catch (error) {
      logger.warn("Failed to embed knowledge node", {
        nodeId: node.id,
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue embedding remaining nodes
    }
  }
}

/**
 * Capitalize the first letter of a string.
 */
function capitalizeFirstLetter(str: string): string {
  if (!str) return "Entity";
  return str.charAt(0).toUpperCase() + str.slice(1);
}
