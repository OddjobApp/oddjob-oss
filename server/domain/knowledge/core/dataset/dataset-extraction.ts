// @ts-nocheck
import { datasetService } from "../dataset-service.js";
import crypto from "node:crypto";
import { processExplicitKnowledgeGraphRules } from "../extraction/knowledge-graph-integration.js";
import type { KnowledgeGraphConfig } from "@shared/schema/knowledge-config";

import { db } from "../../../../database_service.js";
import { pipelines, pipelineExecutions, datasetItems, knowledgeDocuments } from "@shared/schema/index.js";
import { eq, and, inArray } from "drizzle-orm";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

// Helper to generate conceptual tags using AI
async function generateConcepts(title: string, content: string): Promise<string> {
    try {
        const module = await import("../../../ai/core/system-ai.service.js");
        const systemAiService = module.systemAiService;
        const config = await systemAiService.getAiConfig('copilot') || { provider: 'google', model: 'gemini-2.0-flash' };

        let apiKey = config.apiKey || developmentProviderKey();
        if (config.provider === 'openai') apiKey = config.apiKey || developmentProviderKey("openai");
        if (config.provider === 'anthropic') apiKey = config.apiKey || developmentProviderKey("anthropic");

        const aiClient = AIClientFactory.getClient({ provider: config.provider, baseUrl: config.baseUrl } as any);

        const prompt = `
        Analyze the following technical documentation and extract 3-5 high-level "Concepts".
        Concepts should be abstract, searchable themes (e.g., "Scalability", "User Experience", "Security", "Hardware Integration").
        
        Title: ${title}
        Content Snippet: ${content.substring(0, 1000)}...

        Output format: A single line of comma-separated concepts. Example: Security, Authentication, API Design
        `;

        const response = await aiClient.execute({
            model: config.model,
            userPrompt: prompt,
            temperature: 0.3,
            systemPrompt: "You are a specialized Knowledge Graph Tagger. Extract key technical concepts."
        } as any, undefined, apiKey);

        if (!response.success || !response.output) return "";
        return response.output.split(',').map((t: string) => `[Concept: ${t.trim()}]`).join(' ');

    } catch (error) {
        console.warn("[Dataset Extraction] Failed to generate concepts:", error);
        return "";
    }
}


/**
 * Trigger Knowledge Graph extraction for a specific dataset.
 * Iterates through dataset items and applies the dataset's configured extraction rules.
 */
