
import { db } from "../../../../database_service.js";
import { knowledgeDocuments, knowledgeTopics, knowledgeTopicDocuments, users } from "@shared/schema/index.js";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { NotFoundError } from "@server/utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";
import { withQueryTracking } from "@domain/knowledge/core/query-monitor.service.js";
import type { OrgContext } from "../../../../domain/jobs/job.service.js";
import { getOrgConditions } from "../../../../utils/index.js";
import { randomUUID } from "crypto";

const logger = createLogger("DocumentService");

// In-memory progress tracking for re-indexing
const reindexProgress = new Map<number, {
    total: number;
    processed: number;
    errors: number;
    active: boolean;
    lastUpdated: Date;
}>();

export const documentService = {

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
     * List knowledge documents
     */
    async listDocuments(orgContext: OrgContext, options: {
        topicId?: number;
        topicIds?: number[];
        limit?: number;
        offset?: number;
    } = {}): Promise<any[]> {
        return withQueryTracking("documentService.listDocuments", async () => {
            // If an organization is selected, we usually want to EXCLUDE global system documents 
            // unless explicitly requested otherwise. 
            const allowGlobal = !orgContext.organizationId;
            const conditions = getOrgConditions(orgContext, knowledgeDocuments, allowGlobal);

            const activeTopicIds = options.topicIds || (options.topicId ? [options.topicId] : []);

            if (activeTopicIds.length > 0) {
                // Determine documents linked to topics
                const relations = await db
                    .select({ documentId: knowledgeTopicDocuments.documentId })
                    .from(knowledgeTopicDocuments)
                    .where(inArray(knowledgeTopicDocuments.topicId, activeTopicIds));

                const docIds = relations.map(r => r.documentId);
                if (!docIds.length) return [];

                conditions.push(inArray(knowledgeDocuments.id, docIds));
            }

            let query = db
                .select({
                    document: knowledgeDocuments,
                    extraction: {
                        status: sql<string>`(
                            SELECT status 
                            FROM knowledge_document_extractions 
                            WHERE document_id = ${knowledgeDocuments.id} 
                            ORDER BY id DESC 
                            LIMIT 1
                        )`,
                        progress: sql<number>`(
                            SELECT progress 
                            FROM knowledge_document_extractions 
                            WHERE document_id = ${knowledgeDocuments.id} 
                            ORDER BY id DESC 
                            LIMIT 1
                        )`
                    }
                })
                .from(knowledgeDocuments)
                .where(and(...conditions))
                .orderBy(desc(knowledgeDocuments.updatedAt));

            if (options.limit) query = query.limit(options.limit) as typeof query;
            if (options.offset) query = query.offset(options.offset) as typeof query;

            const results = await query;

            // Enrich with topics
            const docIds = results.map(r => r.document.id);
            const topicMap = await this.getDocumentTopicsMap(docIds);

            return results.map(row => ({
                ...row.document,
                extractionStatus: row.extraction.status,
                extractionProgress: row.extraction.progress,
                topics: topicMap.get(row.document.id) || []
            }));
        }, { table: "knowledge_documents", operation: "select" });
    },

    /**
     * Get knowledge document by ID
     */
    async getDocumentById(documentId: number, orgContext: OrgContext): Promise<any> {
        return withQueryTracking("documentService.getDocumentById", async () => {
            const conditions = [
                eq(knowledgeDocuments.id, documentId),
                ...getOrgConditions(orgContext, knowledgeDocuments)
            ];

            const [doc] = await db
                .select()
                .from(knowledgeDocuments)
                .where(and(...conditions))
                .limit(1);

            if (!doc) throw new NotFoundError("Document not found");

            // Enrich with topics
            const topicMap = await this.getDocumentTopicsMap([doc.id]);

            return {
                ...doc,
                topics: topicMap.get(doc.id) || []
            };
        }, { table: "knowledge_documents", operation: "select" });
    },

    /**
     * Find documents by metadata
     */
    async findDocumentsByMetadata(orgContext: OrgContext, key: string, value: string): Promise<any[]> {
        return withQueryTracking("documentService.findDocumentsByMetadata", async () => {
            const conditions = [
                ...getOrgConditions(orgContext, knowledgeDocuments),
                sql`metadata->>${key} = ${value}`
            ];

            return await db
                .select()
                .from(knowledgeDocuments)
                .where(and(...conditions));
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
        topicNames?: string[];
        /** Project Space the document files under; defaults to the org's default project. */
        projectId?: number | null;
        datasetId?: string | number | null;
        datasetItemId?: number | null;
    }, orgContext: OrgContext): Promise<any> {
        return withQueryTracking("documentService.createDocument", async () => {
            // Get user for createdBy
            let createdBy: string | null = null;
            if (orgContext.userId) {
                const [user] = await db.select({ username: users.username }).from(users).where(eq(users.id, orgContext.userId)).limit(1);
                createdBy = user?.username ?? null;
            }

            // --- ADDED: Dataset Item Storage with Logical Linking ---
            let datasetItemId: number | null = input.datasetItemId || null;
            if (input.datasetId && !datasetItemId) {
                try {
                    const { datasetService } = await import("../dataset-service.js");
                    const structuredData = input.metadata || { content: input.textContent, title: input.title };

                    const item = await datasetService.addItem(
                        typeof input.datasetId === 'string' ? parseInt(input.datasetId) : (input.datasetId as number),
                        {
                            data: structuredData,
                            rawData: structuredData
                        },
                        orgContext
                    );
                    datasetItemId = item.id;
                    logger.info('Added document to dataset (Logical Link)', { datasetId: input.datasetId, datasetItemId });
                } catch (datasetErr) {
                    logger.error('Failed to add document to dataset (non-blocking)', datasetErr);
                }
            }

            const insertValues: any = {
                title: input.title,
                summary: input.summary,
                sourceType: input.sourceType || "upload",
                textContent: input.textContent,
                url: input.url,
                fileData: input.fileData,
                contentType: input.contentType,
                fileSize: input.fileSize,
                metadata: input.datasetId ? { datasetItemId } : input.metadata, // Logical link: store full metadata in dataset_item
                organizationId: orgContext.organizationId,
                createdBy,
                // NOT stamped here. `qdrant_point_id` means "this document is in
                // the vector store", so it is written only once the store has
                // confirmed the write — see the reindex block below.
                qdrantPointId: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            if (datasetItemId !== null && datasetItemId !== undefined) {
                insertValues.datasetItemId = datasetItemId;
            }

            // Document titles are namespaced per project, so the upsert below keys on
            // project_id. It MUST be non-null: Postgres treats NULLs as distinct, so a
            // null project would turn this idempotent upsert into a duplicate insert.
            const { projectService } = await import("@domain/projects/core/project.service.js");
            insertValues.projectId =
                input.projectId
                ?? await projectService.resolveDefaultProjectId(orgContext.organizationId as number);

            let document;
            try {
                // Idempotent ingest: (project_id, title) is UNIQUE
                // (knowledge_docs_project_title_unique). Re-ingesting the same titled
                // doc — e.g. re-publishing a PRD via the SDLC local-artifact
                // fallback — updates the existing row instead of throwing.
                const [inserted] = await db
                    .insert(knowledgeDocuments)
                    .values(insertValues)
                    .onConflictDoUpdate({
                        target: [knowledgeDocuments.projectId, knowledgeDocuments.title],
                        set: {
                            summary: insertValues.summary,
                            textContent: insertValues.textContent,
                            sourceType: insertValues.sourceType,
                            url: insertValues.url,
                            metadata: insertValues.metadata,
                            updatedAt: new Date(),
                        },
                    })
                    .returning();
                document = inserted;
            } catch (insertErr) {
                logger.error('Failed to insert document into DB', insertErr);
                throw insertErr;
            }

            if (input.topicIds?.length || input.topicNames?.length) {
                const finalTopicIds = [...(input.topicIds || [])];

                if (input.topicNames?.length) {
                    const { topicService } = await import("../topic-service.js");
                    for (const name of input.topicNames) {
                        if (!name.trim()) continue;
                        // Check if topic exists
                        const existingTopics = await topicService.findTopicByName(name.trim(), orgContext);
                        const exactMatch = existingTopics.find(t => t.name.toLowerCase() === name.trim().toLowerCase());

                        if (exactMatch) {
                            if (!finalTopicIds.includes(exactMatch.id)) {
                                finalTopicIds.push(exactMatch.id);
                            }
                        } else {
                            // Create new topic
                            const newTopic = await topicService.createTopic({ name: name.trim() }, orgContext);
                            finalTopicIds.push(newTopic.id);
                        }
                    }
                }

                if (finalTopicIds.length > 0) {
                    const topicAssignments = finalTopicIds.map((topicId) => ({
                        topicId,
                        documentId: document.id,
                    }));
                    // The document insert above is an upsert, so re-ingesting an
                    // already-filed document reuses its id and arrives here with
                    // the same (topic_id, document_id) pair — the composite
                    // primary key. Without this, re-ingest threw a duplicate key.
                    await db.insert(knowledgeTopicDocuments).values(topicAssignments).onConflictDoNothing();
                }
            }

            // Trigger reindexing asynchronously.
            //
            // The point id is the vector-store KEY, so it has to be decided
            // before indexing — but it is PERSISTED only after the store confirms
            // the write. Previously it was stamped at insert, so a row claimed to
            // be indexed the instant it existed; when embedding failed, nothing
            // recorded the gap and the document was silently unfindable forever.
            // That is how completed research briefings never came back from
            // search. With this contract, `qdrant_point_id IS NOT NULL` means the
            // document is genuinely retrievable, and NULL is a backfill worklist.
            //
            // Re-ingest reuses the existing key rather than minting a new one:
            // the upsert leaves the old id in place, and a fresh UUID would
            // orphan the points already written under the old key.
            const pointId = (document as any).qdrantPointId ?? randomUUID();
            import("../../../../knowledge/knowledge-store.js")
                .then(async ({ reindexKnowledgeDocument }) => {
                    const result = await reindexKnowledgeDocument({ ...(document as any), qdrantPointId: pointId });
                    await db
                        .update(knowledgeDocuments)
                        // `indexed: false` is the honest "nothing to embed" case;
                        // it must not be recorded as indexed either.
                        .set({ qdrantPointId: result.indexed ? pointId : null })
                        .where(eq(knowledgeDocuments.id, document.id));
                })
                .catch(async (err: any) => {
                    logger.error('Failed to reindex document (non-blocking)', err, { documentId: document.id });
                    try {
                        await db
                            .update(knowledgeDocuments)
                            .set({ qdrantPointId: null })
                            .where(eq(knowledgeDocuments.id, document.id));
                    } catch (clearErr: any) {
                        logger.error('Failed to clear qdrantPointId after reindex failure', clearErr, { documentId: document.id });
                    }
                });

            // Trigger Auto-Linking asynchronously (Phase 2)
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
     * Create multiple knowledge documents (Batch)
     */
    async createDocumentsBatch(inputs: any[], orgContext: OrgContext): Promise<any[]> {
        return withQueryTracking("documentService.createDocumentsBatch", async () => {
            if (!inputs.length) return [];

            let createdBy: string | null = null;
            if (orgContext.userId) {
                const [user] = await db.select({ username: users.username }).from(users).where(eq(users.id, orgContext.userId)).limit(1);
                createdBy = user?.username ?? null;
            }

            // 1. Handle Dataset Logic first (collect items for batch insert)
            let datasetItemIds: (number | null)[] = new Array(inputs.length).fill(null);
            const datasetId = inputs[0]?.datasetId; // Assuming one dataset per batch for performance

            if (datasetId) {
                try {
                    const { datasetService } = await import("../dataset-service.js");
                    const itemsToAdd = inputs.map(input => ({
                        data: input.metadata || { content: input.textContent, title: input.title },
                        rawData: input.metadata || { content: input.textContent, title: input.title }
                    }));

                    const result = await datasetService.addItems(
                        typeof datasetId === 'string' ? parseInt(datasetId) : (datasetId as number),
                        itemsToAdd,
                        orgContext
                    );

                    if (result.items) {
                        datasetItemIds = result.items.map((item: any) => item.id);
                    }
                    logger.info('Batch added documents to dataset (Logical Link)', { datasetId, count: result.inserted });
                } catch (datasetErr) {
                    logger.error('Failed to add batch documents to dataset (non-blocking)', datasetErr);
                }
            }

            const docsToInsert: (typeof knowledgeDocuments.$inferInsert)[] = inputs.map((input, idx) => {
                const datasetItemId = datasetItemIds[idx];
                const docValues: typeof knowledgeDocuments.$inferInsert = {
                    title: input.title,
                    summary: input.summary || input.textContent?.substring(0, 200) || null,
                    sourceType: input.sourceType || "upload",
                    textContent: input.textContent,
                    url: input.url,
                    fileData: input.fileData,
                    contentType: input.contentType,
                    fileSize: input.fileSize,
                    metadata: datasetId ? { datasetItemId } : input.metadata,
                    organizationId: orgContext.organizationId,
                    createdBy,
                    // Written only after the vector store confirms — see below.
                    qdrantPointId: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };
                if (datasetItemId !== null && datasetItemId !== undefined) {
                    docValues.datasetItemId = datasetItemId;
                }
                return docValues;
            });

            const createdDocs = await db.insert(knowledgeDocuments).values(docsToInsert).returning();

            // 2. Handle topics in batch
            const topicAssignments: any[] = [];
            for (let i = 0; i < createdDocs.length; i++) {
                const input = inputs[i];
                const doc = createdDocs[i];
                if (input.topicIds?.length) {
                    input.topicIds.forEach((topicId: number) => {
                        topicAssignments.push({ topicId, documentId: doc.id });
                    });
                }
            }

            if (topicAssignments.length > 0) {
                // Same reason as createDocument: re-filing a document under a
                // topic it already carries collides on the composite key.
                await db.insert(knowledgeTopicDocuments).values(topicAssignments).onConflictDoNothing();
            }

            // 3. Trigger reindexing asynchronously (Batch-optimized)
            //
            // Same contract as createDocument: the key is chosen up front, the
            // column is written only once the store confirms. A batch import that
            // half-succeeds must leave the failed rows selectable by
            // `qdrant_point_id IS NULL` rather than uniformly claiming success.
            import("../../../../knowledge/knowledge-store.js")
                .then(({ reindexKnowledgeDocument }) => {
                    for (const doc of createdDocs) {
                        const pointId = (doc as any).qdrantPointId ?? randomUUID();
                        reindexKnowledgeDocument({ ...(doc as any), qdrantPointId: pointId })
                            .then(async (result) => {
                                if (!result.indexed) return;
                                await db
                                    .update(knowledgeDocuments)
                                    .set({ qdrantPointId: pointId })
                                    .where(eq(knowledgeDocuments.id, doc.id));
                            })
                            .catch((err: any) =>
                                logger.error('Batch reindex error', err, { documentId: doc.id }),
                            );
                    }
                })
                .catch((err: any) => logger.error('Batch reindex module load failed', err));

            logger.info('Batch documents created', { count: createdDocs.length });

            return createdDocs;
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
        topicNames?: string[];
    }, orgContext: OrgContext): Promise<any> {
        return withQueryTracking("documentService.updateDocument", async () => {
            const conditions = [eq(knowledgeDocuments.id, documentId), ...getOrgConditions(orgContext, knowledgeDocuments)];

            // Check existence
            const [existing] = await db.select().from(knowledgeDocuments).where(and(...conditions)).limit(1);
            if (!existing) throw new NotFoundError("Document not found");

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

            if (input.topicIds !== undefined || input.topicNames !== undefined) {
                await db.delete(knowledgeTopicDocuments).where(eq(knowledgeTopicDocuments.documentId, documentId));

                const finalTopicIds = [...(input.topicIds || [])];

                if (input.topicNames?.length) {
                    const { topicService } = await import("../topic-service.js");
                    for (const name of input.topicNames) {
                        if (!name.trim()) continue;
                        const existingTopics = await topicService.findTopicByName(name.trim(), orgContext);
                        const exactMatch = existingTopics.find(t => t.name.toLowerCase() === name.trim().toLowerCase());

                        if (exactMatch) {
                            if (!finalTopicIds.includes(exactMatch.id)) {
                                finalTopicIds.push(exactMatch.id);
                            }
                        } else {
                            const newTopic = await topicService.createTopic({ name: name.trim() }, orgContext);
                            finalTopicIds.push(newTopic.id);
                        }
                    }
                }

                if (finalTopicIds.length > 0) {
                    const topicAssignments = finalTopicIds.map((topicId) => ({ topicId, documentId }));
                    // Composite (topic_id, document_id) key — re-filing collides.
                    await db.insert(knowledgeTopicDocuments).values(topicAssignments).onConflictDoNothing();
                }
            }

            // Trigger reindexing.
            //
            // The point id is reconciled in BOTH directions here: an edit that
            // finally embeds cleanly earns the id it never had, and one that now
            // fails gives up the id it used to have. Leaving it untouched let a
            // stale claim survive every subsequent edit.
            const updatedPointId = (updated as any).qdrantPointId ?? randomUUID();
            import("../../../../knowledge/knowledge-store.js")
                .then(async ({ reindexKnowledgeDocument }) => {
                    const result = await reindexKnowledgeDocument({ ...(updated as any), qdrantPointId: updatedPointId });
                    await db
                        .update(knowledgeDocuments)
                        .set({ qdrantPointId: result.indexed ? updatedPointId : null })
                        .where(eq(knowledgeDocuments.id, documentId));
                })
                .catch(async (err: any) => {
                    logger.error('Failed to reindex document', err, { documentId });
                    try {
                        await db
                            .update(knowledgeDocuments)
                            .set({ qdrantPointId: null })
                            .where(eq(knowledgeDocuments.id, documentId));
                    } catch (clearErr: any) {
                        logger.error('Failed to clear qdrantPointId after reindex failure', clearErr, { documentId });
                    }
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
        return withQueryTracking("documentService.deleteDocument", async () => {
            const conditions = [eq(knowledgeDocuments.id, documentId), ...getOrgConditions(orgContext, knowledgeDocuments)];

            const [existing] = await db.select().from(knowledgeDocuments).where(and(...conditions)).limit(1);
            if (!existing) throw new NotFoundError("Document not found");

            // Delete from DB
            await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, documentId));

            // Delete vectors
            if (existing.qdrantPointId) {
                import("../../../../knowledge/knowledge-store.js").then(({ deleteKnowledgeDocumentVectors }) => {
                    deleteKnowledgeDocumentVectors(existing as any).catch((err: any) =>
                        logger.error('Vector deletion error', err, { documentId })
                    );
                });
            }

            logger.info('Document deleted', { documentId });
        }, { table: "knowledge_documents", operation: "delete" });
    },

    /**
     * Delete all documents (utility)
     */
    async deleteAllDocuments(orgContext: OrgContext): Promise<number> {
        return withQueryTracking("documentService.deleteAllDocuments", async () => {
            const conditions = getOrgConditions(orgContext, knowledgeDocuments);
            const toDelete = await db.select().from(knowledgeDocuments).where(and(...conditions));

            if (toDelete.length === 0) return 0;

            await db.delete(knowledgeDocuments).where(and(...conditions));

            const { deleteKnowledgeDocumentVectors } = await import("../../../../knowledge/knowledge-store.js");

            toDelete.forEach((doc) => {
                if (doc.qdrantPointId) {
                    deleteKnowledgeDocumentVectors(doc as any).catch((err: any) =>
                        logger.error('Vector deletion error', err, { documentId: doc.id })
                    );
                }
            });

            return toDelete.length;
        }, { table: "knowledge_documents", operation: "delete" });
    },

    /**
     * Re-index ALL knowledge documents
     */
    async reindexAllDocuments(orgContext: OrgContext): Promise<{ count: number; errors: number }> {
        return withQueryTracking("documentService.reindexAllDocuments", async () => {
            const orgId = orgContext.organizationId as number || 0;
            const conditions = getOrgConditions(orgContext, knowledgeDocuments);
            const docs = await db.select().from(knowledgeDocuments).where(and(...conditions));

            const { reindexKnowledgeDocument } = await import("../../../../knowledge/knowledge-store.js");

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
                    await reindexKnowledgeDocument(doc as any);
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


