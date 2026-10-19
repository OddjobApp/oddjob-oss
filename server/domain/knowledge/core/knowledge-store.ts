import { db } from "@server/database_service.js";
import { ragAssets, knowledgeDocuments, knowledgeTopics, knowledgeTopicDocuments, jobOutputKnowledge, jobs, Job } from "@shared/schema/index.js";
import { eq, and, inArray, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { getSystemOrgContext } from "@server/utils/auth-context.js";
import { addDocumentsToVectorStore, assetToDocuments, deleteAssetFromVectorStore } from "@domain/knowledge/core/rag-langchain.service.js";

const logger = createLogger("KnowledgeStore");

export interface RagContentSource {
  id: number;
  name: string;
  assetType: string;
  sourceType: string;
  order?: number | null;
  textContent?: string | null;
  fileData?: string | null;
  contentType?: string | null;
  fileSize?: number | null;
  url?: string | null;
  qdrantPointId?: string | null;
  datasetId?: number | null;
  nodeId?: number | null;
  metadata?: Record<string, any> | null;
  /**
   * Which org's Qdrant shard this belongs in. `deleteAssetFromVectorStore`
   * resolves the collection from this field, so leaving it off sent deletes to
   * the shared default collection while the vectors lived in the org shard.
   */
  organizationId?: number | null;
}

/**
 * Maps a Knowledge Document to a RAG Content Source format
 */
export function mapKnowledgeDocumentToRagSource(doc: any): RagContentSource {
  return {
    id: doc.id,
    name: doc.title,
    assetType: "Knowledge Document",
    sourceType: doc.sourceType || "upload",
    textContent: doc.textContent,
    fileData: doc.fileData,
    contentType: doc.contentType,
    fileSize: doc.fileSize,
    url: doc.url,
    qdrantPointId: doc.qdrantPointId,
    metadata: doc.metadata,
    organizationId: doc.organizationId,
  };
}

/**
 * Resolves RAG content sources from a list of RAG assets
 */
export async function resolveRagContentSources(assets: any[]): Promise<RagContentSource[]> {
  const resolvedSources: RagContentSource[] = [];

  for (const asset of assets) {
    if (asset.selectionType === "document" && asset.knowledgeDocumentId) {
      const [doc] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, asset.knowledgeDocumentId)).limit(1);
      if (doc) {
        resolvedSources.push(mapKnowledgeDocumentToRagSource(doc));
      }
    } else if (asset.selectionType === "topic" && asset.knowledgeTopicId) {
      const topicDocs = await db.select({ documentId: knowledgeTopicDocuments.documentId })
        .from(knowledgeTopicDocuments)
        .where(eq(knowledgeTopicDocuments.topicId, asset.knowledgeTopicId));
      
      if (topicDocs.length > 0) {
        const docs = await db.select().from(knowledgeDocuments).where(
          inArray(knowledgeDocuments.id, topicDocs.map(td => td.documentId))
        );
        docs.forEach(doc => resolvedSources.push(mapKnowledgeDocumentToRagSource(doc)));
      }
    } else {
      // Custom asset
      resolvedSources.push({
        id: asset.id,
        name: asset.name,
        assetType: asset.assetType,
        sourceType: asset.sourceType,
        order: asset.order,
        textContent: asset.textContent,
        fileData: asset.fileData,
        contentType: asset.contentType,
        fileSize: asset.fileSize,
        url: asset.url,
        qdrantPointId: asset.qdrantPointId,
      });
    }
  }

  return resolvedSources;
}

/**
 * Deletes vectors for a knowledge document
 */
export async function deleteKnowledgeDocumentVectors(doc: any): Promise<void> {
  try {
    const asset: RagContentSource = mapKnowledgeDocumentToRagSource(doc);
    await deleteAssetFromVectorStore(asset);
    logger.info("Deleted vectors for knowledge document", { documentId: doc.id });
  } catch (error) {
    logger.error("Failed to delete knowledge document vectors", { documentId: doc.id, error });
  }
}

/**
 * Re-indexes a knowledge document in the vector store
 */
/**
 * What actually reached the vector store.
 *
 * `indexed: false` with no error means the document legitimately had nothing to
 * embed. Callers must not record such a document as indexed — see the point-id
 * contract in `documentService.createDocument`.
 */
export interface ReindexResult {
  indexed: boolean;
  chunks: number;
  reason?: "no_content";
}

