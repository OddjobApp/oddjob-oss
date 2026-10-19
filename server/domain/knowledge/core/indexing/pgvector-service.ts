import { db } from "../../../../database_service.js";
import { knowledgeNodes, knowledgeDocuments, agentChatMessages } from "@shared/schema/index.js";
import { sql } from "drizzle-orm";
import { createLogger } from "../../../../utils/logger.js";

const logger = createLogger("PgVectorService");

export interface SearchOptions {
    limit?: number;
    threshold?: number;
    organizationId?: number | null;
}

export interface SimilarityResult {
    id: number;
    similarity: number;
    [key: string]: any;
}

export const pgvectorService = {
    /**
     * Search for similar knowledge nodes using cosine similarity
     */
    async searchSimilarNodes(
        embedding: number[],
        options: SearchOptions = {}
    ): Promise<SimilarityResult[]> {
        const { limit = 5, threshold = 0.7, organizationId } = options;

        try {
            const embeddingStr = `[${embedding.join(',')}]`;

            const query = sql`
                SELECT 
                    id, 
                    name, 
                    label, 
                    data,
                    organization_id,
                    created_at,
                    1 - (embedding <=> ${embeddingStr}::vector) as similarity
                FROM knowledge_nodes
                WHERE embedding IS NOT NULL
                    ${organizationId !== undefined && organizationId !== null ? sql`AND organization_id = ${organizationId}` : sql``}
                    AND 1 - (embedding <=> ${embeddingStr}::vector) >= ${threshold}
                ORDER BY embedding <=> ${embeddingStr}::vector
                LIMIT ${limit}
            `;

            const results = await db.execute(query);
            return results.rows as SimilarityResult[];
        } catch (error) {
            logger.error("Failed to search similar nodes", error);
            throw error;
        }
    },

    /**
     * Search for similar documents using cosine similarity
     */
    async searchSimilarDocuments(
        embedding: number[],
        options: SearchOptions = {}
    ): Promise<SimilarityResult[]> {
        const { limit = 5, threshold = 0.7, organizationId } = options;

        try {
            const embeddingStr = `[${embedding.join(',')}]`;

            const query = sql`
                SELECT 
                    id, 
                    title, 
                    content,
                    source_type,
                    organization_id,
                    created_at,
                    1 - (embedding <=> ${embeddingStr}::vector) as similarity
                FROM knowledge_documents
                WHERE embedding IS NOT NULL
                    ${organizationId !== undefined && organizationId !== null ? sql`AND organization_id = ${organizationId}` : sql``}
                    AND 1 - (embedding <=> ${embeddingStr}::vector) >= ${threshold}
                ORDER BY embedding <=> ${embeddingStr}::vector
                LIMIT ${limit}
            `;

            const results = await db.execute(query);
            return results.rows as SimilarityResult[];
        } catch (error) {
            logger.error("Failed to search similar documents", error);
            throw error;
        }
    },

    /**
     * Search for similar chat messages using cosine similarity
     */
    async searchSimilarMessages(
        embedding: number[],
        options: SearchOptions & { jobId?: number } = {}
    ): Promise<SimilarityResult[]> {
        const { limit = 5, threshold = 0.7, jobId } = options;

        try {
            const embeddingStr = `[${embedding.join(',')}]`;

            const query = sql`
                SELECT 
                    id, 
                    content,
                    role,
                    job_id,
                    created_at,
                    1 - (embedding_vector <=> ${embeddingStr}::vector) as similarity
                FROM agent_chat_messages
                WHERE embedding_vector IS NOT NULL
                    ${jobId !== undefined ? sql`AND job_id = ${jobId}` : sql``}
                    AND 1 - (embedding_vector <=> ${embeddingStr}::vector) >= ${threshold}
                ORDER BY embedding_vector <=> ${embeddingStr}::vector
                LIMIT ${limit}
            `;

            const results = await db.execute(query);
            return results.rows as SimilarityResult[];
        } catch (error) {
            logger.error("Failed to search similar messages", error);
            throw error;
        }
    },

    /**
     * Upsert embedding for a knowledge node
     */
    async upsertNodeEmbedding(nodeId: number, embedding: number[]): Promise<void> {
        try {
            const embeddingStr = `[${embedding.join(',')}]`;

            await db.execute(sql`
                UPDATE knowledge_nodes
                SET embedding = ${embeddingStr}::vector
                WHERE id = ${nodeId}
            `);

            logger.info(`Updated embedding for node ${nodeId}`);
        } catch (error) {
            logger.error(`Failed to update embedding for node ${nodeId}`, error);
            throw error;
        }
    },

    /**
     * Upsert embedding for a knowledge document
     */
    async upsertDocumentEmbedding(documentId: number, embedding: number[]): Promise<void> {
        try {
            const embeddingStr = `[${embedding.join(',')}]`;

            await db.execute(sql`
                UPDATE knowledge_documents
                SET embedding = ${embeddingStr}::vector
                WHERE id = ${documentId}
            `);

            logger.info(`Updated embedding for document ${documentId}`);
        } catch (error) {
            logger.error(`Failed to update embedding for document ${documentId}`, error);
            throw error;
        }
    },

    /**
     * Upsert embedding for a chat message
     */
    async upsertMessageEmbedding(messageId: number, embedding: number[]): Promise<void> {
        try {
            const embeddingStr = `[${embedding.join(',')}]`;

            await db.execute(sql`
                UPDATE agent_chat_messages
                SET embedding_vector = ${embeddingStr}::vector
                WHERE id = ${messageId}
            `);

            logger.info(`Updated embedding for message ${messageId}`);
        } catch (error) {
            logger.error(`Failed to update embedding for message ${messageId}`, error);
            throw error;
        }
    },

    /**
     * Batch upsert embeddings for multiple items
     */
    async batchUpsertEmbeddings(
        items: Array<{
            id: number;
            embedding: number[];
            table: 'nodes' | 'documents' | 'messages'
        }>
    ): Promise<void> {
        try {
            for (const item of items) {
                if (item.table === 'nodes') {
                    await this.upsertNodeEmbedding(item.id, item.embedding);
                } else if (item.table === 'documents') {
                    await this.upsertDocumentEmbedding(item.id, item.embedding);
                } else if (item.table === 'messages') {
                    await this.upsertMessageEmbedding(item.id, item.embedding);
                }
            }

            logger.info(`Batch updated ${items.length} embeddings`);
        } catch (error) {
            logger.error("Failed to batch update embeddings", error);
            throw error;
        }
    },

    /**
     * Get statistics about embeddings in the database
     */
    async getEmbeddingStats(): Promise<{
        nodes: { total: number; withEmbeddings: number };
        documents: { total: number; withEmbeddings: number };
        messages: { total: number; withEmbeddings: number };
    }> {
        try {
            const [nodesStats, docsStats, messagesStats] = await Promise.all([
                db.execute(sql`
                    SELECT 
                        COUNT(*) as total,
                        COUNT(embedding) as with_embeddings
                    FROM knowledge_nodes
                `),
                db.execute(sql`
                    SELECT 
                        COUNT(*) as total,
                        COUNT(embedding) as with_embeddings
                    FROM knowledge_documents
                `),
                db.execute(sql`
                    SELECT 
                        COUNT(*) as total,
                        COUNT(embedding_vector) as with_embeddings
                    FROM agent_chat_messages
                `)
            ]);

            return {
                nodes: {
                    total: Number(nodesStats.rows[0]?.total || 0),
                    withEmbeddings: Number(nodesStats.rows[0]?.with_embeddings || 0)
                },
                documents: {
                    total: Number(docsStats.rows[0]?.total || 0),
                    withEmbeddings: Number(docsStats.rows[0]?.with_embeddings || 0)
                },
                messages: {
                    total: Number(messagesStats.rows[0]?.total || 0),
                    withEmbeddings: Number(messagesStats.rows[0]?.with_embeddings || 0)
                }
            };
        } catch (error) {
            logger.error("Failed to get embedding stats", error);
            throw error;
        }
    }
};


