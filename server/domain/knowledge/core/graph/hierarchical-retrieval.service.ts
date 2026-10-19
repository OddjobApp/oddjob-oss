import { createLogger } from '@server/utils/logger.js';
import { db } from '@server/database_service.js';
import { knowledgeNodes, knowledgeEdges } from '@shared/schema/index.js';
import { eq, and, inArray } from 'drizzle-orm';
import { getOrgConditions } from '@server/utils/org-conditions.js';
import type { OrgContext } from '@server/utils/auth-context.js';

const logger = createLogger('HierarchicalRetrieval');
export interface Community { id: string; nodes: number[]; summary: string; level: number; parentCommunity?: string }
export interface HierarchicalQueryResult { localResults: any[]; communitySummaries: Map<string, string>; globalSummary: string; traversalPath: string[] }
type Hierarchy = Map<string, Community>;
type SummaryNode = { id: number; label: string; name: string; data: unknown };

/** Tenant-scoped, bounded snapshots. Community detection currently uses connected components. */
export class HierarchicalRetrievalService {
  private hierarchies = new Map<number | null, { expiresAt: number; pending: Promise<Hierarchy>; value?: Hierarchy }>();
  private conditions(orgId: number | null | undefined, table: typeof knowledgeNodes | typeof knowledgeEdges) {
    const context: OrgContext = { organizationId: orgId ?? null, userId: 'hierarchical-retrieval', isAdmin: false, isOrgAdmin: false, isSuperAdmin: false };
    return getOrgConditions(context, table, false);
  }
  async buildHierarchy(orgId?: number | null): Promise<void> {
    await this.getHierarchy(orgId, true);
  }
  private getHierarchy(orgId?: number | null, rebuild = false): Promise<Hierarchy> {
    const key = orgId ?? null, cached = this.hierarchies.get(key);
    if (!rebuild && cached && cached.expiresAt > Date.now()) return cached.pending;
    // Bound memory and freshness without retaining one tenant's state in another tenant's request.
    this.hierarchies.delete(key);
    if (this.hierarchies.size >= 64) this.hierarchies.delete(this.hierarchies.keys().next().value!);
    const entry: { expiresAt: number; pending: Promise<Hierarchy>; value?: Hierarchy } = {
      expiresAt: Date.now() + 60_000, pending: this.createHierarchy(orgId),
    };
    this.hierarchies.set(key, entry);
    entry.pending = entry.pending.then(value => { entry.value = value; return value; }, error => {
      if (this.hierarchies.get(key) === entry) this.hierarchies.delete(key);
      throw error;
    });
    return entry.pending;
  }
  private async createHierarchy(orgId?: number | null): Promise<Hierarchy> {
    const nodes = await db.select({ id: knowledgeNodes.id, label: knowledgeNodes.label, name: knowledgeNodes.name, data: knowledgeNodes.data })
      .from(knowledgeNodes).where(and(...this.conditions(orgId, knowledgeNodes)));
    const edges = await db.select({ source: knowledgeEdges.sourceId, target: knowledgeEdges.targetId })
      .from(knowledgeEdges).where(and(...this.conditions(orgId, knowledgeEdges)));
    const adjacency = new Map<number, number[]>(nodes.map(n => [n.id, []]));
    for (const edge of edges) {
      // Even malformed cross-tenant edges must not introduce out-of-scope nodes.
      if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) continue;
      adjacency.get(edge.source)!.push(edge.target); adjacency.get(edge.target)!.push(edge.source);
    }
    const byId = new Map<number, SummaryNode>(nodes.map(n => [n.id, n]));
    const visited = new Set<number>(), communities: Hierarchy = new Map();
    for (const node of nodes) {
      if (visited.has(node.id)) continue;
      const queue = [node.id]; visited.add(node.id);
      for (let cursor = 0; cursor < queue.length; cursor++) for (const neighbor of adjacency.get(queue[cursor]) ?? []) {
        if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
      }
      const id = `community-${communities.size}`;
      const descriptions = queue.map(nodeId => {
        const current = byId.get(nodeId)!;
        const data = current.data as { description?: unknown } | null;
        return `${current.label}: ${current.name} - ${typeof data?.description === 'string' ? data.description : ''}`;
      });
      communities.set(id, { id, nodes: queue, summary: `Community contains ${queue.length} entities:\n${descriptions.join('\n')}`, level: 1 });
    }
    const summaries = [...communities.values()].map(c => c.summary);
    communities.set('global', { id: 'global', nodes: nodes.map(n => n.id), level: 2, summary: `Global knowledge graph contains ${summaries.length} communities:\n${summaries.join('\n\n')}` });
    logger.info('Built organization hierarchy', { organizationId: orgId ?? null, communities: summaries.length });
    return communities;
  }
  async retrieveHierarchical(query: string, orgId?: number | null): Promise<HierarchicalQueryResult> {
    const communities = await this.getHierarchy(orgId);
    const results: HierarchicalQueryResult = { localResults: [], communitySummaries: new Map(), globalSummary: '', traversalPath: [] };
    const terms = query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
    const relevant = [...communities.values()].filter(c => c.level === 1)
      .map(c => ({ community: c, score: terms.filter(t => c.summary.toLowerCase().includes(t)).length }))
      .filter(c => c.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
    for (const { community } of relevant) {
      const nodes = await db.select().from(knowledgeNodes).where(and(inArray(knowledgeNodes.id, community.nodes), ...this.conditions(orgId, knowledgeNodes)));
      results.communitySummaries.set(community.id, community.summary);
      results.traversalPath.push(`community:${community.id}`);
      results.localResults.push(...nodes);
    }
    if (!results.localResults.length) { results.globalSummary = communities.get('global')?.summary ?? ''; results.traversalPath.push('global'); }
    return results;
  }
  async traverseWithHierarchy(startNodeId: number, maxHops = 3, orgId?: number | null): Promise<{ nodes: any[]; path: string[] }> {
    if (!Number.isInteger(maxHops) || maxHops < 0) throw new Error('maxHops must be a non-negative integer');
    const visited = new Set<number>(), queue = [{ nodeId: startNodeId, path: [] as string[] }];
    const nodes: any[] = [], paths: string[] = [];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const { nodeId, path } = queue[cursor];
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      const [node] = await db.select().from(knowledgeNodes).where(and(eq(knowledgeNodes.id, nodeId), ...this.conditions(orgId, knowledgeNodes))).limit(1);
      // Do not cross a node the caller cannot see, even if an outgoing edge is visible.
      if (!node) continue;
      nodes.push(node); paths.push([...path, node.name].join(' -> '));
      if (path.length >= maxHops) continue;
      const edges = await db.select({ target: knowledgeEdges.targetId }).from(knowledgeEdges)
        .where(and(eq(knowledgeEdges.sourceId, nodeId), ...this.conditions(orgId, knowledgeEdges)));
      for (const edge of edges) if (!visited.has(edge.target)) queue.push({ nodeId: edge.target, path: [...path, node.name] });
    }
    return { nodes, path: paths };
  }
  clearHierarchy(): void { this.hierarchies.clear(); }
  getStats(): { totalCommunities: number; totalNodes: number; levels: number } {
    const communities = [...this.hierarchies.values()].filter(e => e.expiresAt > Date.now()).flatMap(e => [...(e.value?.values() ?? [])]);
    return { totalCommunities: communities.length, totalNodes: communities.filter(c => c.level === 1).reduce((n, c) => n + c.nodes.length, 0), levels: new Set(communities.map(c => c.level)).size };
  }
}
export const hierarchicalRetrievalService = new HierarchicalRetrievalService();
