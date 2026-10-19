
import { db } from "../../../../database_service.js";
import { eq, and, isNull, desc, ilike, sql } from "drizzle-orm";
import { knowledgeNodes, knowledgeDocuments, knowledgeEdges, type KnowledgeNode, type KnowledgeDocument } from "@shared/schema/index.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { reindexKnowledgeDocument } from "../../../../knowledge/knowledge-store.js";
import { embedKnowledgeNode } from "../../../../knowledge/knowledge-graph-service.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

export class EnrichmentService {

    /**
     * Enrich a specific Knowledge Node with Topics, Sentiment, and improved Metadata.
     */
    async enrichNode(nodeId: number, orgId: number) {
        // 1. Fetch Node
        const [node] = await db.select().from(knowledgeNodes).where(eq(knowledgeNodes.id, nodeId)).limit(1);
        if (!node) return;

        // 2. Prepare Context (Name + Data)
        const context = `
            Entity: ${node.name}
            Type: ${node.label}
            Data: ${JSON.stringify(node.data || {})}
        `.trim();

        // 3. AI Analysis
        const analysis = await this.analyzeEntity(context);

        if (!analysis) return;

        // 4. Update Node
        const updatedData = {
            ...(node.data as Record<string, any>),
            topics: analysis.topics || [], // "Smart Tags"
            sentiment: analysis.sentiment, // "Sentiment Score"
            urgency: analysis.urgency,     // "Urgency Score"
            auto_summary: analysis.summary,
            creation_logic: analysis.creation_logic
        };

        await db.update(knowledgeNodes)
            .set({
                data: updatedData,
                confidenceScore: analysis.confidence // Update confidence based on AI assessment? Or keep extraction confidence? Let's use AI's quality score.
            })
            .where(eq(knowledgeNodes.id, nodeId));

        // Re-embed the node to update vector store with new metadata
        await embedKnowledgeNode({ ...node, data: updatedData });

        // 5. Scan for Implicit Links (Intelligent Link Prediction)
        await this.scanForImplicitLinks(nodeId, orgId, analysis.summary);

        console.log(`[Enrichment] Enriched Node ${nodeId}: ${analysis.topics.join(", ")}`);
    }

