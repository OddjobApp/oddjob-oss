import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";
import { db } from "@server/database_service.js";
import { knowledgeNodes, knowledgeEdges } from "@shared/schema/index.js";
import { eq, or, and, ilike, inArray, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("GraphTools");

export const GRAPH_TOOLS: Record<string, ToolDefinition> = {
  query_knowledge_subgraph: {
    name: "query_knowledge_subgraph",
    // Read-only: verified to perform no writes. Lets the planner run it
    // speculatively or in parallel (tool-planner.service.ts).
    idempotency: "read-safe",
    label: "Query Knowledge Graph Subgraph & Summarize",
    group: "Knowledge Management",
    riskLevel: "low",
    description:
      "Performs a multi-hop subgraph expansion and topological summarization around a named entity or concept in the Knowledge Graph. " +
      "Returns direct entity properties, inbound/outbound dependencies, causal relationships, and a Mermaid topology diagram.",
    parameters: z.object({
      entityName: z.string().min(2).describe("Name, external ID, or search query for the target entity/concept"),
      maxHops: z.number().int().min(1).max(3).optional().default(2).describe("Graph traversal depth (1 to 3 hops). Default 2."),
      limit: z.number().int().min(1).max(30).optional().default(15).describe("Max related nodes to return"),
      includeProperties: z.boolean().optional().default(true).describe("Whether to include entity properties/metadata"),
    }),
    execute: async (params: any, context: ToolContext) => {
      const orgId = context?.organizationId != null ? Number(context.organizationId) : null;
      const query = String(params.entityName || "").trim();
      if (!query) {
        return JSON.stringify({ error: "Please provide an entityName to query the Knowledge Graph." });
      }

      try {
        const orgCondition = orgId === null ? sql`${knowledgeNodes.organizationId} IS NULL` : eq(knowledgeNodes.organizationId, orgId);

        // 1. Find root node(s)
        const rootNodes = await db
          .select()
          .from(knowledgeNodes)
          .where(
            and(
              orgCondition,
              or(
                ilike(knowledgeNodes.name, `%${query}%`),
                ilike(knowledgeNodes.label, `%${query}%`),
                eq(knowledgeNodes.externalId, query)
              )
            )
          )
          .limit(3);

        if (rootNodes.length === 0) {
          return JSON.stringify({
            entityName: query,
            found: false,
            message: `No entity matching "${query}" was found in the Knowledge Graph. Try a broader search or check spelling.`,
          });
        }

        const primaryNode = rootNodes[0];
        const visitedNodeIds = new Set<number>([primaryNode.id]);
        let frontierNodeIds = [primaryNode.id];
        const collectedEdges: Array<{ sourceId: number; targetId: number; relation: string; data?: any }> = [];

        const hops = Math.min(3, Math.max(1, params.maxHops ?? 2));
        const maxLimit = params.limit ?? 15;

        // 2. Multi-hop BFS traversal
        for (let hop = 1; hop <= hops; hop++) {
          if (frontierNodeIds.length === 0 || visitedNodeIds.size >= maxLimit) break;

          const edgeOrgCondition = orgId === null ? sql`${knowledgeEdges.organizationId} IS NULL` : eq(knowledgeEdges.organizationId, orgId);

          const edges = await db
            .select({
              sourceId: knowledgeEdges.sourceId,
              targetId: knowledgeEdges.targetId,
              relation: knowledgeEdges.relation,
              data: knowledgeEdges.data,
            })
            .from(knowledgeEdges)
            .where(
              and(
                edgeOrgCondition,
                or(
                  inArray(knowledgeEdges.sourceId, frontierNodeIds),
                  inArray(knowledgeEdges.targetId, frontierNodeIds)
                )
              )
            )
            .limit(maxLimit * 2);

          const nextFrontier: number[] = [];
          for (const edge of edges) {
            collectedEdges.push(edge);
            const otherId = frontierNodeIds.includes(edge.sourceId) ? edge.targetId : edge.sourceId;
            if (!visitedNodeIds.has(otherId) && visitedNodeIds.size < maxLimit) {
              visitedNodeIds.add(otherId);
              nextFrontier.push(otherId);
            }
          }
          frontierNodeIds = nextFrontier;
        }

        // 3. Fetch all touched node details
        const allNodeIds = Array.from(visitedNodeIds);
        const allNodes = await db
          .select()
          .from(knowledgeNodes)
          .where(inArray(knowledgeNodes.id, allNodeIds));

        const nodeMap = new Map(allNodes.map((n) => [n.id, n]));

        // 4. Categorize relationships
        const outbound = collectedEdges.filter((e) => e.sourceId === primaryNode.id);
        const inbound = collectedEdges.filter((e) => e.targetId === primaryNode.id);
        const indirect = collectedEdges.filter(
          (e) => e.sourceId !== primaryNode.id && e.targetId !== primaryNode.id
        );

        // 5. Build Mermaid diagram
        let mermaid = "graph TD\n";
        mermaid += `    classDef root fill:#3b82f6,stroke:#1d4ed8,stroke-width:3px,color:#fff;\n`;
        mermaid += `    classDef neighbor fill:#10b981,stroke:#059669,stroke-width:2px,color:#fff;\n`;
        mermaid += `    N${primaryNode.id}["★ ${primaryNode.name} (${primaryNode.label})"]:::root\n`;

        allNodes.forEach((n) => {
          if (n.id !== primaryNode.id) {
            mermaid += `    N${n.id}["${n.name} (${n.label})"]:::neighbor\n`;
          }
        });

        const renderedEdgeKeys = new Set<string>();
        collectedEdges.forEach((e) => {
          const key = `${e.sourceId}->${e.relation}->${e.targetId}`;
          if (!renderedEdgeKeys.has(key) && nodeMap.has(e.sourceId) && nodeMap.has(e.targetId)) {
            renderedEdgeKeys.add(key);
            mermaid += `    N${e.sourceId} -->|${e.relation}| N${e.targetId}\n`;
          }
        });

        // 6. Build Topological Markdown Summary
        let summaryMd = `### Knowledge Graph Subgraph: ${primaryNode.name} (${primaryNode.label})\n\n`;
        if (params.includeProperties && primaryNode.data && Object.keys(primaryNode.data).length > 0) {
          summaryMd += `**Properties**:\n`;
          Object.entries(primaryNode.data).forEach(([k, v]) => {
            if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
              summaryMd += `- **${k}**: \`${v}\`\n`;
            }
          });
          summaryMd += `\n`;
        }

        if (outbound.length > 0) {
          summaryMd += `**Outbound Relationships (Dependencies & Targets)**:\n`;
          outbound.forEach((e) => {
            const target = nodeMap.get(e.targetId);
            summaryMd += `- \`${e.relation}\` ➔ **${target?.name || `Node #${e.targetId}`}** (${target?.label || "Entity"})\n`;
          });
          summaryMd += `\n`;
        }

        if (inbound.length > 0) {
          summaryMd += `**Inbound Relationships (Callers & Dependents)**:\n`;
          inbound.forEach((e) => {
            const source = nodeMap.get(e.sourceId);
            summaryMd += `- \`${e.relation}\` ⬅ **${source?.name || `Node #${e.sourceId}`}** (${source?.label || "Entity"})\n`;
          });
          summaryMd += `\n`;
        }

        if (indirect.length > 0) {
          summaryMd += `**Extended 2-Hop Network Connections (${indirect.length} edges)**:\n`;
          indirect.slice(0, 5).forEach((e) => {
            const s = nodeMap.get(e.sourceId);
            const t = nodeMap.get(e.targetId);
            summaryMd += `- **${s?.name || e.sourceId}** ➔ \`${e.relation}\` ➔ **${t?.name || e.targetId}**\n`;
          });
          summaryMd += `\n`;
        }

        return JSON.stringify({
          type: "graph_subgraph_summary",
          title: `Subgraph: ${primaryNode.name}`,
          entity: {
            id: primaryNode.id,
            name: primaryNode.name,
            label: primaryNode.label,
            externalId: primaryNode.externalId,
            properties: primaryNode.data,
          },
          topology: {
            nodeCount: allNodes.length,
            edgeCount: collectedEdges.length,
            nodes: allNodes.map((n) => ({ id: n.id, name: n.name, label: n.label })),
            edges: collectedEdges.map((e) => ({
              source: nodeMap.get(e.sourceId)?.name || e.sourceId,
              relation: e.relation,
              target: nodeMap.get(e.targetId)?.name || e.targetId,
            })),
          },
          summary: summaryMd,
          mermaid,
          suggestedExpansions: allNodes
            .filter((n) => n.id !== primaryNode.id)
            .slice(0, 5)
            .map((n) => ({ name: n.name, label: n.label, prompt: `@KnowledgeArchitect query subgraph around ${n.name}` })),
          actions: [
            { id: "export_svg", label: "Export Diagram", type: "download" },
            { id: "explore_in_garden", label: "View in Knowledge Garden", type: "navigate", url: `/knowledge/graph?nodeId=${primaryNode.id}` },
          ],
        });
      } catch (err: any) {
        logger.error("Failed to query knowledge subgraph:", err);
        return JSON.stringify({
          error: `Error querying knowledge subgraph: ${err?.message || String(err)}`,
        });
      }
    },
  },
};
