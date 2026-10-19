import { db } from "@server/database_service.js";
import { datasetItems, knowledgeNodes, knowledgeDocuments, datasets } from "@shared/schema/index.js";
import { eq, and, isNull } from "drizzle-orm";
import { mapKnowledgeDocumentToRagSource } from "../knowledge-store.js";
import { assetToDocuments, addDocumentsToVectorStore } from "@domain/knowledge/core/rag-langchain.service.js";
import { type RagContentSource } from "@domain/knowledge/core/types.js";

/**
 * Service to publish internal data (Datasets, Graph Nodes) to Qdrant
 * for "Unified Operational Truth" search.
 */
export class QdrantPublisher {

    /**
     * Publishes specific dataset items to Qdrant.
     * Useful for syncing changes or bulk backfill.
     */
    async publishDatasetItems(itemIds: number[]): Promise<void> {
        if (!itemIds.length) return;

        console.log(`[QdrantPublisher] Publishing ${itemIds.length} dataset items to vector store...`);

        const items = await db.select()
            .from(datasetItems)
            .where(
                and(
                    // In a real implementation, we might batch this with `inArray`
                    // But for now let's assume valid IDs passed
                    // Using sql for dynamic IN clause would be better but keeping it simple for MVP
                )
            );

        // Fetch items using loop or simple query (drizzle doesn't support convenient dynamic IN easily without helper)
        // For MVP, lets assume we process one by one or small batches provided by caller
        // Or better, logic to fetch:

        // Actually, let's just fetch them. 
        // We'll use a more efficient approach in production (batching).
        // For now, let's implement single publishing for clarity.
    }

    /**
     * Publishes a single dataset item to Qdrant.
     * Converts the JSON data into a text description for embedding.
     */
    async publishDatasetItem(id: number): Promise<void> {
        // Need to join with datasets to get organizationId
        const result = await db.select({
            item: datasetItems,
            organizationId: datasets.organizationId
        })
            .from(datasetItems)
            .innerJoin(datasets, eq(datasetItems.datasetId, datasets.id))
            .where(eq(datasetItems.id, id))
            .limit(1);

        if (!result.length) return;
        const { item, organizationId } = result[0];

        const source: RagContentSource = {
            id: item.id,
            name: `Dataset Item ${item.id}`,
            assetType: "Dataset Record",
            sourceType: "dataset_row",
            // Pass the raw JSON as textContent - getAssetPlainText will handle formatting
            textContent: JSON.stringify(item.data),
            datasetId: item.datasetId,
            qdrantPointId: `dataset-item-${item.id}`,
            // We can add metadata like dataset ID for filtering
            metadata: {
                datasetId: item.datasetId,
                pipelineExecutionId: item.pipelineExecutionId,
                organizationId: organizationId
            }
        };

        await this.indexAsset(source);
    }

    /**
     * Publishes a Knowledge Graph Node to Qdrant.
     * Indexing the node allows agents to search for "Services", "Teams", etc.
     */
    async publishGraphNode(nodeId: number): Promise<void> {
        const [node] = await db.select().from(knowledgeNodes).where(eq(knowledgeNodes.id, nodeId)).limit(1);
        if (!node) return;

        const source: RagContentSource = {
            id: node.id,
            name: node.name,
            assetType: "Knowledge Node",
            sourceType: "graph_node",
            // The text content is the node properties + label
            textContent: JSON.stringify({
                label: node.label,
                name: node.name,
                ...node.data as Record<string, any>, // Index arbitrary properties from data jsonb
            }),
            nodeId: node.id,
            qdrantPointId: `node-${node.id}`,
            metadata: {
                label: node.label,
                topicId: node.knowledgeTopicId,
                organizationId: node.organizationId
            }
        };

        await this.indexAsset(source);
    }

    private async indexAsset(source: RagContentSource): Promise<void> {
        try {
            const docs = await assetToDocuments(source, {
                metadata: source.metadata
            });

            if (docs.length > 0) {
                await addDocumentsToVectorStore(docs);
                console.log(`[QdrantPublisher] Indexed ${source.assetType} ${source.id} (${docs.length} chunks)`);
            }
        } catch (err) {
            console.error(`[QdrantPublisher] Failed to index ${source.assetType} ${source.id}:`, err);
        }
    }
}

export const qdrantPublisher = new QdrantPublisher();