    /**
     * Enrich a Document (Summary + Topics)
     */
    async enrichDocument(docId: number, orgId: number) {
        const [doc] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, docId)).limit(1);
        if (!doc) return;

        // Skip if already has summary (unless forced)
        // if (doc.summary) return; 

        // Get text content (truncated)
        const text = (doc.textContent || "").substring(0, 10000); // Analyze first 10k chars
        if (!text) return;

        const analysis = await this.analyzeDocument(text);

        if (analysis) {
            await db.update(knowledgeDocuments)
                .set({
                    summary: analysis.summary,
                    metadata: {
                        ...(doc.metadata as Record<string, any>),
                        topics: analysis.topics,
                        sentiment: analysis.sentiment,
                        creation_logic: analysis.creation_logic
                    }
                })
                .where(eq(knowledgeDocuments.id, docId));

            // Re-index document to update tags/sentiment in Qdrant
            // We need to fetch the updated doc first to get full record
            const [updatedDoc] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, docId));
            if (updatedDoc) {
                await reindexKnowledgeDocument(updatedDoc);
            }

            if (updatedDoc) {
                await reindexKnowledgeDocument(updatedDoc);
            }

            console.log(`[Enrichment] Enriched Document ${docId}`);

            // 4. Scan for Links (Context Linking - Pillar 1)
            await this.scanForLinks(docId, orgId, text);

            // 5. Scan for Remediation logic (Governance 2.0)
            if (analysis.remediation_target) {
                await this.scanForRemediation(docId, orgId, analysis.remediation_target);
            }
        }
    }

    /**
     * Scan for Remediation links: Create REMEDIATES edge between doc/node and target.
     */
    async scanForRemediation(docId: number, orgId: number, targetName: string) {
        const [sourceNode] = await db.select().from(knowledgeNodes).where(eq(knowledgeNodes.knowledgeDocumentId, docId)).limit(1);
        if (!sourceNode) return;

        // Try to find the node being remediated
        const [targetNode] = await db.select().from(knowledgeNodes).where(
            and(
                eq(knowledgeNodes.organizationId, orgId),
                ilike(knowledgeNodes.name, `%${targetName}%`)
            )
        ).limit(1);

        if (targetNode && targetNode.id !== sourceNode.id) {
            await this.createEdgeIfNotExists(sourceNode.id, targetNode.id, "REMEDIATES", orgId);
            console.log(`[Enrichment] Identified Remediation: ${sourceNode.name} -> ${targetNode.name}`);
        }
    }

    /**
     * Regex Linker: Scans text for Jira Keys and URLs to create graph edges.
     */
    async scanForLinks(docId: number, orgId: number, content: string) {
        // Find the Source Node for this Document
        const [sourceNode] = await db.select().from(knowledgeNodes).where(eq(knowledgeNodes.knowledgeDocumentId, docId)).limit(1);
        if (!sourceNode) {
            console.warn(`[Enrichment] No Knowledge Node found for Document ${docId}, skipping link scanning.`);
            return;
        }

        const JIRA_PATTERN = /\b([A-Z]{2,10}-\d+)\b/g;
        // const URL_PATTERN = ... // Implement later if needed

        const jiraMatches = [...new Set(content.match(JIRA_PATTERN) || [])]; // Deduplicate

        for (const ticketKey of jiraMatches) {
            // Find Target Node (The Ticket)
            // Strategy: Look for Node with externalId = ticketKey OR name contains ticketKey
            const [targetNode] = await db.select().from(knowledgeNodes).where(
                and(
                    eq(knowledgeNodes.organizationId, orgId),
                    eq(knowledgeNodes.externalId, ticketKey)
                )
            ).limit(1);

            if (targetNode && targetNode.id !== sourceNode.id) {
                // Create Edge: Source (Doc) --[MENTIONS]--> Target (Ticket)
                await this.createEdgeIfNotExists(sourceNode.id, targetNode.id, "MENTIONS", orgId);
                console.log(`[Enrichment] Linked ${sourceNode.name} -> ${targetNode.name} (${ticketKey})`);
            }
        }
    }

    /**
     * AI-Driven Implicit Linker: Discovers relationships based on semantic overlap.
     */
    async scanForImplicitLinks(nodeId: number, orgId: number, summary: string) {
        if (!summary) return;

        // 1. Find potential candidate nodes (e.g., nodes sharing similar topics or names)
        // For efficiency, we'll look for nodes in the same organization
        const candidates = await db.select({ id: knowledgeNodes.id, name: knowledgeNodes.name, label: knowledgeNodes.label })
            .from(knowledgeNodes)
            .where(and(
                eq(knowledgeNodes.organizationId, orgId),
                sql`id != ${nodeId}` // Don't link to self
            ))
            .orderBy(desc(knowledgeNodes.updatedAt))
            .limit(10); // Check 10 most recent nodes for implicit links

        if (!Array.isArray(candidates) || candidates.length === 0) return;

        const candidateList = candidates.map(c => `[ID:${c.id}] ${c.label}: ${c.name}`).join("\n");
        const [sourceNode] = await db.select().from(knowledgeNodes).where(eq(knowledgeNodes.id, nodeId)).limit(1);

        const prompt = `
            Analyze these Knowledge Graph entities and identify any IMPLICIT relationships between the source and the candidates.
            
            Source Entity: ${sourceNode.name} (${sourceNode.label})
            Source Summary: ${summary}

            Candidates:
            ${candidateList}

            Identify if any candidate is related to the source. 
            Possible Relations: "DEPENDS_ON", "RELATED_TO", "IMPLEMENTS", "ADDRESSES", "PART_OF".
            
            Return JSON only:
            { "links": [ { "targetId": number, "relation": string, "reason": string } ] }
            If no links, return { "links": [] }.
        `;

        const analysis = await this.callAI(prompt);
        if (analysis && Array.isArray(analysis.links)) {
            for (const link of analysis.links) {
                if (link.targetId && link.relation) {
                    await this.createEdgeIfNotExists(nodeId, link.targetId, link.relation, orgId, { reason: link.reason });
                }
            }
        }
    }

    private async createEdgeIfNotExists(sourceId: number, targetId: number, relation: string, orgId: number, data: any = {}) {
        const [existing] = await db.select().from(knowledgeEdges).where(
            and(
                eq(knowledgeEdges.sourceId, sourceId),
                eq(knowledgeEdges.targetId, targetId),
                eq(knowledgeEdges.relation, relation)
            )
        ).limit(1);

        if (!existing) {
            await db.insert(knowledgeEdges).values({
                sourceId,
                targetId,
                relation,
                organizationId: orgId,
                weight: 5,
                data: data
            });
        }
    }

    // --- AI Helpers ---

    private async analyzeEntity(text: string) {
        const prompt = `
            Analyze this Knowledge Graph Entity.
            1. Assign 1-3 standardized Topics (e.g. "Infrastructure", "UI", "Billing", "Auth", "Documentation").
            2. Determine Sentiment (-1.0 to 1.0).
            3. Determine Urgency (0.0 to 1.0) based on critical words (outage, blocker, failure).
            4. Write a 1-sentence Summary.
            5. Provide a Confidence Score (0.0-1.0) for this analysis.
            6. Identify any "Creation Logic" or "Instantiation Flow" (how this entity is created, initialized, or triggered). If not present, use null.

            Input:
            ${text}

            Response JSON:
            { "topics": [], "sentiment": 0, "urgency": 0, "summary": "", "confidence": 0, "creation_logic": "" }
        `;
        return this.callAI(prompt);
    }

    private async analyzeDocument(text: string) {
        const prompt = `
            Analyze this Document.
            1. Write a concise "TL;DR" Summary (max 2 sentences).
            2. Extract 3-5 key Topics.
            3. Determine overall Sentiment (-1.0 to 1.0).
            4. Identify any "Creation Logic" or "Instantiation Flow" (how the primary subject of this document is created, initialized, or triggered).
            5. Identify if this document describes a fix, solution, or remediation for a specific System, Error, or Issue. If so, provide the "remediation_target" name.

            Input:
            ${text}

            Response JSON:
            { "summary": "", "topics": [], "sentiment": 0, "creation_logic": "", "remediation_target": null }
        `;
        return this.callAI(prompt);
    }

    private async callAI(prompt: string) {
        try {
            const client = AIClientFactory.getClient({ provider: "google" } as any);
            const result = await client.execute({
                credentialId: 0,
                model: "gemini-2.0-flash", // Fast & Cheap
                userPrompt: prompt,
                systemPrompt: "You are a Knowledge Enrichment Engine. Output strict JSON.",
                requestType: "json",
                temperature: 0.1,
                useCache: false,
                enableQueryExpansion: false,
                saveOutputToFile: false,
                maxTokens: 1024
            }, undefined, developmentProviderKey());

            if (!result.success || !result.output) return null;

            // Naive cleanup
            const jsonStr = result.output.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(jsonStr);
        } catch (e) {
            console.error("Enrichment AI Error:", e);
            return null;
        }
    }
}

export const enrichmentService = new EnrichmentService();


