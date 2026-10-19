import { db } from "@server/database_service.js";
import { eq, and, sql } from "drizzle-orm";
import { knowledgeNodes, knowledgeEdges, credentials } from "@shared/schema/index.js";
import { graphRagService, type GraphRAGResult, type GraphRAGOptions } from "./graph-rag.service.js";
import { embeddingService } from "./embedding-service.js";
import { createLogger } from "@server/utils/logger.js";
import { aiRateLimiter, type AIProvider } from "@server/utils/ai-rate-limiter.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

const logger = createLogger("AgenticRAG");

/**
 * Query Planning Output - Structured reasoning about what to retrieve
 */
export interface QueryPlan {
    originalQuery: string;
    reasoning: string;
    informationNeeds: InformationNeed[];
    confidence: number; // 0-1 confidence in plan
    estimatedCompleteness: number; // 0-1 estimated coverage
}

export interface InformationNeed {
    id: string;
    description: string;
    entityTypes: string[]; // e.g., ["Person", "Job", "Incident"]
    relationTypes: string[]; // e.g., ["created_by", "belongs_to"]
    priority: number; // 1-10
    confidenceThreshold: number;
}

/**
 * Agentic RAG Result with confidence calibration
 */
export interface AgenticRAGResult {
    content: string;
    confidence: number;
    source: "vector" | "graph" | "hybrid" | "inferred";
    nodeId?: number;
    path?: Array<{ from: string; relation: string; to: string }>;
    metadata?: {
        label?: string;
        name?: string;
        informationNeedId?: string;
        retrievalReasoning?: string;
    };
}

/**
 * KA-RAG (Knowledge-Augmented Agentic RAG) Service
 * 
 * Research backing (MDPI 2025): Agentic RAG where agents perform reasoning
 * steps before retrieval, with confidence calibration
 */
