import { hasAiOrganizationContext, withAiOrganization } from "@domain/ai/core/ai-org-context.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";
import { organizationEmbeddings } from "@domain/ai/core/org-embeddings.js";
/**
 * Knowledge Graph Service
 * 
 * Handles Qdrant integration for knowledge graph nodes:
 * - Embedding and indexing nodes in Qdrant
 * - Semantic search of nodes
 * - Context building for LLM triage
 */

import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { createHash } from "crypto";
import { KnowledgeNode, credentials, knowledgeNodes, knowledgeEdges, graphSchemaDefs } from "@shared/schema/index.js";
import {
  ensureQdrantCollection,
  upsertQdrantPoints,
  searchQdrant,
  deleteQdrantByFilter,
} from "../integrations/qdrant-client.js";
import { db } from "../database_service.js";
import { eq, and, like, or, inArray, sql } from "drizzle-orm";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { withEmbeddingRetry } from "@server/utils/embedding-retry.js";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

const EMBEDDING_MODEL = process.env.RAG_EMBEDDING_MODEL || "models/gemini-embedding-001";

if (!developmentProviderKey() && process.env.NODE_ENV !== "production") {
  console.warn(
    "[Knowledge Graph] GEMINI_API_KEY is not set. Node embeddings without an organization will fail until it is configured."
  );
}

const QDRANT_VECTOR_SIZE = parseInt(process.env.QDRANT_VECTOR_SIZE || "3072", 10);

// In-memory cache to prevent redundant embeddings within the same server lifecycle
const embeddingHashCache = new Set<string>();

let embeddingsInstance: GoogleGenerativeAIEmbeddings | null = null;
function getEmbeddings() {
  if (hasAiOrganizationContext() || process.env.NODE_ENV === "production") return organizationEmbeddings();
  if (!embeddingsInstance) {
    const baseEmbeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: developmentProviderKey(),
      model: EMBEDDING_MODEL,
    });

    // Wrap to truncate vectors if configured
    embeddingsInstance = {
      ...baseEmbeddings,
      embedQuery: async (text: string) => {
        const vector = await withEmbeddingRetry(() => baseEmbeddings.embedQuery(text), "embedQuery", "Knowledge Graph");
        return vector.length > QDRANT_VECTOR_SIZE ? vector.slice(0, QDRANT_VECTOR_SIZE) : vector;
      },
      embedDocuments: async (texts: string[]) => {
        const vectors = await withEmbeddingRetry(() => baseEmbeddings.embedDocuments(texts), "embedDocuments", "Knowledge Graph");
        return vectors.map(v => v.length > QDRANT_VECTOR_SIZE ? v.slice(0, QDRANT_VECTOR_SIZE) : v);
      }
    } as any;
  }
  return embeddingsInstance;
}

/**
 * Build text representation of a node for embedding
 */
function buildNodeText(node: KnowledgeNode): string {
  const parts: string[] = [node.name];

  if (node.label) {
    parts.push(`Type: ${node.label}`);
  }

  if (node.externalId) {
    parts.push(`ID: ${node.externalId}`);
  }

  // Include relevant data fields
  if (node.data && typeof node.data === 'object') {
    const data = node.data as Record<string, any>;
    if (data.description) parts.push(data.description);
    if (data.status) parts.push(`Status: ${data.status}`);
    if (data.priority) parts.push(`Priority: ${data.priority}`);
  }

  return parts.join(' ');
}

/**
 * Generate a deterministic UUID from an input string (SHA-1 based, UUID v5-like)
 */