export async function reindexKnowledgeDocument(doc: any): Promise<ReindexResult> {
  try {
    const asset: RagContentSource = mapKnowledgeDocumentToRagSource(doc);
    // The document MUST be handed over: `assetToDocuments` reads organizationId
    // from it, and that value picks the Qdrant collection. Omitting it sharded
    // every knowledge document into the shared `oddjob_rag_assets` default with
    // no organizationId on the payload, while org-scoped search reads
    // `oddjob_org_<id>` — so a correctly embedded document was still invisible.
    const docs = await assetToDocuments(asset, doc);

    if (docs.length === 0) {
      // Zero chunks from a document that HAS text is a failure, not a no-op.
      // This is the shape the embedding outage took: the provider resolved an
      // empty vector instead of throwing, chunking produced nothing, and this
      // function logged "Re-indexed" and resolved — so the caller's catch never
      // ran and the row kept a qdrant_point_id for a point that did not exist.
      //
      // Deliberately BEFORE the delete: destroying the previous vectors on a
      // failed re-index turns a stale document into an unfindable one.
      const hasContent = typeof doc?.textContent === "string" && doc.textContent.trim().length > 0;
      if (hasContent) {
        throw new Error(
          `Embedding produced 0 chunks for document ${doc.id} despite ${doc.textContent.trim().length} characters of content — ` +
          `treating as an indexing failure rather than an empty document. Existing vectors left untouched.`,
        );
      }

      // Genuinely nothing to embed (an image, an empty stub). Clear any stale
      // vectors and report honestly that this is not indexed.
      await deleteAssetFromVectorStore(asset as any);
      logger.info("Knowledge document has no indexable content", { documentId: doc.id });
      return { indexed: false, chunks: 0, reason: "no_content" };
    }

    await deleteAssetFromVectorStore(asset as any);
    await addDocumentsToVectorStore(docs);
    logger.info("Re-indexed knowledge document", { documentId: doc.id, chunks: docs.length });
    return { indexed: true, chunks: docs.length };
  } catch (error) {
    logger.error("Failed to re-index knowledge document", { documentId: doc.id, error });
    throw error;
  }
}

/**
 * Gets the storage configuration for job output knowledge
 */
export async function getJobOutputStorageConfig(jobOrId: number | Job) {
    const jobId = typeof jobOrId === 'number' ? jobOrId : jobOrId.id;
    const [config] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    return config || null;
}

/**
 * Stores job output as knowledge based on the job's configuration
 */
export async function storeJobOutputAsKnowledge(
    jobIdOrInput: number | {
        output: string;
        job: Job;
        stepExecution?: any;
        topicId?: number | null;
        datasetId?: number | null;
        tags?: string[];
        settings?: any;
    },
    organizationId?: number | null,
    output?: string,
    metadata: any = {}
) {
    let jobId: number;
    let orgId: number | null;
    let content: string;
    let inputData: any = {};

    if (typeof jobIdOrInput === 'object') {
        inputData = jobIdOrInput;
        jobId = inputData.job.id;
        orgId = inputData.job.organizationId || null;
        content = inputData.output;
    } else {
        jobId = jobIdOrInput;
        orgId = organizationId || null;
        content = output || "";
    }

    const config = await getJobOutputStorageConfig(jobId);
    if (!config || !(config as any).enableKnowledgeStore) return null;

    logger.info("Storing job output as knowledge", { jobId, organizationId: orgId });

    const [doc] = await db.insert(knowledgeDocuments).values({
        title: (config as any).name ? `Output from ${(config as any).name}` : `Output from Job ${jobId}`,
        textContent: content,
        organizationId: orgId,
        sourceType: "job_output",
        metadata: { ...metadata, ...(inputData.metadata || {}), jobId, configId: (config as any).id }
    }).returning();

    const storageSettings = ((config as any).outputStorageSettings as any) || {};
    if (storageSettings.autoIndex !== false) {
        await reindexKnowledgeDocument(doc);
    }

    return {
        success: true,
        knowledgeDocumentId: doc.id,
        id: doc.id,
        doc,
        stats: {
            insertedRows: 1,
            source: "job_output"
        }
    };
}

/**
 * Ingests a "file" (content) into the knowledge store.
 */
export async function ingestFileToKnowledgeStore(input: {
    title: string;
    textContent?: string;
    content?: string;
    organizationId: number | null;
    sourceType?: string;
    metadata?: Record<string, any>;
    topicNames?: string[];
    topicId?: number;
    createdBy?: string;
    externalId?: string;
    platform?: string;
    integrationId?: number;
}) {
    const { documentService } = await import("./extraction/document-service.js");
    
    return documentService.createDocument({
        title: input.title,
        textContent: input.textContent || input.content,
        sourceType: input.sourceType || "integration",
        metadata: {
            ...input.metadata,
            externalId: input.externalId,
            platform: input.platform,
            integrationId: input.integrationId
        },
        topicNames: input.topicNames,
        topicIds: input.topicId ? [input.topicId] : undefined
    }, getSystemOrgContext(input.organizationId));
}

/**
 * Gets or creates a topic for a specific integration/source.
 */
export async function getOrCreateIntegrationTopic(topicName: string, organizationId: number | null) {
    const { topicService } = await import("./topic-service.js");
    const orgContext = getSystemOrgContext(organizationId);
    
    // Check if exists
    const existing = await topicService.findTopicByName(topicName, orgContext);
    const exact = existing.find((t: any) => t.name.toLowerCase() === topicName.toLowerCase());
    
    if (exact) return exact;
    
    // Create
    return topicService.createTopic({ name: topicName }, orgContext);
}


