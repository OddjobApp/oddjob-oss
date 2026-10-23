
import { db } from "@server/database_service.js";
import { eq, and, desc, isNull, or } from "drizzle-orm";
import {
    knowledgeDocuments,
    knowledgeNodes,
    knowledgeEdges,
    graphSchemaDefs,
    knowledgeDocumentExtractions,
    saasConnectors,
    type KnowledgeNode,
    type InsertKnowledgeNode,
    type KnowledgeDocument
} from "@shared/schema/index.js";
import { mapKnowledgeDocumentToRagSource } from "@domain/knowledge/core/knowledge-store.js";
import { getAssetPlainText } from "@domain/knowledge/core/rag-utils.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { NotFoundError } from "@server/utils/errors.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";
import { ORG_AI_KEY_MISSING } from "@domain/ai/core/organization-ai-client.js";

/**
 * Errors no other chunk can recover from: the organization has no AI
 * connection (strict BYOK), so every chunk would fail the same way and the
 * extraction must fail rather than complete with nothing extracted.
 */
function isUnconfigured(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message === ORG_AI_KEY_MISSING || message === "Organization context is required for AI execution";
}

interface ExtractedNode {
    label: string;
    name: string;
    externalId?: string; // If available/applicable
    sourceCreatedAt?: string; // ISO date string if extracted from content
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
     * Core processing logic for extraction.
     * Designed to be called by a worker or immediately for debugging.
     */
    async processExtractionTask(
        extractionId: number,
        documentId: number,
        schemaId: number,
        organizationId: number | null,
        onProgress?: (progress: number, message: string) => Promise<void>
    ) {
        // 1. Get Document & Schema
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
        let textContent = "";
        let attachments: any[] = [];
        const isImage = document.contentType?.startsWith('image/');

        if (isImage) {
            textContent = "Analyze this image and extract knowledge graph nodes and edges.";
            if (document.url) {
                attachments.push({ type: 'image_url', url: document.url });
            } else if (document.fileData) {
                const imageUrl = document.fileData.startsWith('data:') 
                    ? document.fileData 
                    : `data:${document.contentType};base64,${document.fileData}`;
                attachments.push({ type: 'image_url', url: imageUrl });
            } else {
                throw new Error("Image document has no URL or file data");
            }
        } else {
            textContent = await getAssetPlainText(ragSource);
            if (!textContent || textContent.length < 50) {
                throw new Error("Document content too short or empty");
            }
        }

        // 3. Streaming Chunk Generator Logic (Bottleneck #2 Resolution)
        let totalStats = { nodes: 0, edges: 0 };

        if (isImage) {
            if (onProgress) await onProgress(30, "Analyzing image extraction...");
            try {
                const extractionResult = await this.callLLMForExtraction(textContent, graphSchema, organizationId, attachments);
                const stats = await this.ingestExtractionResult(extractionResult, document, organizationId, extractionId);
                totalStats.nodes += stats.nodes;
                totalStats.edges += stats.edges;
            } catch (e) {
                if (isUnconfigured(e)) throw e;
                console.error("Failed to process image extraction:", e);
            }
        } else {
            const CHUNK_SIZE = 50;
            const chunksGenerator = this.streamTextChunks(textContent, CHUNK_SIZE);
            
            for await (const { chunk, index, total } of chunksGenerator) {
                if (onProgress) await onProgress(30 + Math.floor((index / total) * 60), `Analyzing chunk ${index + 1}/${total}`);

                try {
                    const extractionResult = await this.callLLMForExtraction(chunk, graphSchema, organizationId);
                    const stats = await this.ingestExtractionResult(extractionResult, document, organizationId, extractionId);
                    totalStats.nodes += stats.nodes;
                    totalStats.edges += stats.edges;
                } catch (e) {
                    if (isUnconfigured(e)) throw e;
                    console.error(`Failed to process extraction chunk ${index + 1}/${total}:`, e);
                }
            }
        }

        // 5. Update Status
        if (onProgress) await onProgress(100, "Completed");

        await db.update(knowledgeDocumentExtractions)
            .set({
                status: "completed",
                completedAt: new Date(),
                progress: 100,
                progressMessage: `Completed extraction. Extracted ${totalStats.nodes} nodes and ${totalStats.edges} edges.`,
                nodesExtracted: totalStats.nodes,
                edgesExtracted: totalStats.edges
            })
            .where(eq(knowledgeDocumentExtractions.id, extractionId));

        return totalStats;
    }

