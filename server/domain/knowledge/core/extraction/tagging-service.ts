import { db } from "../../../../database_service.js";
import { knowledgeDocuments, knowledgeTopics, knowledgeTopicDocuments } from "@shared/schema/index.js";
import { eq, and, sql, desc, inArray, ilike, isNull, or } from "drizzle-orm";
import { createLogger } from "../../../../utils/logger.js";
import { withQueryTracking } from "@domain/knowledge/core/query-monitor.service.js";
import type { OrgContext } from "../../../../domain/jobs/job.service.js";
import { getOrgConditions } from "../../../../utils/index.js";
import { reindexKnowledgeDocument } from "../../../../knowledge/knowledge-store.js";

const logger = createLogger("TaggingService");

export const taggingService = {
    /**
     * Discovers the top 10000 most common keywords across all documents 
     * and ensures they exist as Knowledge Topics.
     */
    async discoverTopTopics(orgContext: OrgContext): Promise<{ discovered: number, created: number, enriched: number }> {
        return withQueryTracking("taggingService.discoverTopTopics", async () => {
            const orgId = orgContext.organizationId;

            // 1. Fetch all document metadata to see what we have
            const conditions = getOrgConditions(orgContext, knowledgeDocuments);
            const docs = await db
                .select({ metadata: knowledgeDocuments.metadata })
                .from(knowledgeDocuments)
                .where(and(...conditions));

            logger.info('Performing discovery on existing documents', { count: docs.length });

            // 2. Count frequencies of keywords
            const frequencyMap = new Map<string, number>();
            docs.forEach(doc => {
                const keywords = (doc.metadata as any)?.keywords;
                if (Array.isArray(keywords)) {
                    keywords.forEach(kw => {
                        const normalized = kw.trim().toLowerCase();
                        if (normalized) {
                            frequencyMap.set(normalized, (frequencyMap.get(normalized) || 0) + 1);
                        }
                    });
                }
            });

            // 3. Sort and take top 100
            const sortedEntries = Array.from(frequencyMap.entries())
                .sort((a, b) => b[1] - a[1]);

            logger.info('Discovered top topics candidates', {
                totalKeywords: sortedEntries.length,
                top10: sortedEntries.slice(0, 10)
            });

            const top10000 = sortedEntries.slice(0, 10000);
            let created = 0;
            const discoveredIds: number[] = [];

            // 4. Ensure these exist as topics
            for (const [name] of top10000) {
                // Simple normalization for search
                const [existing] = await db
                    .select()
                    .from(knowledgeTopics)
                    .where(and(
                        eq(knowledgeTopics.organizationId, orgId as number),
                        ilike(knowledgeTopics.name, name)
                    ))
                    .limit(1);

                if (!existing) {
                    const [newTopic] = await db.insert(knowledgeTopics).values({
                        name: name.charAt(0).toUpperCase() + name.slice(1), // Title Case
                        organizationId: orgId as number,
                        description: `Automatically discovered high-frequency topic.`,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    }).returning();
                    discoveredIds.push(newTopic.id);
                    created++;
                } else {
                    discoveredIds.push(existing.id);
                }
            }

            // 5. Trigger enrichment and auto-tagging in background
            // This is non-blocking to prevent frontend timeouts
            this.batchEnrichDocuments(orgContext).then(enrichedCount => {
                logger.info('Background enrichment complete', { enrichedCount });
                // Re-run auto-tagging after enrichment to pick up matched topics for newly enriched docs
                return this.autoTagAllDocuments(orgContext);
            }).catch(err => {
                logger.error('Background enrichment/tagging failed', err);
            });

            return { discovered: discoveredIds.length, created, enriched: 0 };
        }, { table: "knowledge_topics", operation: "select" });
    },

    /**
     * Identifies documents without keywords and triggers AI enrichment.
     */
    async batchEnrichDocuments(orgContext: OrgContext): Promise<number> {
        const conditions = getOrgConditions(orgContext, knowledgeDocuments);

        // Find documents missing keywords in metadata
        const legacyDocs = await db
            .select()
            .from(knowledgeDocuments)
            .where(and(
                ...conditions,
                or(
                    isNull(sql`${knowledgeDocuments.metadata}->'keywords'`),
                    sql`jsonb_array_length(COALESCE(${knowledgeDocuments.metadata}->'keywords', '[]'::jsonb)) = 0`
                )
            ));

        logger.info('Found legacy documents for enrichment', { count: legacyDocs.length });

        let count = 0;
        // Process in small serial batches to avoid rate limits
        for (const doc of legacyDocs) {
            try {
                await reindexKnowledgeDocument(doc);
                count++;
                // Small delay to be polite to AI
                if (count % 5 === 0) await new Promise(r => setTimeout(r, 1000));
            } catch (e) {
                logger.warn(`Failed to enrich legacy doc ${doc.id}`, { error: e });
            }
        }

        return count;
    },

    /**
     * Automatically assigns topics to a document based on its keywords.
     */
    async autoTagDocument(documentId: number, orgContext: OrgContext): Promise<number> {
        return withQueryTracking("taggingService.autoTagDocument", async () => {
            const [doc] = await db
                .select()
                .from(knowledgeDocuments)
                .where(eq(knowledgeDocuments.id, documentId))
                .limit(1);

            if (!doc) return 0;

            const keywords = (doc.metadata as any)?.keywords;
            if (!Array.isArray(keywords) || keywords.length === 0) return 0;

            // Find topics that match keywords
            const topics = await db
                .select()
                .from(knowledgeTopics)
                .where(and(
                    eq(knowledgeTopics.organizationId, orgContext.organizationId as number)
                ));

            const matchedTopicIds: number[] = [];
            const normalizedKeywords = keywords.map(kw => kw.trim().toLowerCase());

            topics.forEach(topic => {
                if (normalizedKeywords.includes(topic.name.toLowerCase())) {
                    matchedTopicIds.push(topic.id);
                }
            });

            if (matchedTopicIds.length > 0) {
                // Only insert if not already linked
                for (const topicId of matchedTopicIds) {
                    const [existing] = await db
                        .select()
                        .from(knowledgeTopicDocuments)
                        .where(and(
                            eq(knowledgeTopicDocuments.documentId, documentId),
                            eq(knowledgeTopicDocuments.topicId, topicId)
                        ))
                        .limit(1);

                    if (!existing) {
                        await db.insert(knowledgeTopicDocuments).values({
                            documentId,
                            topicId,
                            createdAt: new Date()
                        });
                    }
                }
            }

            return matchedTopicIds.length;
        }, { table: "knowledge_topic_documents", operation: "insert" });
    },

    /**
     * Batch auto-tags all documents.
     */
    async autoTagAllDocuments(orgContext: OrgContext): Promise<void> {
        const documents = await db
            .select({ id: knowledgeDocuments.id })
            .from(knowledgeDocuments)
            .where(and(...getOrgConditions(orgContext, knowledgeDocuments)));

        for (const doc of documents) {
            await this.autoTagDocument(doc.id, orgContext);
        }
        logger.info('Finished batch auto-tagging', { docCount: documents.length });
    }
};


