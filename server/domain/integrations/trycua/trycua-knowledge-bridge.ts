import { db } from "../../../db/index.js";
import {
    knowledgeNodes,
    knowledgeTopics,
    knowledgeEdges,
} from "../../../../shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { createLogger } from "../../../utils/logger.js";

const logger = createLogger("TrycuaKnowledgeBridge");

export const trycuaKnowledgeBridge = {
    /**
     * Register Trycua integration into the knowledge graph.
     */
    async registerIntegration(organizationId: number = 1): Promise<{
        success: boolean;
        nodeId?: number;
        message?: string;
    }> {
        try {
            // 1. Find or create Integrations topic
            let topicId: number;
            const [existingTopic] = await db
                .select()
                .from(knowledgeTopics)
                .where(and(
                    eq(knowledgeTopics.organizationId, organizationId),
                    eq(knowledgeTopics.name, "Integrations")
                ))
                .limit(1);

            if (existingTopic) {
                topicId = existingTopic.id;
            } else {
                const [newTopic] = await db.insert(knowledgeTopics).values({
                    organizationId,
                    name: "Integrations",
                    description: "Third-party integrations and services",
                }).returning();
                topicId = newTopic.id;
            }

            // 2. Check if Trycua node already exists
            const [existingNode] = await db
                .select()
                .from(knowledgeNodes)
                .where(and(
                    eq(knowledgeNodes.organizationId, organizationId),
                    eq(knowledgeNodes.label, "Integration"),
                    eq(knowledgeNodes.name, "Trycua")
                ))
                .limit(1);

            if (existingNode) {
                logger.info("Trycua integration already registered in knowledge graph");
                return { success: true, nodeId: existingNode.id, message: "Already registered" };
            }

            // 3. Create Trycua node
            const [trycuaNode] = await db.insert(knowledgeNodes).values({
                organizationId,
                knowledgeTopicId: topicId,
                label: "Integration",
                name: "Trycua",
                data: {
                    description: "Computer Use and desktop automation integration. Enables agents to observe sessions, propose grounded actions, and execute computer tasks.",
                    capabilities: [
                        "Computer Use",
                        "Session Observation",
                        "Task Replay",
                        "Autonomous Loop",
                        "DOM Extraction",
                        "Scraped Content Exfiltration",
                    ],
                    services: [
                        "computer-use-task.service",
                        "computer-intelligence.service",
                        "learned-skills.service",
                    ],
                    status: "active",
                },
                verificationStatus: "verified",
            }).returning();

            logger.info(`Registered Trycua integration with node ID ${trycuaNode.id}`);
            return { success: true, nodeId: trycuaNode.id, message: "Registered successfully" };
        } catch (error: any) {
            logger.error("Failed to register Trycua integration", error);
            return { success: false, message: error.message };
        }
    },

    /**
     * File a DOM extract as knowledge: a Knowledge Document, a WebPage node in the
     * graph, and an edge from the Trycua integration node.
     *
     * The document is written through knowledgeService.createDocument, not with a
     * plain insert. That is what queues the embedding, so the extract is findable
     * by semantic search rather than only by SQL; it is also what upserts on
     * (project_id, title), which a plain insert violated the second time the same
     * page was extracted - and the violation was swallowed into `success: false`.
     */
    async ingestScrapedContent(input: {
        organizationId: number;
        userId?: string;
        title: string;
        url?: string;
        content: string;
        sourceSessionId?: string;
        metadata?: Record<string, unknown>;
    }): Promise<{
        success: boolean;
        documentId?: number;
        nodeId?: number;
        indexedForSearch?: boolean;
        message?: string;
    }> {
        try {
            const reg = await this.registerIntegration(input.organizationId);
            const topicId = await this.ensureTopic(
                input.organizationId,
                "Web Scraping",
                "Content extracted from browser sessions and web pages via Trycua Computer Use",
            );

            const summary = `Extracted web content (${input.content.length} chars) from ${input.url || "browser"}`;
            const { knowledgeService } = await import("@domain/knowledge/core/knowledge.service.js");
            const document = await knowledgeService.createDocument({
                title: input.title.slice(0, 200),
                summary,
                sourceType: "integration",
                contentType: "text/plain",
                url: input.url,
                textContent: input.content,
                topicIds: [topicId],
                metadata: {
                    ...(input.metadata ?? {}),
                    sourceSessionId: input.sourceSessionId,
                    ingestedAt: new Date().toISOString(),
                    origin: "trycua_dom_extract",
                },
            }, {
                organizationId: input.organizationId,
                userId: input.userId,
                isAdmin: false,
                isSuperAdmin: false,
                isOrgAdmin: false,
            } as any);

            // One node per document: re-extracting a page updates the document
            // through the upsert, and must not grow a second WebPage beside it.
            const [existingNode] = await db
                .select()
                .from(knowledgeNodes)
                .where(and(
                    eq(knowledgeNodes.organizationId, input.organizationId),
                    eq(knowledgeNodes.knowledgeDocumentId, document.id),
                ))
                .limit(1);

            const nodeValues = {
                organizationId: input.organizationId,
                knowledgeTopicId: topicId,
                knowledgeDocumentId: document.id,
                label: "WebPage",
                name: input.title.slice(0, 100),
                data: {
                    url: input.url,
                    charCount: input.content.length,
                    summary,
                    sourceSessionId: input.sourceSessionId,
                },
                verificationStatus: "verified",
            };

            const node = existingNode
                ? (await db.update(knowledgeNodes).set(nodeValues).where(eq(knowledgeNodes.id, existingNode.id)).returning())[0]
                : (await db.insert(knowledgeNodes).values(nodeValues).returning())[0];

            if (reg.nodeId && node.id && !existingNode) {
                await db.insert(knowledgeEdges).values({
                    sourceId: reg.nodeId,
                    targetId: node.id,
                    relation: "RELATED_TO",
                    weight: 1,
                }).catch((err) => logger.warn("Could not link the extract to the Trycua node", { error: err?.message }));
            }

            // createDocument writes qdrant_point_id only once the vector store
            // confirms, so this reports what is actually retrievable - not the
            // intention to index.
            const indexedForSearch = Boolean((document as { qdrantPointId?: string | null }).qdrantPointId);

            logger.info("Filed a DOM extract as knowledge", {
                organizationId: input.organizationId,
                documentId: document.id,
                nodeId: node.id,
                indexedForSearch,
            });

            return {
                success: true,
                documentId: document.id,
                nodeId: node.id,
                indexedForSearch,
                message: indexedForSearch
                    ? `Filed as document #${document.id} (node #${node.id}) and indexed for search`
                    : `Filed as document #${document.id} (node #${node.id}); the search index is still catching up (npm run knowledge:backfill-index)`,
            };
        } catch (error: any) {
            logger.error("Failed to file a DOM extract as knowledge", error);
            return {
                success: false,
                message: error?.message || "Failed to ingest scraped content",
            };
        }
    },

    /** Find or create a topic by name for this org. */
    async ensureTopic(organizationId: number, name: string, description: string): Promise<number> {
        const [existing] = await db
            .select()
            .from(knowledgeTopics)
            .where(and(
                eq(knowledgeTopics.organizationId, organizationId),
                eq(knowledgeTopics.name, name),
            ))
            .limit(1);
        if (existing) return existing.id;

        const [created] = await db.insert(knowledgeTopics).values({
            organizationId,
            name,
            description,
        }).returning();
        return created.id;
    },
};
