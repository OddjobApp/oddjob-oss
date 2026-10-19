/**
 * Dataset Ingestion Service
 *
 * Creates or locates a Dataset for a research run and populates it with
 * DatasetItems from the collected content. Each item is linked to its
 * corresponding Knowledge Graph node and the active pipeline execution
 * to maintain full lineage.
 *
 * @module ingestion/dataset-ingestion
 */

import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { pipelineExecutions } from "@shared/schema/pipelines/pipeline-execution.js";
import { eq } from "drizzle-orm";
import { type OrgContext } from "@server/utils/auth-context.js";
import { coreService } from "../dataset/core-service.js";
import { itemService } from "../dataset/item-service.js";
import type { CollectedContent } from "./collectors/collector.interface.js";
import type { ClassifiedInput } from "./types.js";

const logger = createLogger("DatasetIngestion");

// ─── Public Types ──────────────────────────────────────────────────────────────

/** Result returned after dataset ingestion completes */
export interface DatasetIngestionResult {
  datasetId: number;
  datasetName: string;
  itemsCreated: number;
}

// ─── Schema Definition ─────────────────────────────────────────────────────────

/** Schema mapping for research datasets with all required fields */
const researchDatasetSchema = {
  source_url: { type: "string", description: "URL of the source" },
  title: { type: "string", description: "Title of the source document" },
  content_summary: { type: "string", description: "AI-generated summary of the content" },
  source_type: { type: "string", enum: ["web", "academic", "api_doc", "code", "document"] },
  relevance_score: { type: "number", min: 0, max: 1 },
  extracted_date: { type: "string", format: "iso8601" },
  collector_id: { type: "string", description: "ID of the collector that retrieved this" },
  content_size: { type: "number", description: "Raw content size in bytes" },
};

// ─── Service ───────────────────────────────────────────────────────────────────

export const datasetIngestionService = {
  /**
   * Ingest collected content into a Dataset with full lineage linking.
   *
   * Creates a new Dataset with the naming pattern `research_{subject_slug}_{timestamp}`
   * and populates it with DatasetItems — one per CollectedContent entry. Each item
   * carries flattened data matching the schema, raw_data preserving full content,
   * and links to the corresponding KG node and pipeline execution.
   *
   * @param content - Array of collected content items from source collectors
   * @param researchSubject - The classified research subject for naming
   * @param pipelineExecutionId - Active pipeline execution ID for lineage
   * @param knowledgeNodeIds - Map of `{collectorId}:{url}` to KG node ID
   * @param orgContext - Organization context for access control
   * @returns Dataset ID, name, and count of items created
   */
  async ingest(
    content: CollectedContent[],
    researchSubject: ClassifiedInput,
    pipelineExecutionId: number,
    knowledgeNodeIds: Map<string, number>,
    orgContext: OrgContext,
  ): Promise<DatasetIngestionResult> {
    const datasetName = generateDatasetName(researchSubject);

    logger.info("Starting dataset ingestion", {
      subject: researchSubject.normalizedValue,
      datasetName,
      contentCount: content.length,
      pipelineExecutionId,
    });

    // Create the dataset with the research schema
    // Resolve missionId from the pipeline execution context for lineage tracking
    let missionId: number | null = null;
    try {
      const [execution] = await db
        .select({ missionId: pipelineExecutions.missionId })
        .from(pipelineExecutions)
        .where(eq(pipelineExecutions.id, pipelineExecutionId))
        .limit(1);
      missionId = execution?.missionId ?? null;
    } catch (err) {
      logger.warn("Failed to resolve missionId from pipeline execution", {
        pipelineExecutionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const dataset = await coreService.create(
      {
        name: datasetName,
        description: `Autonomous research dataset for "${researchSubject.value}"`,
        tags: ["research", "auto-generated"],
        schemaMapping: researchDatasetSchema,
        ...(missionId ? { missionId } : {}),
      },
      orgContext,
    );

    logger.info("Dataset created", { datasetId: dataset.id, datasetName });

    // Build dataset items from collected content
    const items = content.map((item) => {
      const nodeKey = resolveNodeKey(item);
      const knowledgeNodeId = knowledgeNodeIds.get(nodeKey);

      return {
        data: {
          source_url: item.url,
          title: item.title,
          content_summary: generateContentSummary(item.content),
          source_type: mapSourceType(item.sourceType),
          relevance_score: (item.metadata?.relevanceScore as number) ?? 0.5,
          extracted_date: new Date().toISOString(),
          collector_id: (item.metadata?.collectorId as string) ?? "",
          content_size: item.contentSize,
        },
        rawData: {
          url: item.url,
          title: item.title,
          content: item.content,
          contentType: item.contentType,
          sourceType: item.sourceType,
          contentSize: item.contentSize,
          metadata: item.metadata,
        },
        pipelineExecutionId,
        knowledgeNodeId,
      };
    });

    // Batch insert items into the dataset
    const result = await itemService.addItems(dataset.id, items, orgContext);

    logger.info("Dataset ingestion completed", {
      datasetId: dataset.id,
      datasetName,
      itemsCreated: result.inserted,
    });

    return {
      datasetId: dataset.id,
      datasetName,
      itemsCreated: result.inserted,
    };
  },
};

// ─── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * Generate a dataset name following the pattern: research_{subject_slug}_{timestamp}
 * The subject_slug is URL-safe lowercase derived from the research subject.
 */
function generateDatasetName(subject: ClassifiedInput): string {
  const slug = toUrlSafeSlug(subject.normalizedValue);
  const timestamp = Date.now();
  return `research_${slug}_${timestamp}`;
}

/**
 * Convert a string to a URL-safe lowercase slug.
 * Strips non-alphanumeric characters, replaces spaces/hyphens with underscores,
 * and truncates to a reasonable length.
 */
function toUrlSafeSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/**
 * Map SourceCollectorType to the dataset schema's source_type enum.
 */
function mapSourceType(
  sourceType: string,
): "web" | "academic" | "api_doc" | "code" | "document" {
  const mapping: Record<string, "web" | "academic" | "api_doc" | "code" | "document"> = {
    web_scraper: "web",
    academic_search: "academic",
    api_documentation_parser: "api_doc",
    code_repository_scanner: "code",
    document_parser: "document",
  };
  return mapping[sourceType] ?? "web";
}

/**
 * Generate a brief content summary from the raw content.
 * Takes the first ~300 characters as a summary placeholder.
 * In production, this would be replaced by an AI-generated summary.
 */
function generateContentSummary(content: string): string {
  if (!content) return "";
  const trimmed = content.trim();
  if (trimmed.length <= 300) return trimmed;
  return trimmed.slice(0, 297) + "...";
}

/**
 * Resolve the knowledge node map key for a collected content item.
 * Uses the pattern `{collectorId}:{url}` matching the knowledgeNodeIds map.
 */
function resolveNodeKey(item: CollectedContent): string {
  const collectorId = (item.metadata?.collectorId as string) ?? "";
  return `${collectorId}:${item.url}`;
}

// ─── Exported Helpers (for testing) ────────────────────────────────────────────

export { generateDatasetName, toUrlSafeSlug, mapSourceType, generateContentSummary, resolveNodeKey };
