import { createLogger } from "@server/utils/logger.js";
import { type TGEntity, type TGRelationship } from "./types.js";

const logger = createLogger("GraphRAGService");

export interface GraphRAGResult {
  entities: TGEntity[];
  relationships: TGRelationship[];
  summary: string;
}

export class GraphRAGService {
  /**
   * Performs a relational search against TrustGraph to discover deep context.
   * This is used by the Supervisor to "Orient" itself before planning.
   */
  static async query(params: {
    query: string;
    organizationId: number;
    missionId?: number;
    depth?: number;
    limit?: number;
  }): Promise<GraphRAGResult> {
    const { query, organizationId, missionId, depth = 2, limit = 10 } = params;
    if (!Number.isInteger(organizationId) || organizationId <= 0) throw new Error('GraphRAG requires an organization');
    if (!Number.isInteger(depth) || depth < 0 || depth > 5 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('GraphRAG depth must be 0–5 and limit must be 1–100');
    }
    const { graphRagService } = await import('../../knowledge/core/rag/graph-rag.service.js');
    const retrieved = await graphRagService.retrieveWithGraphTraversal(query, {
      organizationId, userId: 'supervisor', isAdmin: false, isOrgAdmin: false, isSuperAdmin: false,
    }, { maxHops: depth, maxResults: limit, includePaths: true, missionId });
    const records = retrieved.slice(0, limit);
    const entities: TGEntity[] = records.filter(record => record.nodeId !== undefined).map(record => ({
      id: String(record.nodeId),
      label: typeof record.metadata?.label === 'string' ? record.metadata.label : 'Knowledge',
      properties: { name: record.metadata?.name ?? `Knowledge node ${record.nodeId}`, confidence: record.confidence, paths: record.path ?? [] },
      provenance: { sourceId: `knowledge-node:${record.nodeId}`, timestamp: new Date(), evidence: record.content },
    }));
    // Paths carry names, not IDs. Only map an edge when both names resolve unambiguously.
    const idsByName = new Map<string, string[]>();
    for (const entity of entities) {
      const name = String(entity.properties.name);
      idsByName.set(name, [...(idsByName.get(name) ?? []), entity.id]);
    }
    const relationships = new Map<string, TGRelationship>();
    for (const record of records) for (const path of record.path ?? []) {
      const from = idsByName.get(path.from), to = idsByName.get(path.to);
      if (from?.length !== 1 || to?.length !== 1) continue;
      const relationship = { sourceId: from[0], targetId: to[0], type: path.relation, confidence: record.confidence };
      relationships.set(JSON.stringify([from[0], path.relation, to[0]]), relationship);
    }
    const result: GraphRAGResult = {
      entities, relationships: [...relationships.values()],
      summary: records.length
        ? `Retrieved ${records.length} knowledge records:\n${records.map(r => r.content).join('\n')}`
        : 'No matching knowledge records were retrieved.',
    };
    logger.info('Supervisor GraphRAG retrieval complete', { organizationId, count: records.length });

    return result;
  }

  /**
   * Formats a GraphRAG result into a string suitable for LLM prompts.
   */
  static formatForPrompt(result: GraphRAGResult): string {
    let output = `### STRUCTURAL CONTEXT (GraphRAG)\n`;
    output += `${result.summary}\n\n`;
    
    if (result.entities.length > 0) {
      output += `**Key Entities & Concepts:**\n`;
      result.entities.slice(0, 5).forEach(e => {
        const name = e.properties.name || e.id;
        const content = e.provenance.evidence || "";
        output += `- ${name} (${e.label}): ${content.substring(0, 100)}...\n`;
      });
      output += `\n`;
    }

    if (result.relationships.length > 0) {
      output += `**Observed Connections:**\n`;
      result.relationships.slice(0, 5).forEach(r => {
        output += `- [${r.sourceId}] --(${r.type})--> [${r.targetId}]\n`;
      });
    }

    return output;
  }
}


