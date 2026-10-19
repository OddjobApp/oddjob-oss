
import { db } from "@server/database_service.js";
import { eq, and, isNull, sql, inArray } from "drizzle-orm";
import {
    knowledgeDocuments,
    knowledgeNodes,
    knowledgeEdges,
    graphSchemaDefs,
    knowledgeDocumentExtractions,
    datasetItems,
    datasets,
    type KnowledgeNode,
    type InsertKnowledgeNode,
    type KnowledgeDocument,
    type DatasetItem
} from "@shared/schema/index.js";
import { mapKnowledgeDocumentToRagSource } from "../knowledge-store.js";
import { getAssetPlainText } from "@domain/knowledge/core/rag-utils.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

interface ExtractedNode {
    label: string;
    name: string;
    externalId?: string; // If available/applicable
    data?: Record<string, any>;
}

interface ExtractedEdge {
    source: { label: string; externalId?: string; name?: string };
    target: { label: string; externalId?: string; name?: string };
    relation: string;
    weight?: number;
}

interface ExtractionResult {
    nodes: ExtractedNode[];
    edges: ExtractedEdge[];
}

export class KnowledgeExtractionService {
    /**
     * Extracts knowledge from Dataset items.
     */
    async processDatasetItems(
        datasetId: number,
        schemaId: number,
        organizationId: number | null,
        onProgress?: (progress: number, message: string) => Promise<void>
    ) {
        console.log(`[KnowledgeExtractionService] Dataset Extraction for ${datasetId} started.`);
        if (onProgress) await onProgress(10, "Fetching dataset and schema");

        const [dataset] = await db.select().from(datasets).where(eq(datasets.id, datasetId)).limit(1);
        if (!dataset) throw new Error(`Dataset ${datasetId} not found`);

        const [graphSchema] = await db.select().from(graphSchemaDefs).where(eq(graphSchemaDefs.id, schemaId)).limit(1);
        if (!graphSchema) throw new Error(`Schema ${schemaId} not found`);

        // Get items to extract
        const items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, datasetId));
        if (items.length === 0) {
            if (onProgress) await onProgress(100, "No items found in dataset");
            return { nodes: 0, edges: 0 };
        }

        // 2. Ensure a "Container Document" exists for this dataset to satisfy foreign key constraints
        let [containerDoc] = await db.select().from(knowledgeDocuments).where(and(
            organizationId === null ? isNull(knowledgeDocuments.organizationId) : eq(knowledgeDocuments.organizationId, organizationId),
            eq(knowledgeDocuments.externalId, `dataset:${datasetId}`),
            eq(knowledgeDocuments.sourceType, 'integration')
        )).limit(1);

        if (!containerDoc) {
            const firstItemData = (items[0]?.data as any) || {};
            const datasetName = firstItemData["name"] || firstItemData["summary"] || dataset.name || `Dataset ${datasetId}`;
            [containerDoc] = await db.insert(knowledgeDocuments).values({
                title: `SaaS Dataset: ${datasetName}`,
                organizationId,
                sourceType: 'integration',
                externalId: `dataset:${datasetId}`,
                textContent: `Synthetic container for Knowledge Graph extraction from Dataset ${datasetId}`
            }).returning();
        }

        let totalStats = { nodes: 0, edges: 0 };
        const batchSize = 10; // Process items in batches to balance speed/context

        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            const progress = 10 + Math.floor((i / items.length) * 80);
            if (onProgress) await onProgress(progress, `Processing items ${i + 1} to ${Math.min(i + batchSize, items.length)} of ${items.length}`);

            const textContent = batch.map(item => JSON.stringify(item.data)).join('\n---\n');

            try {
                const extractionResult = await this.callLLMForExtraction(textContent, graphSchema);
                
                // Heuristic: Use the dates from the first item in the batch as a general source date for the batch
                // or rely on ingestExtractionResult's internal per-node date logic
                const firstItem = batch[0];
                const itemData = (firstItem?.data as any) || {};
                const sourceCreatedAt = itemData.sourceCreatedAt ? new Date(itemData.sourceCreatedAt) : undefined;
                const sourceUpdatedAt = itemData.sourceUpdatedAt ? new Date(itemData.sourceUpdatedAt) : undefined;

                // We use a negative extractionId or 0 for now to indicate dataset-based extraction
                const stats = await this.ingestExtractionResult(
                    extractionResult, 
                    containerDoc, 
                    organizationId, 
                    0, 
                    null,
                    sourceCreatedAt,
                    sourceUpdatedAt
                );
                totalStats.nodes += stats.nodes;
                totalStats.edges += stats.edges;
            } catch (e: any) {
                console.error(`Failed to process dataset batch starting at ${i}:`, e);
            }
        }

        if (onProgress) await onProgress(100, "Completed dataset extraction");
        return totalStats;
    }

    /**
     * Core processing logic for extraction.
     * Designed to be called by a worker or immediately for debugging.
     */
    async processExtractionTask(
        extractionId: number,
        documentId: number,
        schemaId: number,
        organizationId: number | null,
        onProgress?: (progress: number, message: string) => Promise<void>,
        missionId: number | null = null
    ) {
        // 1. Get Document & Schema
        console.log(`[KnowledgeExtractionService] Task ${extractionId} for Doc ${documentId} started.`);
        if (onProgress) await onProgress(10, "Fetching document and schema");

        const [document] = await db
            .select()
            .from(knowledgeDocuments)
            .where(eq(knowledgeDocuments.id, documentId))
            .limit(1);

        if (!document) throw new Error(`Document ${documentId} not found`);

        const [graphSchema] = await db
            .select()
            .from(graphSchemaDefs)
            .where(eq(graphSchemaDefs.id, schemaId))
            .limit(1);

        if (!graphSchema) throw new Error(`Schema ${schemaId} not found`);

        // 2. Prepare Content
        if (onProgress) await onProgress(20, "Reading document content");

        const ragSource = mapKnowledgeDocumentToRagSource(document);
        const textContent = await getAssetPlainText(ragSource);

        if (!textContent || textContent.length < 50) {
            throw new Error("Document content too short or empty");
        }

        // 3. Chunking Logic
        const lines = textContent.split('\n');
        const CHUNK_SIZE = 50;
        const chunks: string[] = [];

        for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
            chunks.push(lines.slice(i, i + CHUNK_SIZE).join('\n'));
        }

        let totalStats = { nodes: 0, edges: 0 };
        const chunkErrors: string[] = [];

        if (onProgress) await onProgress(30, `Processing ${chunks.length} chunks...`);
        console.log(`[KnowledgeExtractionService] Processing ${chunks.length} chunks...`);

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            if (!chunk.trim()) continue;

            if (onProgress) await onProgress(30 + Math.floor((i / chunks.length) * 60), `Analyzing chunk ${i + 1}/${chunks.length}`);

            try {
                const extractionResult = await this.callLLMForExtraction(chunk, graphSchema);
                
                // Pull dates from document metadata if available
                const metadata = (document.metadata as any) || {};
                const sourceCreatedAt = metadata.sourceCreatedAt ? new Date(metadata.sourceCreatedAt) : undefined;
                const sourceUpdatedAt = metadata.sourceUpdatedAt ? new Date(metadata.sourceUpdatedAt) : undefined;

                const stats = await this.ingestExtractionResult(
                    extractionResult, 
                    document, 
                    organizationId, 
                    extractionId, 
                    missionId || document.missionId,
                    sourceCreatedAt,
                    sourceUpdatedAt
                );
                totalStats.nodes += stats.nodes;
                totalStats.edges += stats.edges;
            } catch (e: any) {
                console.error(`Failed to process extraction chunk ${i + 1}/${chunks.length}:`, e);
                chunkErrors.push(`Chunk ${i + 1}: ${e.message}`);
            }
        }

        // 4. Handle complete failure
        if (chunkErrors.length === chunks.length && chunks.length > 0) {
            throw new Error(`All extraction chunks failed. Errors: ${chunkErrors.join('; ')}`);
        }

        // 5. Update Status
        if (onProgress) await onProgress(100, "Completed");

        await db.update(knowledgeDocumentExtractions)
            .set({
                status: "completed",
                completedAt: new Date(),
                progress: 100,
                progressMessage: `Completed. Processed ${chunks.length} chunks.`,
                nodesExtracted: totalStats.nodes,
                edgesExtracted: totalStats.edges
            })
            .where(eq(knowledgeDocumentExtractions.id, extractionId));

        return totalStats;
    }

    private async callLLMForExtraction(textContent: string, schema: any): Promise<ExtractionResult> {
        const client = AIClientFactory.getClient({
            provider: "google",
        } as any);

        const mappings = schema.mappings || [];
        const schemaSummary = JSON.stringify(mappings, null, 2);

        const systemPrompt = `
You are an expert Knowledge Graph Extraction Engine.
Your goal is to extract structured entities (Nodes) and relationships (Edges) from the provided text, strictly adhering to the defined Schema.

SCHEMA MAPPINGS:
${schemaSummary}

RULES:
1. **Adherence**: Extract strictly according to the schema rules if provided. If the schema is generic or empty, infer reasonably named Nodes and Edges based on the domain.
2. **Identification**: For every Node, try to identify a unique 'externalId' (e.g., Ticket ID, Email, UUID, Serial Number). If none exists, use the Name as a fallback identifier.
3. **Context Enrichment**: enrich the 'data' field with relevant attributes (e.g., status, priority, dates, confidence scores).
4. **Deduplication**: Do not create multiple Nodes for the same entity if it appears multiple times in the text. Consolidate attributes.
5. **Precision**: Ensure that the source and target of edges strictly match the defined Nodes.
6. **Provenance**: Include a short 'quote' field in the node data that serves as the source evidence from the text.
7. **Resolution**: If an entity is referenced by pronoun or alias (e.g., "he", "the server"), resolve it to the main entity if unambiguous.
8. **SaaS Knowledge**: When processing Confluence/Jira text, prioritize extracting specific entities:
    - **Confluence**: Pages, Spaces, Sections, Decisions, Action Items.
    - **Jira**: Issues, Epics, Sprints, Components, Versions.
    - **General**: Projects, Teams, Milestones, Technical Specs, Policies.
9. **Output**: Return valid JSON only.

EXAMPLES:
Text: "Ticket JIRA-123 (Critical): Server outage reported by jane@example.com on 2023-10-27. She mentioned it affects the US-East region."
Schema: { "mappings": [{ "label": "Ticket", "extractFrom": "tickets" }, { "label": "User", "extractFrom": "emails" }] }
Output:
{
  "nodes": [
    { 
      "label": "Ticket", 
      "name": "Server outage", 
      "externalId": "JIRA-123", 
      "data": { 
        "date": "2023-10-27", 
        "priority": "Critical", 
        "region": "US-East",
        "quote": "Ticket JIRA-123 (Critical): Server outage"
      } 
    },
    { 
      "label": "User", 
      "name": "jane@example.com", 
      "externalId": "jane@example.com", 
      "data": {} 
    }
  ],
  "edges": [
    { 
      "source": { "label": "Ticket", "externalId": "JIRA-123" }, 
      "target": { "label": "User", "externalId": "jane@example.com" }, 
      "relation": "REPORTED_BY",
      "weight": 1
    }
  ]
}

JSON FORMAT:
{
  "nodes": [
    { "label": "string", "name": "string", "externalId": "string (optional)", "data": {} }
  ],
  "edges": [
    { 
      "source": { "label": "string", "externalId": "string", "name": "string (fallback)" }, 
      "target": { "label": "string", "externalId": "string", "name": "string (fallback)" }, 
      "relation": "string",
      "weight": 1
    }
  ]
}
`;

        const truncatedText = textContent.substring(0, 30000);

        const result = await client.execute({
            credentialId: 0,
            model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
            userPrompt: truncatedText,
            systemPrompt: systemPrompt,
            requestType: "json",
            temperature: 0.1,
            useCache: false,
            enableQueryExpansion: false,
            saveOutputToFile: false,
            maxTokens: 8192,
        }, undefined, developmentProviderKey());

        if (!result.success) {
            throw new Error(`AI Call Failed: ${result.error}`);
        }

        try {
            const output = result.output || "";
            if (!output.trim()) {
                throw new Error("AI returned an empty response");
            }

            const jsonMatch = output.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/s);
            let jsonString = "";

            if (jsonMatch) {
                jsonString = jsonMatch[0];
            } else {
                const start = output.indexOf('{');
                const end = output.lastIndexOf('}');
                if (start !== -1 && end !== -1) {
                    jsonString = output.substring(start, end + 1);
                } else {
                    throw new Error(`No JSON object found in AI response. Preview: ${output.substring(0, 100)}`);
                }
            }

            jsonString = jsonString.replace(/^```json\s*/, '').replace(/```$/, '').trim();

            return JSON.parse(jsonString) as ExtractionResult;
        } catch (e: any) {
            console.error("Failed to parse JSON extraction. Raw Output:", result.output);
            console.error("Parse Error:", e);
            throw new Error(`AI Extraction Failed: ${e.message}. Raw preview: ${result.output?.substring(0, 500)}`);
        }
    }

    private async ingestExtractionResult(
        data: ExtractionResult,
        document: KnowledgeDocument,
        organizationId: number | null,
        extractionId: number,
        missionId: number | null = null,
        sourceCreatedAt?: Date,
        sourceUpdatedAt?: Date
    ): Promise<{ nodes: number, edges: number }> {
        const nodeMap = new Map<string, number>();
        let nodesCount = 0;
        let edgesCount = 0;

        const getOrgCondition = (col: any) => organizationId === null ? isNull(col) : eq(col, organizationId);

        // 1. Process Nodes
        for (const node of (data.nodes || [])) {
            if (!node.label || !node.name) continue;
            
            // Skip image nodes as requested by user
            const isImage = /^(Attachment|Image|Asset)$/i.test(node.label) || 
                           /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(node.name);
            if (isImage) {
                // console.log(`[Extraction] Skipping image node: ${node.label}:${node.name}`);
                continue;
            }

            const startNodeTime = Date.now();
            const cacheKey = `${node.label}:${node.externalId || node.name}`;

            const nodeData: InsertKnowledgeNode = {
                label: node.label,
                name: node.name,
                externalId: node.externalId || null,
                data: node.data || {},
                organizationId,
                missionId,
                verificationStatus: "staging",
                knowledgeDocumentId: document.id,
                extractionSources: [{ type: "extraction_run", runId: extractionId }] as any,
                sourceCreatedAt: sourceCreatedAt || (node.data?.sourceCreatedAt ? new Date(node.data.sourceCreatedAt) : null),
                sourceUpdatedAt: sourceUpdatedAt || (node.data?.sourceUpdatedAt ? new Date(node.data.sourceUpdatedAt) : null),
            };

            let existingNode: KnowledgeNode | undefined;

            if (node.externalId) {
                [existingNode] = await db
                    .select()
                    .from(knowledgeNodes)
                    .where(and(
                        getOrgCondition(knowledgeNodes.organizationId),
                        eq(knowledgeNodes.label, node.label),
                        eq(knowledgeNodes.externalId, node.externalId)
                    ))
                    .limit(1);
            } else {
                [existingNode] = await db
                    .select()
                    .from(knowledgeNodes)
                    .where(and(
                        getOrgCondition(knowledgeNodes.organizationId),
                        eq(knowledgeNodes.label, node.label),
                        eq(knowledgeNodes.name, node.name)
                    ))
                    .limit(1);
            }

            let nodeId: number;
            if (existingNode) {
                nodeId = existingNode.id;
                
                // Update extraction sources and data
                const currentSources = Array.isArray(existingNode.extractionSources) ? existingNode.extractionSources : [];
                const alreadyLinked = currentSources.some((s: any) => s.runId === extractionId);
                
                if (!alreadyLinked) {
                    await db.update(knowledgeNodes).set({
                        extractionSources: [...currentSources, { type: "extraction_run", runId: extractionId }] as any,
                        data: { ...(existingNode.data as object || {}), ...(node.data || {}) },
                        sourceCreatedAt: sourceCreatedAt || existingNode.sourceCreatedAt,
                        sourceUpdatedAt: sourceUpdatedAt || existingNode.sourceUpdatedAt,
                        updatedAt: new Date()
                    }).where(eq(knowledgeNodes.id, nodeId));
                }
            } else {
                const [inserted] = await db.insert(knowledgeNodes).values(nodeData).returning();
                nodeId = inserted.id;
            }

            nodeMap.set(cacheKey, nodeId);
            nodesCount++;
            
            const nodeDuration = Date.now() - startNodeTime;
            if (nodeDuration > 100) {
                console.log(`[Extraction] Node ingestion took ${nodeDuration}ms: ${node.label}:${node.name}`);
            }
        }

        // 2. Process Edges
        for (const edge of (data.edges || [])) {
            const sourceKey = `${edge.source.label}:${edge.source.externalId || edge.source.name}`;
            const targetKey = `${edge.target.label}:${edge.target.externalId || edge.target.name}`;

            let sourceId = nodeMap.get(sourceKey);
            let targetId = nodeMap.get(targetKey);

            if (!sourceId) {
                const [node] = await db.select().from(knowledgeNodes).where(and(
                    getOrgCondition(knowledgeNodes.organizationId),
                    eq(knowledgeNodes.label, edge.source.label),
                    edge.source.externalId
                        ? eq(knowledgeNodes.externalId, edge.source.externalId)
                        : eq(knowledgeNodes.name, edge.source.name || "")
                )).limit(1);
                if (node) sourceId = node.id;
            }

            if (!targetId) {
                const [node] = await db.select().from(knowledgeNodes).where(and(
                    getOrgCondition(knowledgeNodes.organizationId),
                    eq(knowledgeNodes.label, edge.target.label),
                    edge.target.externalId
                        ? eq(knowledgeNodes.externalId, edge.target.externalId)
                        : eq(knowledgeNodes.name, edge.target.name || "")
                )).limit(1);
                if (node) targetId = node.id;
            }

            if (sourceId && targetId && sourceId !== targetId) {
                const [existingEdge] = await db.select().from(knowledgeEdges).where(and(
                    eq(knowledgeEdges.sourceId, sourceId),
                    eq(knowledgeEdges.targetId, targetId),
                    eq(knowledgeEdges.relation, edge.relation)
                )).limit(1);

                if (!existingEdge) {
                    await db.insert(knowledgeEdges).values({
                        sourceId,
                        targetId,
                        relation: edge.relation,
                        weight: edge.weight || 1,
                        organizationId,
                        missionId
                    });
                    edgesCount++;
                }
            }
        }

        return { nodes: nodesCount, edges: edgesCount };
    }

    /**
     * Resets extraction state for a document.
     * Removes the document as a source from all nodes and sets its primary doc link to null.
     */
    async resetDocumentExtractions(documentId: number, organizationId: number | null) {
        console.log(`[KnowledgeExtractionService] Resetting extractions for document ${documentId}`);

        // 1. Find all extraction runs for this document
        const runs = await db.select({ id: knowledgeDocumentExtractions.id })
            .from(knowledgeDocumentExtractions)
            .where(eq(knowledgeDocumentExtractions.documentId, documentId));
        
        const runIds = runs.map(r => r.id);
        if (runIds.length === 0) return;

        // 2. Clear extractionSources and primary links for nodes
        // This is complex in SQL, so we'll do it in a few steps
        await db.execute(sql`
            UPDATE ${knowledgeNodes}
            SET 
                extraction_sources = (
                    SELECT jsonb_agg(s)
                    FROM jsonb_array_elements(extraction_sources) s
                    WHERE NOT (s->>'type' = 'extraction_run' AND (s->>'runId')::int IN ${runIds})
                ),
                knowledge_document_id = CASE WHEN knowledge_document_id = ${documentId} THEN NULL ELSE knowledge_document_id END
            WHERE 
                organization_id ${organizationId === null ? sql`IS NULL` : sql`= ${organizationId}`}
                AND (
                    knowledge_document_id = ${documentId}
                    OR EXISTS (
                        SELECT 1 FROM jsonb_array_elements(extraction_sources) s 
                        WHERE s->>'type' = 'extraction_run' AND (s->>'runId')::int IN ${runIds}
                    )
                )
        `);

        // 3. Delete previous extractions to clear UI state
        await db.delete(knowledgeDocumentExtractions)
            .where(inArray(knowledgeDocumentExtractions.id, runIds));
    }
}


