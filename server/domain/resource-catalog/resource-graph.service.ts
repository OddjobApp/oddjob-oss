import type { OrgContext } from "@server/utils/auth-context.js";
import {
  type PlatformResource,
  type ResourceGraphEdge,
  type ResourceGraphNode,
  type ResourceGraphResponse,
  type ResourceRelation,
} from "@shared/resource-catalog.js";

import { resourceCatalogService } from "./resource-catalog.service.js";
import { resourceEdgeService } from "./resource-edge.service.js";

const DEFAULT_GRAPH_DEPTH = 1;
const MAX_GRAPH_DEPTH = 3;
const MAX_GRAPH_NODES = 150;
const GRAPH_SCAN_PER_TYPE_LIMIT = 500;

export interface ResourceGraphOptions {
  maxDepth?: number;
}

function clampDepth(value: number | undefined): number {
  if (value == null || Number.isNaN(value)) return DEFAULT_GRAPH_DEPTH;
  return Math.min(Math.max(Math.trunc(value), 0), MAX_GRAPH_DEPTH);
}

function derivedGraphEdge(fromKey: string, relation: ResourceRelation): ResourceGraphEdge {
  return {
    id: `derived:${fromKey}:${relation.type}:${relation.targetKey}`,
    fromKey,
    toKey: relation.targetKey,
    relationType: relation.type,
    source: "derived",
    label: relation.label,
    metadata: relation.metadata,
  };
}

function persistedGraphEdge(currentKey: string, relation: ResourceRelation): ResourceGraphEdge {
  const edgeId = relation.metadata?.edgeId;
  const direction = relation.metadata?.direction;
  const isCurrentTarget = direction === "target";
  return {
    id: edgeId ? `persisted:${edgeId}` : `persisted:${currentKey}:${relation.type}:${relation.targetKey}`,
    fromKey: isCurrentTarget ? relation.targetKey : currentKey,
    toKey: isCurrentTarget ? currentKey : relation.targetKey,
    relationType: relation.type,
    source: "persisted",
    label: relation.label,
    metadata: relation.metadata,
  };
}

function otherEndpoint(edge: ResourceGraphEdge, key: string): string | null {
  if (edge.fromKey === key) return edge.toKey;
  if (edge.toKey === key) return edge.fromKey;
  return null;
}

function edgeKey(edge: ResourceGraphEdge): string {
  return `${edge.source}:${edge.fromKey}:${edge.relationType}:${edge.toKey}:${edge.id}`;
}

/**
 * Builds a bounded visible neighborhood around a resource. Unlike the plain
 * resource detail endpoint, this includes incoming derived edges too, so
 * dependency-heavy resources such as credentials and datasets are not shown as
 * isolated simply because their links point toward them.
 */
export async function getResourceGraph(
  orgContext: OrgContext,
  key: string,
  options: ResourceGraphOptions = {},
): Promise<ResourceGraphResponse> {
  const maxDepth = clampDepth(options.maxDepth);
  const root = await resourceCatalogService.getResourceByKey(key, orgContext);

  const catalog = await resourceCatalogService.listResources(orgContext, {
    perTypeLimit: GRAPH_SCAN_PER_TYPE_LIMIT,
  });
  const resourcesByKey = new Map(catalog.resources.map((resource) => [resource.key, resource]));
  resourcesByKey.set(root.key, root);

  const derivedEdges: ResourceGraphEdge[] = [];
  for (const resource of catalog.resources) {
    for (const relation of resource.relations) {
      if (relation.source === "persisted") continue;
      derivedEdges.push(derivedGraphEdge(resource.key, relation));
    }
  }

  const possibleScanTruncation = Object.values(catalog.summary.byType).some(
    (count) => (count ?? 0) >= GRAPH_SCAN_PER_TYPE_LIMIT,
  );
  const failedResolutions = new Set<string>();
  async function resolve(resourceKey: string): Promise<PlatformResource | null> {
    const cached = resourcesByKey.get(resourceKey);
    if (cached) return cached;
    if (failedResolutions.has(resourceKey)) return null;
    const fetched = await resourceCatalogService.getResourceByKey(resourceKey, orgContext).catch(() => null);
    if (fetched) resourcesByKey.set(resourceKey, fetched);
    else failedResolutions.add(resourceKey);
    return fetched;
  }

  const nodes = new Map<string, ResourceGraphNode>();
  const edges = new Map<string, ResourceGraphEdge>();
  const queued = new Set<string>([root.key]);
  const queue: Array<{ key: string; depth: number }> = [{ key: root.key, depth: 0 }];
  let truncated = possibleScanTruncation;

  nodes.set(root.key, { resource: root, depth: 0, isRoot: true });

  while (queue.length > 0) {
    if (nodes.size >= MAX_GRAPH_NODES) {
      truncated = true;
      break;
    }

    const current = queue.shift()!;
    const currentResource = await resolve(current.key);
    if (!currentResource) continue;

    const persistedEdges = await resourceEdgeService
      .listEdgesForResource(orgContext, currentResource.type, currentResource.id)
      .then((relations) => relations.map((relation) => persistedGraphEdge(current.key, relation)))
      .catch(() => []);

    const candidates = [
      ...derivedEdges.filter((edge) => edge.fromKey === current.key || edge.toKey === current.key),
      ...persistedEdges,
    ];

    for (const edge of candidates) {
      const otherKey = otherEndpoint(edge, current.key);
      if (!otherKey || otherKey === current.key) continue;

      const alreadyQueued = queued.has(otherKey);
      const nextDepth = current.depth + 1;
      if (!alreadyQueued && nextDepth > maxDepth) {
        truncated = true;
        continue;
      }

      const otherResource = await resolve(otherKey);
      if (!otherResource) continue;

      edges.set(edgeKey(edge), edge);
      if (nodes.has(otherKey)) continue;

      nodes.set(otherKey, { resource: otherResource, depth: nextDepth, isRoot: false });
      if (!alreadyQueued) {
        queued.add(otherKey);
        queue.push({ key: otherKey, depth: nextDepth });
      }
    }
  }

  const visibleKeys = new Set(nodes.keys());
  const visibleEdges = Array.from(edges.values()).filter(
    (edge) => visibleKeys.has(edge.fromKey) && visibleKeys.has(edge.toKey),
  );

  return {
    root,
    nodes: Array.from(nodes.values()).sort((a, b) => a.depth - b.depth || a.resource.name.localeCompare(b.resource.name)),
    edges: visibleEdges,
    maxDepth,
    truncated,
    generatedAt: new Date().toISOString(),
  };
}