    private async callLLMForExtraction(textContent: string, schema: any, organizationId: number | null, attachments?: any[]): Promise<ExtractionResult> {
        // Runs on the organization's default AI connection (Organization Settings):
        // Gemini, Amazon Bedrock, or any other provider it connected a key for.
        // "google" and GEMINI_MODEL apply only to the platform client outside
        // production, for an org without a connection.
        const client = AIClientFactory.getClient({ provider: "google" } as any);

        const mappings = schema.mappings || [];
        const schemaSummary = JSON.stringify(mappings, null, 2);

        const systemPrompt = `
You are an expert Knowledge Graph Extraction Engine.
Your goal is to extract structured entities (Nodes) and relationships (Edges) from the provided text or media, strictly adhering to the defined Schema.

SCHEMA MAPPINGS:
${schemaSummary}

RULES:
1. **Adherence**: Extract strictly according to the schema rules if provided. If the schema is generic or empty, infer reasonably named Nodes and Edges based on the domain.
2. **Identification**: For every Node, try to identify a unique 'externalId' (e.g., Ticket ID, Email, UUID, Serial Number). If none exists, use the Name as a fallback identifier.
3. **Context**: Use the surrounding context to enrich the 'data' field of the Node with relevant attributes (e.g., status, priority, description).
4. **Resolution**: Ensure that the source and target of edges strictly match the defined Nodes.
5. **Temporal Context**: If the text contains specific creation dates or timestamps for entities, include them in the 'sourceCreatedAt' field in ISO 8601 format.
6. **Output**: Return valid JSON only.

EXAMPLES:
Text: "Ticket JIRA-123: Server outage reported by jane@example.com on 2023-10-27."
Schema: { "mappings": [{ "label": "Ticket", "extractFrom": "tickets" }, { "label": "User", "extractFrom": "emails" }] }
Output:
{
  "nodes": [
    { "label": "Ticket", "name": "Server outage", "externalId": "JIRA-123", "data": { "date": "2023-10-27" } },
    { "label": "User", "name": "jane@example.com", "externalId": "jane@example.com", "data": {} }
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
    { "label": "string", "name": "string", "externalId": "string (optional)", "sourceCreatedAt": "ISO8601 string (optional)", "data": {} }
  ],
  "edges": [
    { 
      "source": { "label": "string", "externalId": "string (optional if referencing by name)" }, 
      "target": { "label": "string", "externalId": "string (optional if referencing by name)" }, 
      "relation": "string",
      "weight": 1
    }
  ]
}
`;

        // Truncate text if massive
        const truncatedText = textContent.substring(0, 30000);

        const result = await client.execute({
            credentialId: 0, // Dummy ID as we provide API key directly
            organizationId,
            model: process.env.GEMINI_MODEL || "gemini-2.0-flash", // High capacity model
            userPrompt: truncatedText,
            systemPrompt: systemPrompt,
            requestType: "json",
            temperature: 0.1, // Low temp for extraction
            useCache: false,
            enableQueryExpansion: false,
            maxTokens: 8192, // Ensure max output tokens usage
            saveOutputToFile: false,
            attachments: attachments // Pass attachments for multi-modal support
        }, undefined, developmentProviderKey());

        if (!result.success) {
            throw new Error(`AI Call Failed: ${result.error}`);
        }

        try {
            const output = result.output || "";
            if (!output.trim()) {
                throw new Error("AI returned an empty response");
            }

            // More robust extraction: find anything between first { and last }
            // and filter out markdown triple backticks if they are wrapping it
            const jsonMatch = output.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/s);
            let jsonString = "";

            if (jsonMatch) {
                jsonString = jsonMatch[0];
            } else {
                // Fallback to old substring logic if regex fails
                const start = output.indexOf('{');
                const end = output.lastIndexOf('}');
                if (start !== -1 && end !== -1) {
                    jsonString = output.substring(start, end + 1);
                } else {
                    throw new Error(`No JSON object found in AI response. Preview: ${output.substring(0, 100)}`);
                }
            }

            // Final cleanup: sometimes Gemini adds backticks at start/end of the JSON output even in JSON mode
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
        extractionId: number
    ): Promise<{ nodes: number, edges: number }> {
        // Map to cache node resolutions: Key = `${label}:${externalId || name}` -> Value = Database ID
        const nodeMap = new Map<string, number>();
        let nodesCount = 0;
        let edgesCount = 0;

        // Determine source type from document/integration
        let sourceType = "manual";
        if (document.integrationId) {
            const [connector] = await db
                .select({ platform: saasConnectors.platform })
                .from(saasConnectors)
                .where(eq(saasConnectors.id, document.integrationId))
                .limit(1);
            if (connector) {
                sourceType = connector.platform; // 'confluence', 'jira', 'slack', etc.
            }
        } else if (document.sourceType === "instruction") {
            sourceType = "system";
        }

        // 1. Process Nodes
        for (const node of (data.nodes || [])) {
            if (!node.label || !node.name) continue;

            const cacheKey = `${node.label}:${node.externalId || node.name}`;

            // Prepare Insert
            const nodeData: InsertKnowledgeNode = {
                label: node.label,
                name: node.name,
                externalId: node.externalId || null,
                data: node.data || {},
                organizationId,
                knowledgeDocumentId: document.id,
                sourceType: sourceType as any,
                sourceCreatedAt: node.sourceCreatedAt ? new Date(node.sourceCreatedAt) : (document.metadata as any)?.sourceCreatedAt ? new Date((document.metadata as any).sourceCreatedAt) : document.createdAt,
                extractionSources: [{ type: "extraction_run", runId: extractionId }] as any,
                // fingerprint? could hash the data
            };

            // Upsert Strategy
            let existingNode: KnowledgeNode | undefined;

            if (node.externalId) {
                [existingNode] = await db
                    .select()
                    .from(knowledgeNodes)
                    .where(and(
                        eq(knowledgeNodes.organizationId, organizationId as number),
                        eq(knowledgeNodes.label, node.label),
                        eq(knowledgeNodes.externalId, node.externalId)
                    ))
                    .limit(1);
            } else {
                [existingNode] = await db
                    .select()
                    .from(knowledgeNodes)
                    .where(and(
                        eq(knowledgeNodes.organizationId, organizationId as number),
                        eq(knowledgeNodes.label, node.label),
                        eq(knowledgeNodes.name, node.name)
                    ))
                    .limit(1);
            }

            let nodeId: number;
            if (existingNode) {
                nodeId = existingNode.id;
            } else {
                const [inserted] = await db.insert(knowledgeNodes).values(nodeData).returning();
                nodeId = inserted.id;
            }

            nodeMap.set(cacheKey, nodeId);
            nodesCount++;
        }

        // 2. Process Edges
        for (const edge of (data.edges || [])) {
            const sourceKey = `${edge.source.label}:${edge.source.externalId || edge.source.name}`;
            const targetKey = `${edge.target.label}:${edge.target.externalId || edge.target.name}`;

            const sourceId = nodeMap.get(sourceKey);
            const targetId = nodeMap.get(targetKey);

            if (sourceId && targetId && sourceId !== targetId) {
                // Upsert Edge
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
                        organizationId
                    });
                    edgesCount++;
                }
            }
        }

        return { nodes: nodesCount, edges: edgesCount };
    }

    async listBatches(organizationId: number, limit = 50) {
        const { desc } = await import("drizzle-orm");
        const { extractionBatches } = await import("@shared/schema/index.js");
        return db.select().from(extractionBatches)
            .where(eq(extractionBatches.organizationId, organizationId))
            .orderBy(desc(extractionBatches.createdAt))
            .limit(limit);
    }

    async getBatchById(batchId: number, organizationId: number) {
        const { extractionBatches } = await import("@shared/schema/index.js");
        const [batch] = await db.select().from(extractionBatches)
            .where(and(eq(extractionBatches.id, batchId), eq(extractionBatches.organizationId, organizationId)))
            .limit(1);
        return batch || null;
    }

    async updateBatchStatus(batchId: number, organizationId: number, status: string) {
        const { extractionBatches } = await import("@shared/schema/index.js");
        const [updated] = await db.update(extractionBatches)
            .set({ status })
            .where(and(eq(extractionBatches.id, batchId), eq(extractionBatches.organizationId, organizationId)))
            .returning();
        return updated || null;
    }

    async getBatchExtractions(batchId: number, organizationId: number) {
        const { knowledgeDocumentExtractions } = await import("@shared/schema/index.js");
        const { sql } = await import("drizzle-orm");
        return db.select().from(knowledgeDocumentExtractions)
            .where(and(
                eq(knowledgeDocumentExtractions.organizationId, organizationId),
                sql`${knowledgeDocumentExtractions.metadata}->>'batchId' = ${String(batchId)}`
            ));
    }

    async getExtractionById(extractionId: number, organizationId: number) {
        const { knowledgeDocumentExtractions } = await import("@shared/schema/index.js");
        const [extraction] = await db.select().from(knowledgeDocumentExtractions)
            .where(and(eq(knowledgeDocumentExtractions.id, extractionId), eq(knowledgeDocumentExtractions.organizationId, organizationId)))
            .limit(1);
        return extraction || null;
    }

    async createSingleExtraction(params: {
        documentId: number;
        schemaId: number;
        priority: number;
        organizationId: number;
        createdBy: string;
    }) {
        const [document] = await db.select({ id: knowledgeDocuments.id }).from(knowledgeDocuments)
            .where(and(
                eq(knowledgeDocuments.id, params.documentId),
                or(eq(knowledgeDocuments.organizationId, params.organizationId), isNull(knowledgeDocuments.organizationId)),
            )).limit(1);
        if (!document) throw new NotFoundError("Document not found");

        const [schema] = await db.select({ id: graphSchemaDefs.id }).from(graphSchemaDefs)
            .where(and(
                eq(graphSchemaDefs.id, params.schemaId),
                or(eq(graphSchemaDefs.organizationId, params.organizationId), isNull(graphSchemaDefs.organizationId)),
            )).limit(1);
        if (!schema) throw new NotFoundError("Schema not found");

        const [extraction] = await db.insert(knowledgeDocumentExtractions).values({
            documentId: params.documentId,
            schemaId: params.schemaId,
            organizationId: params.organizationId,
            status: "queued",
            priority: params.priority,
            createdBy: params.createdBy,
            metadata: { source: "api" },
        }).returning();

        const { queueExtractionJob } = await import("../../knowledge-queue.js");
        await queueExtractionJob({
            type: "document",
            extractionId: extraction.id,
            documentId: params.documentId,
            schemaId: params.schemaId,
            organizationId: params.organizationId,
        }, params.priority);
        return extraction;
    }

    async getLatestDocumentExtraction(documentId: number, organizationId: number) {
        const [extraction] = await db.select().from(knowledgeDocumentExtractions)
            .where(and(
                eq(knowledgeDocumentExtractions.documentId, documentId),
                eq(knowledgeDocumentExtractions.organizationId, organizationId),
            ))
            .orderBy(desc(knowledgeDocumentExtractions.id)).limit(1);
        return extraction || null;
    }

    async getSchemaById(schemaId: number) {
        const { graphSchemaDefs } = await import("@shared/schema/index.js");
        const [schema] = await db.select().from(graphSchemaDefs).where(eq(graphSchemaDefs.id, schemaId)).limit(1);
        return schema || null;
    }

    async createBatchWithJobs(params: {
        name: string;
        description?: string;
        schemaId: number;
        organizationId: number;
        documentIds: number[];
        priority?: number;
        createdBy: string;
    }) {
        const { extractionBatches, knowledgeDocumentExtractions } = await import("@shared/schema/index.js");
        const { queueExtractionJob } = await import("../../knowledge-queue.js");

        const schema = await this.getSchemaById(params.schemaId);
        if (!schema) throw new Error("Schema not found");

        const [batch] = await db.insert(extractionBatches).values({
            name: params.name,
            description: params.description,
            schemaId: params.schemaId,
            organizationId: params.organizationId,
            status: "pending",
            totalDocuments: params.documentIds.length,
            priority: params.priority || 0,
            createdBy: params.createdBy
        }).returning();

        const records = await db.transaction(async (tx) => {
            return await tx.insert(knowledgeDocumentExtractions).values(
                params.documentIds.map(docId => ({
                    documentId: docId,
                    schemaId: params.schemaId,
                    organizationId: params.organizationId,
                    status: "queued",
                    priority: params.priority || 0,
                    createdBy: params.createdBy,
                    metadata: { batchId: batch.id }
                }))
            ).returning();
        });

        // Queue all extraction jobs concurrently
        await Promise.all(
            records.map((record) =>
                queueExtractionJob({
                    type: "document",
                    extractionId: record.id,
                    documentId: record.documentId,
                    schemaId: params.schemaId,
                    organizationId: params.organizationId,
                    batchId: batch.id
                }, params.priority || 0)
            )
        );

        await this.updateBatchStatus(batch.id, params.organizationId, "running");

        return { batch, extractionCount: records.length };
    }

    async updateExtractionStatus(extractionId: number, organizationId: number, status: string) {
        const { knowledgeDocumentExtractions } = await import("@shared/schema/index.js");
        const [updated] = await db.update(knowledgeDocumentExtractions)
            .set({ status })
            .where(and(eq(knowledgeDocumentExtractions.id, extractionId), eq(knowledgeDocumentExtractions.organizationId, organizationId)))
            .returning();
        return updated || null;
    }

    /**
     * Streams text chunks as an AsyncGenerator to avoid memory spikes on large multi-page documents.
     */
    private async *streamTextChunks(
        textContent: string,
        chunkSize: number = 50
    ): AsyncGenerator<{ chunk: string; index: number; total: number }> {
        const lineRegex = /\r?\n/g;
        const lineOffsets: number[] = [0];
        let match: RegExpExecArray | null;

        while ((match = lineRegex.exec(textContent)) !== null) {
            lineOffsets.push(match.index + match[0].length);
        }

        const totalLines = lineOffsets.length;
        const totalChunks = Math.ceil(totalLines / chunkSize);

        let chunkIndex = 0;
        for (let i = 0; i < totalLines; i += chunkSize) {
            const startOffset = lineOffsets[i];
            const endOffset = i + chunkSize < totalLines ? lineOffsets[i + chunkSize] : textContent.length;
            const chunk = textContent.slice(startOffset, endOffset);
            if (chunk.trim()) {
                yield { chunk, index: chunkIndex++, total: Math.max(1, totalChunks) };
            }
        }
    }
}

export const knowledgeExtractionService = new KnowledgeExtractionService();


