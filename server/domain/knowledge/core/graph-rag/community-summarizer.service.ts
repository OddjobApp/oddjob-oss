import { createLogger } from "@server/utils/logger.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { db } from "@server/database_service.js";
import { knowledgeNodes, knowledgeEdges } from "@shared/schema/index.js";
import { eq, and, sql } from "drizzle-orm";

const logger = createLogger("CommunitySummarizer");

export interface CommunitySummary {
  communityId: string;
  summary: string;
  nodeIds: number[];
}

export class CommunitySummarizerService {
  private static summariesCache: Map<string, CommunitySummary[]> = new Map();

  /**
   * Label propagation algorithm for community detection in the graph.
   */
  static detectCommunities(
    nodes: Array<{ id: number }>,
    edges: Array<{ sourceId: number; targetId: number }>
  ): Map<string, number[]> {
    const nodeIds = nodes.map(n => n.id);
    const labels = new Map<number, number>();
    const adjacency = new Map<number, number[]>();

    // Initialize label of each node to its own ID
    for (const id of nodeIds) {
      labels.set(id, id);
      adjacency.set(id, []);
    }

    // Populate adjacency list
    for (const edge of edges) {
      const s = edge.sourceId;
      const t = edge.targetId;
      if (adjacency.has(s) && adjacency.has(t)) {
        adjacency.get(s)!.push(t);
        adjacency.get(t)!.push(s);
      }
    }

    // Iterate label propagation
    let changed = true;
    let iterations = 0;
    const maxIterations = 15;

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      // Shuffle node IDs to prevent order bias
      const shuffledIds = [...nodeIds].sort(() => Math.random() - 0.5);

      for (const id of shuffledIds) {
        const neighbors = adjacency.get(id) || [];
        if (neighbors.length === 0) continue;

        // Count frequency of labels among neighbors
        const labelCounts = new Map<number, number>();
        for (const neighbor of neighbors) {
          const l = labels.get(neighbor)!;
          labelCounts.set(l, (labelCounts.get(l) || 0) + 1);
        }

        // Find the majority label
        let maxCount = -1;
        let majorityLabel = labels.get(id)!;
        for (const [l, count] of labelCounts.entries()) {
          if (count > maxCount) {
            maxCount = count;
            majorityLabel = l;
          }
        }

        if (labels.get(id) !== majorityLabel) {
          labels.set(id, majorityLabel);
          changed = true;
        }
      }
    }

    // Group node IDs by community label
    const communities = new Map<string, number[]>();
    for (const [id, label] of labels.entries()) {
      const labelKey = `community-${label}`;
      const group = communities.get(labelKey) || [];
      group.push(id);
      communities.set(labelKey, group);
    }

    logger.info(`[CommunitySummarizer] Grouped ${nodes.length} nodes into ${communities.size} communities.`);
    return communities;
  }

  /**
   * Builds summaries for all communities in an organization.
   */
  static async generateCommunitySummaries(orgId: number | null): Promise<CommunitySummary[]> {
    const cacheKey = String(orgId || "global");
    if (this.summariesCache.has(cacheKey)) {
      return this.summariesCache.get(cacheKey)!;
    }

    // 1. Fetch nodes and edges
    const nodes = await db.select().from(knowledgeNodes).where(
      orgId ? eq(knowledgeNodes.organizationId, orgId) : sql`${knowledgeNodes.organizationId} IS NULL`
    );
    const edges = await db.select().from(knowledgeEdges).where(
      orgId ? eq(knowledgeEdges.organizationId, orgId) : sql`${knowledgeEdges.organizationId} IS NULL`
    );

    if (nodes.length === 0) {
      return [];
    }

    // 2. Cluster
    const communityMap = this.detectCommunities(nodes, edges);
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const summaries: CommunitySummary[] = [];

    // 3. Summarize each community using LLM
    for (const [communityId, ids] of communityMap.entries()) {
      const memberDetails = ids
        .map(id => nodeMap.get(id))
        .filter(Boolean)
        .map(n => `- Node: ${n!.name} (label: ${n!.label || "none"})\n  Data: ${JSON.stringify(n!.data)}`)
        .join("\n\n");

      const prompt = `
You are the Community Summarizer. Summarize this cluster of entities into a single cohesive community profile.
Identify the main theme, topics, and connections between these entities.

### Cluster Entities:
${memberDetails}

Return a concise, high-level summary of what this community represents.
`;

      const summaryText = await systemAiService.generateText(prompt, { serviceKey: "concierge" });
      summaries.push({
        communityId,
        summary: summaryText || "No summary compiled.",
        nodeIds: ids
      });
    }

    this.summariesCache.set(cacheKey, summaries);
    return summaries;
  }

  /**
   * Queries community summaries for global, high-level context.
   */
  static async queryCommunitySummaries(query: string, summaries: CommunitySummary[]): Promise<string> {
    if (summaries.length === 0) return "No graph community summaries available.";

    const summariesList = summaries
      .map(s => `Community: ${s.communityId}\nSummary: ${s.summary}`)
      .join("\n\n");

    const prompt = `
You are the GraphRAG Global Synthesizer. Based on the community summaries below, synthesize a high-level answer to the query.

### Query:
"${query}"

### Community Summaries:
${summariesList}

Provide a synthesized overview matching the query context.
`;

    const answer = await systemAiService.generateText(prompt, { serviceKey: "concierge" });
    return answer || "No global answer could be generated.";
  }

  static clearCache(): void {
    this.summariesCache.clear();
  }
}
