
/**
 * Auto-Linking Service
 * 
 * Automatically extracts entities and relationships from document content
 * and populates the Knowledge Graph with 'staging' nodes for review.
 */

import { db } from "@server/database_service.js";
import { knowledgeNodes, knowledgeEdges, type KnowledgeNode } from "../../../../shared/schema/index.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { knowledgeService } from "../knowledge.service.js";
import { createLogger } from "@server/utils/logger.js";
import type { OrgContext } from "../../jobs/job.service.js";
import { aiConfigResolver } from "../../ai/core/ai-config-resolver.js";
import { eq } from "drizzle-orm";
import { ExternalServiceError, AppError, ErrorCode } from "@server/utils/errors.js";
import { withRetry } from "../../../../shared/utils/errorHandling.js";
import { normalizeExtractionResult, type ExtractionResult } from "./extraction-normalizer.js";

const logger = createLogger("AutoLinkingService");

export const autoLinkingService = {

    /**
     * Process a document for auto-linking
     * @param documentId Knowledge Document ID
     * @param textContent Extracted text content from the document
     * @param orgContext Organization context
     */
    async processDocument(
        documentId: number,
        textContent: string,
        orgContext: OrgContext
    ): Promise<void> {
        if (!orgContext.organizationId) {
            logger.warn("Skipping auto-linking: No organization context", { documentId });
            return;
        }

        logger.info("Starting auto-linking for document", { documentId });

        try {
            // 1. Extract Entities & Relationships via LLM
            const extraction = await this.extractFromText(textContent, orgContext);

            if (!extraction) {
                logger.warn("No extraction results returned from LLM", { documentId });
                return;
            }

            logger.info("Extracted elements", {
                documentId,
                entityCount: extraction.entities.length,
                relCount: extraction.relationships.length
            });

            // 2. Create Nodes (Staging)
            const nodeMap = new Map<string, KnowledgeNode>();

            for (const entity of extraction.entities) {
                try {
                    // Check if node already exists (optional: deduping strategy could be more complex)
                    // For now, always create new staging nodes or link to existing if externalId matches?
                    // Design choice: Auto-linking creates STAGING nodes. 
                    // If a verified node exists with same name, we might want to link to it instead of creating a duplicate staging one.
                    // But for safety, let's create staging nodes and let the review process handle merging.

                    // Actually, 'verificationStatus' field is on the node.
                    // We should check if a node with this name/label already exists.
                    // If verified, we use it. If not, we create/update staging.

                    let node: KnowledgeNode;

                    // Check for existing node (simple name match for now)
                    const { nodes: existingNodes } = await knowledgeService.searchNodes(orgContext, {
                        label: entity.label,
                        query: entity.name,
                        limit: 1
                    });

                    const match = existingNodes.find((n: KnowledgeNode) => n.name.toLowerCase() === entity.name.toLowerCase());

                    if (match) {
                        node = match;
                        // If logic requires updating, we could do it here, but let's avoid touching verified nodes automatically.
                    } else {
                        // Create new staging node
                        node = await knowledgeService.createNode({
                            name: entity.name,
                            label: entity.label,
                            description: entity.description,
                            knowledgeDocumentId: documentId,
                            verificationStatus: "staging",
                            confidenceScore: entity.confidenceScore || 0.8,
                            properties: entity.properties
                        }, orgContext);
                    }

                    // Store for relationship creation (map by name for now, assuming unique names in extraction)
                    nodeMap.set(entity.name, node);
                    if (entity.externalId) nodeMap.set(entity.externalId, node);

                } catch (err) {
                    logger.error("Failed to create entity node", err, { entity });
                }
            }

            // 3. Create Edges
            for (const rel of extraction.relationships) {
                try {
                    const sourceNode = nodeMap.get(rel.source);
                    const targetNode = nodeMap.get(rel.target);

                    if (sourceNode && targetNode) {
                        await knowledgeService.createEdge({
                            sourceNodeId: sourceNode.id,
                            targetNodeId: targetNode.id,
                            relation: rel.relation,
                            weight: rel.weight || 1,
                            properties: { description: rel.description }
                        }, orgContext);
                    } else {
                        // logger.debug("Skipping edge: Node not found", { source: rel.source, target: rel.target });
                    }
                } catch (err) {
                    logger.error("Failed to create edge", err, { rel });
                }
            }

            logger.info("Auto-linking completed", { documentId });

        } catch (error) {
            logger.error("Auto-linking failed", error, { documentId });
            // Re-throw as AppError if not already one
            if (error instanceof AppError) throw error;
            throw new AppError(
                `Auto-linking failed for document ${documentId}: ${error instanceof Error ? error.message : String(error)}`,
                500,
                ErrorCode.INTERNAL_ERROR
            );
        }
    },

    /**
     * Call LLM to extract graph data
     */
    async extractFromText(text: string, orgContext: OrgContext): Promise<ExtractionResult | null> {
        // Truncate text if too long (simple safety, better splitting strategy needed for large docs)
        const content = text.slice(0, 15000);

        const systemPrompt = `
You are a Knowledge Graph Entity Extractor.
Analyze the provided text and extract entities and relationships.
Output strictly valid JSON.

Schema:
{
  "entities": [
    { 
      "name": "string", 
      "label": "Person" | "Organization" | "Location" | "Topic" | "Concept", 
      "description": "short summary",
      "confidenceScore": number (0-1)
    }
  ],
  "relationships": [
    {
      "source": "entity name",
      "target": "entity name",
      "relation": "verb phrase (e.g. works_at, located_in, related_to)",
      "description": "context"
    }
  ]
}

Focus on importance. High confidence only.
`;

        // Resolve credentials from organization or system fallbacks
        const aiConfig = await aiConfigResolver.resolveOrgConfig('concierge', orgContext.organizationId, orgContext.isSuperAdmin);

        if (!aiConfig) {
            logger.warn("No AI configuration available for auto-linking");
            return null;
        }

        try {
            const client = AIClientFactory.getClient({
                provider: aiConfig.provider,
                model: aiConfig.model
            } as any);

            const response = await withRetry(async () => {
                const res = await client.execute({
                    userPrompt: content,
                    systemPrompt: systemPrompt,
                    model: aiConfig.model,
                    requestType: "json",
                    maxTokens: 4000,
                    credentialId: aiConfig.credentialId,
                    temperature: 0.1,
                    useCache: true,
                    enableQueryExpansion: false,
                    saveOutputToFile: false
                }, undefined, aiConfig.apiKey);

                if (!res.success || !res.output) {
                    throw new ExternalServiceError(
                        aiConfig.provider,
                        new Error(res.error || "Empty output"),
                        ErrorCode.AI_PROVIDER_ERROR
                    );
                }
                return res;
            }, {
                maxAttempts: 3,
                baseDelay: 1000,
                retryCondition: (err: any) => {
                    // Retry on network errors or rate limits if detectable
                    return true; // Default to retry for now
                }
            });

            const extraction = normalizeExtractionResult(JSON.parse(response.output!));
            if (!extraction) {
                throw new Error("LLM extraction response must be a JSON object");
            }
            return extraction;

        } catch (e) {
            logger.error("LLM Extraction failed", e);
            if (e instanceof ExternalServiceError) throw e;
            throw new ExternalServiceError("LLM Extraction", e instanceof Error ? e : new Error(String(e)));
        }
    }
};