function generateDeterministicUUID(input: string): string {
  const hash = createHash('sha1').update(input).digest('hex');
  // Format as UUID: 8-4-4-4-12
  return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`;
}

let spendingCapHit = false;

/**
 * Embed and index a knowledge graph node in Qdrant
 */
export async function embedKnowledgeNode(node: KnowledgeNode): Promise<void> {
  if ((!hasAiOrganizationContext() && process.env.NODE_ENV !== "production" && !developmentProviderKey()) || spendingCapHit) {
    return;
  }

  try {
    const nodeText = buildNodeText(node);
    
    // Check if we've already embedded this exact content for this node
    const contentHash = createHash('sha1').update(`${node.id}:${nodeText}`).digest('hex');
    if (embeddingHashCache.has(contentHash)) {
      // Skip redundant embedding
      return;
    }

    const embeddings = getEmbeddings();
    if (!embeddings) {
      throw new Error("Embeddings system not initialized");
    }
    const vector = await embeddings.embedQuery(nodeText);

    const pointId = generateDeterministicUUID(`node-${node.id}`);

    await upsertQdrantPoints([
      {
        id: pointId,
        vector,
        payload: {
          nodeId: node.id,
          label: node.label,
          name: node.name,
          organizationId: node.organizationId,
          externalId: node.externalId,
          data: node.data,
          knowledgeDocumentId: node.knowledgeDocumentId,
        },
      },
    ]);

    // Cache the hash on success
    embeddingHashCache.add(contentHash);
    
    console.log(`[Knowledge Graph] Indexed node ${node.id} in Qdrant`);
  } catch (error: any) {
    if (error?.status === 429 || error?.message?.includes("spending cap") || error?.message?.includes("Too Many Requests")) {
      spendingCapHit = true;
      console.warn("[Knowledge Graph] Spending cap or rate limit reached. Bypassing subsequent node embeddings.");
    }
    console.error(`[Knowledge Graph] Error embedding node ${node.id}:`, error);
    throw error;
  }
}

/**
 * Remove a node from Qdrant
 */
export async function deleteKnowledgeNodeFromQdrant(nodeId: number): Promise<void> {
  try {
    await deleteQdrantByFilter({
      must: [
        {
          key: "nodeId",
          match: { value: nodeId },
        },
      ],
    });
    console.log(`[Knowledge Graph] Removed node ${nodeId} from Qdrant`);
  } catch (error) {
    console.error(`[Knowledge Graph] Error deleting node ${nodeId} from Qdrant:`, error);
    // Don't throw - this is a cleanup operation
  }
}

/**
 * Search nodes semantically using Qdrant
 */
export async function searchNodesSemantically(
  query: string,
  organizationId: number,
  limit: number = 10
): Promise<Array<{ node: KnowledgeNode; score: number }>> {
  try {
    // Embed on the searched organization's key. This used to return [] whenever
    // the platform GEMINI_API_KEY was unset — which production always is, so
    // semantic search answered nothing for every customer. Outside a request's
    // AI context, scope the embedding to the organization being searched.
    const embedQuery = () => {
      const embeddings = getEmbeddings();
      if (!embeddings) throw new Error("Embeddings system not initialized");
      return embeddings.embedQuery(query);
    };
    const vector = hasAiOrganizationContext()
      ? await embedQuery()
      : await withAiOrganization(async () => organizationId, embedQuery);

    const results = await searchQdrant(vector, {
      limit,
      filter: {
        must: [
          {
            key: "organizationId",
            match: { value: organizationId },
          },
        ],
      },
    });

    // Extract node IDs and scores from results
    const nodeResults = results
      .map((hit) => {
        const payload = hit.payload || {};
        const nodeId = payload.nodeId as number | undefined;
        if (!nodeId) return null;

        return {
          nodeId,
          score: hit.score || 0,
        };
      })
      .filter((r): r is { nodeId: number; score: number } => r !== null);

    if (nodeResults.length === 0) return [];

    const nodeIds = nodeResults.map(r => r.nodeId);

    // Fetch actual nodes from database (Batch)
    const dbNodes = await db
      .select()
      .from(knowledgeNodes)
      .where(
        and(
          inArray(knowledgeNodes.id, nodeIds),
          eq(knowledgeNodes.organizationId, organizationId)
        )
      );

    // Join with scores
    return dbNodes.map(node => {
      const result = nodeResults.find(r => r.nodeId === node.id);
      return {
        node,
        score: result ? result.score : 0
      };
    }).sort((a, b) => b.score - a.score);
  } catch (error) {
    console.error("[Knowledge Graph] Error in semantic search:", error);
    return [];
  }
}

/**
 * Suggest a Knowledge Graph Schema for a given domain/description using LLM
 */
export async function suggestSchema(
  description: string,
  organizationId: number
): Promise<{ nodes: any[]; edges: any[] }> {
  // 1. Get AI Credential
  const allCreds = await db.select().from(credentials).where(eq(credentials.type, "ai_provider")).limit(1);
  if (allCreds.length === 0) {
    throw new Error("No AI Provider credential found to generate schema.");
  }

  const credential = allCreds[0];
  const apiKey = (await resolveCredentialSecret(credential));
  if (!apiKey) {
    throw new Error(`API Key not found for credential ${credential.name}`);
  }

  // 2. Construct Prompt
  const prompt = `
Role: Senior Data Architect.
Task: Design a Knowledge Graph Ontology for the following domain: "${description}".

Format: JSON.
Structure:
{
  "nodes": [
    { "label": "string", "description": "string", "properties": [{ "name": "string", "type": "string" }] }
  ],
  "edges": [
    { "relation": "string", "source_label": "string", "target_label": "string" }
  ]
}

Constraints:
- Use standard naming conventions (UpperSnakeCase for relations, PascalCase for nodes).
- Keep the schema simple (less than 8 node types).
- Use concrete, descriptive labels (e.g. 'Customer' instead of 'Person' if 'Person' is too generic for the domain).
- Return ONLY the JSON object, no markdown or comments.
`;

  // 3. Call LLM
  try {
    const metadata = credential.metadata as any;
    const client = AIClientFactory.getClient(metadata);

    const result = await client.execute({
      credentialId: credential.id,
      model: "gpt-4o-mini", // Fallback to whatever model the provider supports
      userPrompt: prompt,
      temperature: 0.1, // Deterministic
      requestType: "json", // Request JSON mode
      useCache: false,
      enableQueryExpansion: false,
      saveOutputToFile: false,
      isPriority: true
    }, undefined, apiKey);

    if (!result.success || !result.output) {
      throw new Error(`AI generation failed: ${result.error || "No output"}`);
    }

    let output = result.output;
    // Strip code blocks just in case
    if (output.includes('```json')) {
      output = output.replace(/```json/g, '').replace(/```/g, '').trim();
    } else if (output.includes('```')) {
      output = output.replace(/```/g, '').trim();
    }

    return JSON.parse(output);

  } catch (error) {
    console.error("[Knowledge Graph] Schema suggestion failed:", error);
    throw new Error(`Failed to generate schema: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Execute a Semantic Graph Query
 * Translates Natural Language -> Structured Graph Filter -> DB Query
 */
export async function semanticGraphQuery(
  query: string,
  organizationId: number
): Promise<{ nodes: any[]; edges: any[] }> {
  // 1. Get AI Credential
  const allCreds = await db.select().from(credentials).where(eq(credentials.type, "ai_provider")).limit(1);
  const credential = allCreds[0];
  if (!credential) throw new Error("No AI Provider credential found.");
  const apiKey = (await resolveCredentialSecret(credential));
  if (!apiKey) throw new Error("AI API Key not found.");

  // 2. Fetch Schema Definitions (Labels and Relations)
  const uniqueLabels = await db
    .selectDistinct({ label: knowledgeNodes.label })
    .from(knowledgeNodes)
    .where(eq(knowledgeNodes.organizationId, organizationId));

  const uniqueRelations = await db
    .selectDistinct({ relation: knowledgeEdges.relation })
    .from(knowledgeEdges)
    .where(eq(knowledgeEdges.organizationId, organizationId));

  const schemaSummary = {
    nodes: uniqueLabels.map(l => l.label),
    edges: uniqueRelations.map(r => r.relation)
  };

  // 3. Prompt LLM for Query Translation
  const prompt = `
Role: Graph Database Expert.
Task: Translate the user's natural language query into a structured JSON filter for a graph database.

Context (Available Schema):
${JSON.stringify(schemaSummary, null, 2)}

User Query: "${query}"

Output Format (JSON):
{
  "startNode": { "label": "string", "nameContains": "string" },
  "relation": { "type": "string" },
  "targetNode": { "label": "string", "nameContains": "string" },
  "temporal": {
    "before": "ISO8601 string",
    "after": "ISO8601 string",
    "between": { "start": "ISO8601 string", "end": "ISO8601 string" }
  }
}

Instructions:
- If the user asks for a specific node type, put it in 'startNode'.
- If the user mentions a relationship (e.g. "assigned to", "depends on"), put it in 'relation'.
- If the user specifies a target (e.g. "User X"), put it in 'targetNode'.
- If the user specifies time-based filters (e.g., "created before yesterday", "since 2024-01-01", "between June and July"), populate the 'temporal' field with ISO 8601 dates.
- If a field is not specified, leave it null or undefined.
- "nameContains" should match partial names.
`;

  // 4. Call LLM
  const metadata = credential.metadata as any;
  const client = AIClientFactory.getClient(metadata);
  const result = await client.execute({
    credentialId: credential.id,
    model: "gpt-4o-mini",
    userPrompt: prompt,
    temperature: 0,
    requestType: "json",
    useCache: false,
    enableQueryExpansion: false,
    saveOutputToFile: false,
    isPriority: true
  }, undefined, apiKey);

  if (!result.success || !result.output) throw new Error("Failed to translate query.");

  let filter;
  try {
    let cleanJson = result.output;
    if (cleanJson.includes('```')) cleanJson = cleanJson.replace(/```json/g, '').replace(/```/g, '').trim();
    filter = JSON.parse(cleanJson);
  } catch (e) {
    throw new Error("Invalid JSON from LLM: " + result.output);
  }

  // 5. Execute DB Query (Simplified Implementation)
  let searchConditions: any[] = [eq(knowledgeNodes.organizationId, organizationId)];

  // Explicitly cast or access safe properties
  const fStart = filter.startNode || {};
  const fRel = filter.relation || {};

  if (fStart.label) {
    searchConditions.push(eq(knowledgeNodes.label, fStart.label));
  }
  if (fStart.nameContains) {
    searchConditions.push(like(knowledgeNodes.name, `%${fStart.nameContains}%`));
  }

  // Handle Temporal Filters
  if (filter.temporal) {
    const t = filter.temporal;
    if (t.before) {
        searchConditions.push(sql`${knowledgeNodes.sourceCreatedAt} < ${new Date(t.before)}`);
    }
    if (t.after) {
        searchConditions.push(sql`${knowledgeNodes.sourceCreatedAt} > ${new Date(t.after)}`);
    }
    if (t.between && t.between.start && t.between.end) {
        searchConditions.push(and(
            sql`${knowledgeNodes.sourceCreatedAt} >= ${new Date(t.between.start)}`,
            sql`${knowledgeNodes.sourceCreatedAt} <= ${new Date(t.between.end)}`
        ));
    }
  }

  let matchedStartNodes = await db.select().from(knowledgeNodes).where(and(...searchConditions));

  let matchedEdges: any[] = [];

  // If relation is specified, find edges
  if (fRel.type && matchedStartNodes.length > 0) {
    const startIds = matchedStartNodes.map(n => n.id);

    // Find edges where source is in startNodes AND relation matches
    if (startIds.length > 0) {
      matchedEdges = await db.select().from(knowledgeEdges).where(
        and(
          eq(knowledgeEdges.relation, fRel.type),
          inArray(knowledgeEdges.sourceId, startIds)
        )
      );
    }
  }

  return {
    nodes: matchedStartNodes,
    edges: matchedEdges
  };
}