export const agenticRagService = {
    /**
     * Agentic retrieval with query planning and confidence calibration
     */
    async retrieveAgentically(
        query: string,
        orgContext: OrgContext,
        options: {
            maxHops?: number;
            maxResults?: number;
            minConfidence?: number;
            includeReasoning?: boolean;
        } = {}
    ): Promise<{
        plan: QueryPlan;
        results: AgenticRAGResult[];
        coverage: {
            foundNeeds: number;
            totalNeeds: number;
            confidence: number;
        };
    }> {
        const startTime = Date.now();
        const { maxHops = 2, maxResults = 5, minConfidence = 0.6, includeReasoning = true } = options;

        // Step 1: Query Planning - LLM reasons about what information is needed
        const plan = await this.planQuery(query, orgContext);
        logger.info("Query plan generated", {
            query: query.substring(0, 50),
            needsCount: plan.informationNeeds.length,
            planConfidence: plan.confidence
        });

        // Step 2: Execute targeted retrieval for each information need
        const allResults: AgenticRAGResult[] = [];
        const foundNeedIds = new Set<string>();

        for (const need of plan.informationNeeds) {
            const needResults = await this.retrieveForNeed(
                need,
                query,
                orgContext,
                { maxHops, maxResults: Math.ceil(maxResults / plan.informationNeeds.length) }
            );

            if (needResults.length > 0) {
                foundNeedIds.add(need.id);
            }

            // Mark results with their information need
            for (const result of needResults) {
                allResults.push({
                    ...result,
                    metadata: {
                        ...result.metadata,
                        informationNeedId: need.id,
                        retrievalReasoning: includeReasoning ? 
                            `Retrieved to satisfy: ${need.description}` : undefined
                    }
                });
            }
        }

        // Step 3: Confidence calibration and result ranking
        const calibratedResults = this.calibrateConfidence(allResults, plan, minConfidence);
        const rankedResults = this.rankResults(calibratedResults).slice(0, maxResults);

        // Step 4: Calculate coverage metrics
        const coverage = {
            foundNeeds: foundNeedIds.size,
            totalNeeds: plan.informationNeeds.length,
            confidence: this.calculateCoverageConfidence(rankedResults, plan)
        };

        const duration = Date.now() - startTime;
        logger.info("Agentic RAG complete", {
            durationMs: duration,
            resultsCount: rankedResults.length,
            coverage: `${coverage.foundNeeds}/${coverage.totalNeeds}`,
            coverageConfidence: coverage.confidence.toFixed(2)
        });

        return {
            plan: includeReasoning ? plan : { ...plan, reasoning: "" },
            results: rankedResults,
            coverage
        };
    },

    /**
     * Query Planning - Use LLM to reason about information needs
     */
    async planQuery(query: string, orgContext: OrgContext): Promise<QueryPlan> {
        const systemPrompt = `You are a query planning agent for a knowledge retrieval system.
Your task is to analyze a user's query and determine what information is needed to answer it.

Analyze the query and output a structured plan in this JSON format:
{
    "reasoning": "Step-by-step analysis of what information is needed",
    "informationNeeds": [
        {
            "id": "need_1",
            "description": "What this information need covers",
            "entityTypes": ["Person", "Job", "Incident"], // Node labels to search
            "relationTypes": ["created_by", "belongs_to"], // Edge types to traverse
            "priority": 8, // 1-10 importance
            "confidenceThreshold": 0.7 // Minimum confidence for relevant results
        }
    ],
    "confidence": 0.85, // 0-1 confidence in this plan
    "estimatedCompleteness": 0.9 // 0-1 how complete this plan likely is
}

Rules:
1. Break complex queries into multiple information needs
2. Consider entity types and relationships explicitly
3. Assign higher priority to critical information
4. Be realistic about confidence - don't overestimate
5. If the query is vague, plan for broader retrieval with lower confidence`;

        try {
            const planResult = await aiRateLimiter.execute(
                "openai" as AIProvider,
                orgContext.organizationId as number,
                async () => {
                    const [cred] = await db.select()
                        .from(credentials)
                        .where(eq(credentials.type, 'openai'))
                        .limit(1);

                    if (!cred) throw new Error("No OpenAI credentials found");

                    const apiKey = (await resolveCredentialSecret(cred));
                    if (!apiKey) throw new Error("OpenAI API key not configured");

                    const response = await fetch('https://api.openai.com/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${apiKey}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            model: 'gpt-4o-mini',
                            messages: [
                                { role: 'system', content: systemPrompt },
                                { role: 'user', content: `Analyze this query: "${query}"` }
                            ],
                            temperature: 0.3,
                            response_format: { type: 'json_object' }
                        }),
                    });

                    if (!response.ok) {
                        throw new Error(`OpenAI API error: ${response.status}`);
                    }

                    const data = await response.json();
                    const content = data.choices?.[0]?.message?.content;
                    if (!content) throw new Error("Empty response from OpenAI");

                    return JSON.parse(content) as QueryPlan;
                },
                {
                    priority: 3, // Higher priority for planning
                    estimatedTokens: { input: 500, output: 400 },
                    model: "gpt-4o-mini"
                }
            );

            return {
                ...planResult,
                originalQuery: query
            };

        } catch (error) {
            logger.error("Query planning failed, using fallback", { error, query });
            
            // Fallback: Generic plan with broad retrieval
            return {
                originalQuery: query,
                reasoning: "Fallback plan due to planning failure",
                informationNeeds: [{
                    id: "fallback_1",
                    description: "General search for query-related information",
                    entityTypes: [],
                    relationTypes: [],
                    priority: 5,
                    confidenceThreshold: 0.6
                }],
                confidence: 0.5,
                estimatedCompleteness: 0.5
            };
        }
    },

    /**
     * Retrieve information for a specific need using targeted graph traversal
     */
    async retrieveForNeed(
        need: InformationNeed,
        originalQuery: string,
        orgContext: OrgContext,
        options: { maxHops: number; maxResults: number }
    ): Promise<AgenticRAGResult[]> {
        // Use GraphRAG with entity type and relation filtering
        const graphResults = await graphRagService.retrieveWithGraphTraversal(
            originalQuery,
            orgContext,
            {
                maxHops: options.maxHops,
                maxResults: options.maxResults,
                includePaths: true,
                relationFilter: need.relationTypes.length > 0 ? need.relationTypes : undefined,
                direction: "both"
            }
        );

        // Filter by entity types if specified
        let filteredResults = graphResults;
        if (need.entityTypes.length > 0) {
            filteredResults = graphResults.filter(r => {
                const label = r.metadata?.label as string;
                return need.entityTypes.some(et => 
                    label?.toLowerCase().includes(et.toLowerCase())
                );
            });
        }

        // Filter by confidence threshold
        filteredResults = filteredResults.filter(r => r.confidence >= need.confidenceThreshold);

        return filteredResults.map(r => ({
            content: r.content,
            confidence: r.confidence,
            source: r.source,
            nodeId: r.nodeId,
            path: r.path,
            metadata: r.metadata
        }));
    },

    /**
     * Calibrate confidence scores based on retrieval quality and plan confidence
     */
    calibrateConfidence(
        results: AgenticRAGResult[],
        plan: QueryPlan,
        minConfidence: number
    ): AgenticRAGResult[] {
        return results.map(r => {
            // Base confidence from retrieval
            let calibrated = r.confidence;

            // Adjust by plan confidence (if plan is uncertain, lower result confidence)
            calibrated *= (0.7 + 0.3 * plan.confidence);

            // Boost for graph-traversed results (multi-hop reasoning is more valuable)
            if (r.source === "graph" && r.path && r.path.length > 0) {
                calibrated *= 1.1;
            }

            // Penalize if below minimum threshold
            if (calibrated < minConfidence) {
                calibrated *= 0.5;
            }

            // Cap at 1.0
            calibrated = Math.min(1.0, calibrated);

            return {
                ...r,
                confidence: calibrated
            };
        });
    },

    /**
     * Rank results by calibrated confidence and diversity
     */
    rankResults(results: AgenticRAGResult[]): AgenticRAGResult[] {
        // Deduplicate by nodeId
        const seen = new Map<number, AgenticRAGResult>();
        for (const r of results) {
            if (!r.nodeId) continue;
            const existing = seen.get(r.nodeId);
            if (!existing || existing.confidence < r.confidence) {
                seen.set(r.nodeId, r);
            }
        }

        // Sort by confidence, then by source preference
        const sourcePriority = { hybrid: 3, graph: 2, vector: 1, inferred: 0 };

        return Array.from(seen.values())
            .sort((a, b) => {
                if (Math.abs(a.confidence - b.confidence) > 0.05) {
                    return b.confidence - a.confidence;
                }
                return (sourcePriority[b.source] || 0) - (sourcePriority[a.source] || 0);
            });
    },

    /**
     * Calculate overall coverage confidence
     */
    calculateCoverageConfidence(
        results: AgenticRAGResult[],
        plan: QueryPlan
    ): number {
        if (results.length === 0) return 0;

        // Average result confidence weighted by priority
        const totalWeight = results.reduce((sum, r) => {
            const needId = r.metadata?.informationNeedId;
            const need = plan.informationNeeds.find(n => n.id === needId);
            const weight = need ? need.priority / 10 : 0.5;
            return sum + weight * r.confidence;
        }, 0);

        const totalPossibleWeight = plan.informationNeeds.reduce((sum, n) => sum + n.priority / 10, 0);

        return totalPossibleWeight > 0 ? totalWeight / totalPossibleWeight : 0;
    },

    /**
     * Check if retrieval has sufficient information (confidence calibration)
     */
    hasSufficientInformation(
        coverage: { foundNeeds: number; totalNeeds: number; confidence: number },
        threshold: number = 0.7
    ): boolean {
        return coverage.confidence >= threshold && coverage.foundNeeds > 0;
    },

    /**
     * Generate follow-up queries for insufficient coverage
     */
    generateFollowUpQueries(
        plan: QueryPlan,
        coverage: { foundNeeds: number; totalNeeds: number; foundNeedIds: Set<string> }
    ): string[] {
        const unfilledNeeds = plan.informationNeeds.filter(
            n => !coverage.foundNeedIds.has(n.id)
        );

        return unfilledNeeds.map(need => 
            `Search for: ${need.description} (types: ${need.entityTypes.join(", ")})`
        );
    },

    /**
     * Find semantic neighbors for concept expansion
     */
    async findSemanticNeighbors(
        concept: string,
        orgContext: OrgContext,
        maxResults: number = 5
    ): Promise<Array<{ name: string; similarity: number; nodeId: number }>> {
        // Get embedding for concept
        const embedding = await embeddingService.generateEmbedding(concept);
        if (!embedding) return [];

        // Find similar nodes in graph
        const nodes = await db
            .select({
                id: knowledgeNodes.id,
                name: knowledgeNodes.name,
                embedding: knowledgeNodes.embedding
            })
            .from(knowledgeNodes)
            .where(and(
                orgContext.organizationId ? eq(knowledgeNodes.organizationId, orgContext.organizationId) : sql`1=1`,
                sql`${knowledgeNodes.embedding} IS NOT NULL`
            ))
            .limit(50);

        const scored = nodes.map(node => {
            try {
                const nodeEmbedding = JSON.parse(node.embedding || '[]');
                const similarity = this.cosineSimilarity(embedding, nodeEmbedding);
                return { nodeId: node.id, name: node.name, similarity };
            } catch {
                return { nodeId: node.id, name: node.name, similarity: 0 };
            }
        });

        return scored
            .filter(s => s.similarity > 0.75)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, maxResults);
    },

    cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) return 0;
        let dotProduct = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        return Math.sqrt(normA) * Math.sqrt(normB) === 0 ? 0 : dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
};

export default agenticRagService;
