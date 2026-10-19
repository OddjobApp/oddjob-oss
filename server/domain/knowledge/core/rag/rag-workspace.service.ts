import { db } from "../../../../database_service.js";
import {
    ragAssets, jobOutputKnowledge, knowledgeDocuments, knowledgeTopics, jobs, knowledgeNodes,
    type RagAsset
} from "@shared/schema/index.js";
import { eq, and, desc, getTableColumns, inArray, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { addDocumentsToVectorStore, assetToDocuments, deleteAssetFromVectorStore } from "@domain/knowledge/core/rag-langchain.service.js";
import { deleteKnowledgeDocumentVectors } from "../knowledge-store.js";
import { BadRequestError, NotFoundError, ForbiddenError, ValidationError, ErrorCode, UnauthorizedError } from "@server/utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";
import type { OrgContext } from "../../../../utils/auth-context.js";

const logger = createLogger('RagService');

export const ragService = {
    /**
     * Re-index a RAG asset in the vector store
     */
    async reindexAsset(asset: RagAsset) {
        try {
            const docs = await assetToDocuments(asset);
            await deleteAssetFromVectorStore(asset);
            if (docs.length) {
                await addDocumentsToVectorStore(docs);
            }
        } catch (error) {
            logger.error("Failed to reindex RAG asset", { assetId: asset.id, error });
            throw new BadRequestError("Failed to update RAG asset embeddings");
        }
    },

    /**
     * List all RAG assets for a job
     */
    async listAssets(jobId: number | null, organizationId?: number | null) {
        const conditions = [
            jobId === null ? sql`${ragAssets.jobId} IS NULL` : eq(ragAssets.jobId, jobId),
            ...(organizationId !== undefined && organizationId !== null ? [eq(ragAssets.organizationId, organizationId)] : [sql`${ragAssets.organizationId} IS NULL`])
        ];

        return await db
            .select({
                ...getTableColumns(ragAssets),
                documentMetadata: knowledgeDocuments.metadata,
            })
            .from(ragAssets)
            .leftJoin(knowledgeDocuments, eq(ragAssets.knowledgeDocumentId, knowledgeDocuments.id))
            .where(and(...conditions))
            .orderBy(ragAssets.order);
    },

    /**
     * Create a new RAG asset
     */
    async createAsset(input: any) {
        const {
            jobId,
            organizationId,
            name,
            assetType,
            sourceType,
            contentType,
            fileSize,
            fileData,
            url,
            textContent,
            selectionType = "custom",
            knowledgeTopicId,
            knowledgeDocumentId,
        } = input;

        const jobIdNum = jobId ? (typeof jobId === 'string' ? parseInt(jobId, 10) : jobId) : null;
        if (jobIdNum && (isNaN(jobIdNum) || jobIdNum <= 0)) throw new BadRequestError("Invalid job ID", { jobId }, ErrorCode.INVALID_INPUT);

        if (selectionType === "custom" && (!name || !assetType || !sourceType)) {
            throw new ValidationError("Missing required fields", { fields: ['name', 'assetType', 'sourceType'] });
        }

        const existingAssets = await db.select().from(ragAssets).where(
            and(
                jobIdNum === null ? sql`${ragAssets.jobId} IS NULL` : eq(ragAssets.jobId, jobIdNum),
                organizationId !== undefined && organizationId !== null ? eq(ragAssets.organizationId, organizationId) : sql`${ragAssets.organizationId} IS NULL`
            )
        );
        if (existingAssets.length >= 3) throw new BadRequestError("Maximum of 3 RAG assets per job");

        if (fileSize && fileSize > 10 * 1024 * 1024) throw new BadRequestError("File size exceeds 10MB limit");

        if (selectionType === "custom" && assetType === "Text" && (!textContent || !textContent.trim())) {
            throw new ValidationError("Text content is required for Text assets", { field: 'textContent' });
        }

        if (selectionType === "custom" && sourceType === "upload" && assetType !== "Text" && !fileData) {
            throw new ValidationError("File data is required for upload assets", { field: 'fileData' });
        }

        if (selectionType === "custom" && sourceType === "link" && (!url || !url.trim())) {
            throw new ValidationError("URL is required for link assets", { field: 'url' });
        }

        const maxOrder = existingAssets.length > 0 ? Math.max(...existingAssets.map(a => a.order || 0)) : -1;
        const newOrder = maxOrder + 1;
        const assetVectorKey = randomUUID();
        let insertedAsset: RagAsset | null = null;

        if (selectionType === "topic") {
            const normalizedTopicId = typeof knowledgeTopicId === "string" ? parseInt(knowledgeTopicId, 10) : knowledgeTopicId;
            if (!normalizedTopicId || Number.isNaN(normalizedTopicId)) throw new ValidationError("knowledgeTopicId is required for topic selection", { field: 'knowledgeTopicId' });

            const [topic] = await db.select().from(knowledgeTopics).where(eq(knowledgeTopics.id, normalizedTopicId)).limit(1);
            if (!topic) throw new NotFoundError("Knowledge topic not found", ErrorCode.NOT_FOUND, { knowledgeTopicId: normalizedTopicId });

            const inserted = await db.insert(ragAssets).values({
                jobId: jobIdNum,
                organizationId: organizationId || null,
                name: topic.name,
                assetType: "Knowledge Topic",
                sourceType: "link",
                contentType: null,
                fileSize: null,
                fileData: null,
                url: null,
                textContent: null,
                qdrantPointId: assetVectorKey,
                selectionType: "topic",
                knowledgeTopicId: topic.id,
                order: newOrder,
                createdAt: new Date(),
                updatedAt: new Date(),
            }).returning();
            insertedAsset = inserted[0] as RagAsset;
        } else if (selectionType === "document") {
            const normalizedDocumentId = typeof knowledgeDocumentId === "string" ? parseInt(knowledgeDocumentId, 10) : knowledgeDocumentId;
            if (!normalizedDocumentId || Number.isNaN(normalizedDocumentId)) throw new ValidationError("knowledgeDocumentId is required for document selection", { field: 'knowledgeDocumentId' });

            const [document] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, normalizedDocumentId)).limit(1);
            if (!document) throw new NotFoundError("Knowledge document not found", ErrorCode.NOT_FOUND, { knowledgeDocumentId: normalizedDocumentId });

            const inserted = await db.insert(ragAssets).values({
                jobId: jobIdNum,
                organizationId: organizationId || null,
                name: document.title,
                assetType: "Knowledge Document",
                sourceType: document.sourceType === "link" ? "link" : "upload",
                contentType: document.contentType ?? null,
                fileSize: document.fileSize ?? null,
                fileData: null,
                url: document.url ?? (document.metadata as any)?.url ?? null,
                textContent: null,
                qdrantPointId: document.qdrantPointId || assetVectorKey,
                selectionType: "document",
                knowledgeDocumentId: document.id,
                order: newOrder,
                createdAt: new Date(),
                updatedAt: new Date(),
            }).returning();
            insertedAsset = inserted[0] as RagAsset;
        } else {
            const asset = await db.insert(ragAssets).values({
                jobId: jobIdNum,
                organizationId: organizationId || null,
                name,
                assetType,
                sourceType,
                contentType: contentType || null,
                fileSize: fileSize || null,
                fileData: fileData || null,
                url: url || null,
                textContent: textContent && typeof textContent === 'string' ? textContent.trim() : null,
                qdrantPointId: assetVectorKey,
                order: newOrder,
                selectionType: "custom",
                createdAt: new Date(),
                updatedAt: new Date(),
            }).returning();
            insertedAsset = asset[0] as RagAsset;

            try {
                await this.reindexAsset(insertedAsset);
            } catch (error) {
                await db.delete(ragAssets).where(eq(ragAssets.id, insertedAsset.id));
                throw new BadRequestError("Failed to index RAG asset. Please try again.");
            }
        }

        return insertedAsset;
    },

    /**
     * Update a RAG asset
     */
    async updateAsset(id: number, input: any, organizationId?: number | null) {
        const { name, assetType, sourceType, contentType, fileSize, fileData, url, textContent } = input;

        const result = await db.update(ragAssets).set({
            ...(name && { name }),
            ...(assetType && { assetType }),
            ...(sourceType && { sourceType }),
            ...(contentType !== undefined && { contentType }),
            ...(fileSize !== undefined && { fileSize }),
            ...(fileData !== undefined && { fileData }),
            ...(url !== undefined && { url }),
            ...(textContent !== undefined && { textContent }),
            updatedAt: new Date(),
        }).where(
            and(
                eq(ragAssets.id, id),
                organizationId !== undefined && organizationId !== null ? eq(ragAssets.organizationId, organizationId) : sql`${ragAssets.organizationId} IS NULL`
            )
        ).returning();

        if (result.length === 0) throw new NotFoundError("RAG asset not found", ErrorCode.NOT_FOUND, { assetId: id });

        if ((result[0] as RagAsset).selectionType === "custom") {
            await this.reindexAsset(result[0] as RagAsset);
        }

        return result[0];
    },

    /**
     * Delete a RAG asset
     */
    async deleteAsset(id: number, organizationId?: number | null) {
        const conditions = [
            eq(ragAssets.id, id),
            ...(organizationId !== undefined && organizationId !== null ? [eq(ragAssets.organizationId, organizationId)] : [sql`${ragAssets.organizationId} IS NULL`])
        ];
        const existing = await db.select().from(ragAssets).where(and(...conditions)).limit(1);
        if (!existing.length) throw new NotFoundError("RAG asset not found", ErrorCode.NOT_FOUND, { assetId: id });

        const asset = existing[0] as RagAsset;
        if (asset.selectionType === "custom") {
            try {
                await deleteAssetFromVectorStore(asset);
            } catch (vectorStoreError: any) {
                logger.error("Error deleting from vector store", vectorStoreError, { assetId: id });
            }
        }

        await db.delete(ragAssets).where(and(...conditions));
    },

    /**
     * Reorder RAG assets
     */
    async reorderAssets(assetIds: number[]) {
        const updates = assetIds.map((assetId, index) =>
            db.update(ragAssets).set({ order: index, updatedAt: new Date() }).where(eq(ragAssets.id, assetId))
        );
        await Promise.all(updates);

        return await db.select({ id: ragAssets.id, order: ragAssets.order })
            .from(ragAssets)
            .where(inArray(ragAssets.id, assetIds));
    },

    /**
     * List Job Outputs (Knowledge)
     */
    async listJobOutputs(jobId: number, options: {
        limit?: number,
        offset?: number,
        tags?: string[],
        organizationId?: number | null
    }) {
        const { limit = 50, offset = 0, tags, organizationId } = options;

        const conditions = [
            eq(jobs.id, jobId),
            ...(organizationId !== undefined && organizationId !== null ? [eq(jobs.organizationId, organizationId)] : [sql`${jobs.organizationId} IS NULL`])
        ];

        const [job] = await db.select().from(jobs).where(and(...conditions)).limit(1);
        if (!job) throw new NotFoundError("Job not found", ErrorCode.JOB_NOT_FOUND, { jobId });

        const outputConditions = [
            eq(jobOutputKnowledge.jobId, jobId),
            ...(organizationId !== undefined && organizationId !== null ? [eq(jobOutputKnowledge.organizationId, organizationId)] : [sql`${jobOutputKnowledge.organizationId} IS NULL`])
        ];
        if (tags && tags.length > 0) outputConditions.push(sql`${jobOutputKnowledge.tags} && ${tags}`);

        const outputs = await db.select({
            id: jobOutputKnowledge.id, jobId: jobOutputKnowledge.jobId, pipelineStepExecutionId: jobOutputKnowledge.pipelineStepExecutionId,
            knowledgeDocumentId: jobOutputKnowledge.knowledgeDocumentId, knowledgeTopicId: jobOutputKnowledge.knowledgeTopicId,
            output: jobOutputKnowledge.output, tags: jobOutputKnowledge.tags, executionMetadata: jobOutputKnowledge.executionMetadata,
            createdAt: jobOutputKnowledge.createdAt, topicName: knowledgeTopics.name, documentTitle: knowledgeDocuments.title,
        }).from(jobOutputKnowledge)
            .leftJoin(knowledgeTopics, eq(jobOutputKnowledge.knowledgeTopicId, knowledgeTopics.id))
            .leftJoin(knowledgeDocuments, eq(jobOutputKnowledge.knowledgeDocumentId, knowledgeDocuments.id))
            .where(and(...outputConditions)).orderBy(desc(jobOutputKnowledge.createdAt)).limit(limit).offset(offset);

        const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(jobOutputKnowledge).where(and(...outputConditions));

        return { outputs, total: count };
    },

    /**
     * Delete Job Output
     */
    async deleteJobOutput(id: number, organizationId: number | null) {
        const [jobOutput] = await db.select({ id: jobOutputKnowledge.id, knowledgeDocumentId: jobOutputKnowledge.knowledgeDocumentId, organizationId: jobOutputKnowledge.organizationId })
            .from(jobOutputKnowledge).where(eq(jobOutputKnowledge.id, id)).limit(1);

        if (!jobOutput) throw new NotFoundError("Job output not found", ErrorCode.NOT_FOUND, { outputId: id });

        if (organizationId !== null) {
            if (jobOutput.organizationId !== organizationId) throw new ForbiddenError("Access denied");
        } else {
            if (jobOutput.organizationId !== null) throw new ForbiddenError("Access denied");
        }

        if (jobOutput.knowledgeDocumentId) {
            const [doc] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, jobOutput.knowledgeDocumentId)).limit(1);
            if (doc) {
                await deleteKnowledgeDocumentVectors(doc);
                await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, jobOutput.knowledgeDocumentId));
            }
        }

        await db.delete(jobOutputKnowledge).where(eq(jobOutputKnowledge.id, id));
    },

    /**
     * Get nodes for a knowledge document
     */
    async getDocumentNodes(documentId: number, organizationId: number | null) {
        const [document] = await db.select().from(knowledgeDocuments)
            .where(and(eq(knowledgeDocuments.id, documentId), organizationId ? eq(knowledgeDocuments.organizationId, organizationId) : undefined))
            .limit(1);

        if (!document) throw new NotFoundError("Document not found", ErrorCode.NOT_FOUND, { documentId });

        const nodes = await db.select().from(knowledgeNodes).where(eq(knowledgeNodes.knowledgeDocumentId, documentId));
        return {
            documentId: document.id,
            documentTitle: document.title,
            documentCreatedAt: document.createdAt,
            nodes: nodes.map(node => ({
                nodeId: node.id,
                nodeName: node.name,
                nodeLabel: node.label,
                entityType: node.label,
                extractionSources: node.extractionSources || [],
            })),
        };
    },

    /**
     * Get latest knowledge document for a job
     */
    async getLatestJobDocument(jobId: number, organizationId: number | null) {
        const conditions = [eq(jobs.id, jobId), ...(organizationId !== null ? [eq(jobs.organizationId, organizationId)] : [sql`${jobs.organizationId} IS NULL`])];
        const [job] = await db.select().from(jobs).where(and(...conditions)).limit(1);
        if (!job) throw new NotFoundError("Job not found", ErrorCode.JOB_NOT_FOUND, { jobId });

        const outputConditions = [eq(jobOutputKnowledge.jobId, jobId), ...(organizationId !== null ? [eq(jobOutputKnowledge.organizationId, organizationId)] : [sql`${jobOutputKnowledge.organizationId} IS NULL`])];
        const [latestOutput] = await db.select({ knowledgeDocumentId: jobOutputKnowledge.knowledgeDocumentId }).from(jobOutputKnowledge)
            .where(and(...outputConditions)).orderBy(desc(jobOutputKnowledge.createdAt)).limit(1);

        return latestOutput?.knowledgeDocumentId || null;
    },

    /**
     * Get entity options for autocomplete
     */
    async getEntityOptions(type: string, organizationId: number | null) {
        const conditions = [
            eq(knowledgeNodes.label, type),
            sql`external_id IS NOT NULL`,
            ...(organizationId !== null ? [eq(knowledgeNodes.organizationId, organizationId)] : [sql`${knowledgeNodes.organizationId} IS NULL`])
        ];
        const nodes = await db.select({ name: knowledgeNodes.name, externalId: knowledgeNodes.externalId, id: knowledgeNodes.id })
            .from(knowledgeNodes).where(and(...conditions)).orderBy(knowledgeNodes.name).limit(200);
        return nodes.map(n => ({ label: n.name, value: n.externalId || String(n.id) }));
    },

    /**
     * Get knowledge document by ID
     */
    async getDocumentById(id: number, organizationId: number | null) {
        const conditions = [
            eq(knowledgeDocuments.id, id),
            ...(organizationId !== null ? [eq(knowledgeDocuments.organizationId, organizationId)] : [sql`${knowledgeDocuments.organizationId} IS NULL`])
        ];
        const [doc] = await db.select().from(knowledgeDocuments).where(and(...conditions)).limit(1);
        if (!doc) throw new NotFoundError("Knowledge document not found", ErrorCode.NOT_FOUND, { id });
        return doc;
    }
};