export async function processDatasetExtraction(datasetId: number, userId?: string) {
    const dataset = await datasetService.getById(datasetId, { organizationId: null, userId: 'system', isSuperAdmin: true });
    if (!dataset) {
        throw new Error(`Dataset ${datasetId} not found`);
    }

    if (!dataset.knowledgeConfig || Object.keys(dataset.knowledgeConfig).length === 0) {
        console.warn(`[Dataset Extraction] Dataset ${datasetId} has no knowledge configuration. Skipping.`);
        return;
    }

    console.log(`[Dataset Extraction] Starting extraction for Dataset ${datasetId} ("${dataset.name}")`);

    const PAGE_SIZE = 500;
    const systemCtx = { organizationId: null, userId: 'system', isSuperAdmin: true };

    // Collect all items via pagination
    const items: any[] = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
        const { items: batch } = await datasetService.getItems(datasetId, systemCtx, { limit: PAGE_SIZE, offset });
        items.push(...batch);
        hasMore = batch.length === PAGE_SIZE;
        offset += PAGE_SIZE;
    }

    console.log(`[Dataset Extraction] Found ${items.length} items to process`);

    // Ensure we have a pipeline execution context for lineage
    const orphanItems = items.filter((i: { pipelineExecutionId: number | null }) => !i.pipelineExecutionId);

    if (orphanItems.length > 0) {
        console.log(`[Dataset Extraction] Found ${orphanItems.length} items without lineage. Creating manual extraction execution context.`);

        let pipeline = await db.query.pipelines.findFirst({
            where: and(
                eq(pipelines.name, "Manual Dataset Extraction"),
                dataset.organizationId ? eq(pipelines.organizationId, dataset.organizationId) : undefined
            )
        });

        if (!pipeline) {
            [pipeline] = await db.insert(pipelines).values({
                name: "Manual Dataset Extraction",
                description: "System pipeline for manual dataset actions",
                triggerType: "manual",
                organizationId: dataset.organizationId,
                createdBy: userId || "system",
                createdAt: new Date(),
                isActive: true
            }).returning();
        }

        // Create execution
        const [execution] = await db.insert(pipelineExecutions).values({
            pipelineId: pipeline.id,
            status: "completed",
            organizationId: dataset.organizationId,
            createdBy: userId || "system",
            startedAt: new Date(),
            completedAt: new Date(),
            runUuid: crypto.randomUUID(), // Ensure UUID if required by schema default
        }).returning();

        // Update items in DB
        const orphanIds = orphanItems.map((i: { id: number }) => i.id);
        await db.update(datasetItems)
            .set({ pipelineExecutionId: execution.id })
            .where(inArray(datasetItems.id, orphanIds));

        // Update local items references
        orphanItems.forEach((i: { pipelineExecutionId: number | null }) => i.pipelineExecutionId = execution.id);
    }

    let processedCount = 0;
    let errorCount = 0;

    const { documentService } = await import("../extraction/document-service");

    for (const item of items) {
        if (!item.rawData) {
            continue;
        }

        try {
            // 1. Create/Update Knowledge Document (for Vector Search)
            // Strategy: If item has content title/body, make it a document.
            // Check if document already exists for this datasetItemId?
            // documentService.createDocument handles creation, but we want to avoid duplicates if re-running.
            // Currently documentService doesn't have "getByDatasetItemId". 
            // We can search by `datasetItemId` in metadata or column.

            // CONFLUENCE SPECIFIC ADAPTER (for now, until generalized)
            let knowledgeDocumentId: number | undefined;

            // Map common content fields
            const data = (item.data || item.rawData) as any;
            const title = data.title || data.name || data.subject || (item.rawData as any).title;
            const content = data.content || data.markdown || data.textContent || data.body?.storage?.value || data.body?.view?.value || data.description || data.text;
            const url = data.url || data.link || (item.rawData as any)._links?.base && (item.rawData as any)._links?.webui ? ((item.rawData as any)._links.base + (item.rawData as any)._links.webui) : (item.rawData as any).url;

            if (title && content) {
                // Check if document exists for this item
                // We can't easily check via service without a new method, so we might skip check and rely on unique constraints?
                // knowledge_documents has unique index on (dataset_item_id)?
                // Let's check schema. `datasetItemIdx` exists, but is it unique? No.
                // We should ideally check.

                // Quick check query
                const doc = await db.query.knowledgeDocuments.findFirst({
                    where: eq(knowledgeDocuments.datasetItemId, item.id)
                });

                if (doc) {
                    knowledgeDocumentId = doc.id;
                    // Optional: Update content if changed
                } else {
                    console.log(`[Dataset Extraction] Creating document for item ${item.id}: "${title}"`);

                    // HYBRID INGESTION: Prepend structured metadata to improve retrieval
                    const raw = (item.rawData as any);
                    const space = (data as any).space || raw.space || "Internal";

                    // Deep Context Extraction
                    const comments = raw.children?.comment?.results?.map((c: any) => `[Comment: ${c.body?.storage?.value?.replace(/<[^>]*>/g, '') || c.body?.view?.value?.replace(/<[^>]*>/g, '') || ''}]`).join('\n') || '';
                    const labels = raw.metadata?.labels?.results?.map((l: any) => `[Label: ${l.name}]`).join(' ') || '';
                    const attachments = raw.children?.attachment?.results?.map((a: any) => `[Attachment: ${a.title}]`).join(' ') || '';

                    // AI Conceptual Tagging
                    const textForAI = typeof content === 'string' ? content : JSON.stringify(content);
                    const concepts = await generateConcepts(title, textForAI);

                    const hybridContent = `[Source: Confluence] [Space: ${space}] [Title: ${title}]\n${concepts}\n${labels}\n${attachments}\n${comments}\n\n${textForAI}`;

                    const newDoc = await documentService.createDocument({
                        title,
                        textContent: hybridContent,
                        sourceType: 'integration', // or 'confluence'
                        url,
                        datasetItemId: item.id, // Direct link to existing item
                        metadata: {
                            source: 'dataset_extraction',
                            datasetId: dataset.id,
                            datasetItemId: item.id, // Explicitly pass for metadata
                            originalId: data.id,
                            space
                        }
                    }, {
                        organizationId: dataset.organizationId,
                        userId: userId || 'system',
                        isAdmin: true,
                        isSuperAdmin: true,
                        isOrgAdmin: true
                    });

                    knowledgeDocumentId = newDoc.id;
                }
            }

            // 2. Extract Entities (Nodes)
            await processExplicitKnowledgeGraphRules(
                dataset.knowledgeConfig as KnowledgeGraphConfig,
                {
                    jobOutput: item.rawData, // Use the original JSON output
                    organizationId: dataset.organizationId,
                    // Use the original pipeline execution ID to maintain lineage (or undefined if null)
                    pipelineExecutionId: item.pipelineExecutionId || 0,
                    knowledgeDocumentId, // Link nodes to the document
                }
            );
            processedCount++;
        } catch (error) {
            console.error(`[Dataset Extraction] Error processing item ${item.id}:`, error);
            errorCount++;
        }
    }

    console.log(`[Dataset Extraction] Completed. Processed: ${processedCount}, Errors: ${errorCount}`);
    return { processedCount, errorCount };
}


