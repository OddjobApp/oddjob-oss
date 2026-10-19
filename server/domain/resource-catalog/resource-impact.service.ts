import type { OrgContext } from "@server/utils/auth-context.js";
import { BadRequestError } from "@server/utils/errors.js";
import {
  isResourceRelationType,
  type PlatformResource,
} from "@shared/resource-catalog.js";

import { resourceCatalogService } from "./resource-catalog.service.js";
import { resourceEdgeService } from "./resource-edge.service.js";

const DEFAULT_MAX_DEPTH = 3;
const MAX_MAX_DEPTH = 6;
const MAX_VISITED_NODES = 250;

// Use an explicit per-type scan cap for graph analysis so the final result is
// not sliced by the public API's global `limit` semantics.
const CATALOG_SCAN_PER_TYPE_LIMIT = 500;

interface ImpactCandidate {
  otherKey: string;
  relationType: string;
  source: "derived" | "persisted";
}

export interface ImpactEdge {
  fromKey: string;
  toKey: string;
  relationType: string;
  source: "derived" | "persisted";
}

export interface ImpactNode {
  resource: PlatformResource;
  depth: number;
}

export interface ImpactAnalysisOptions {
  maxDepth?: number;
  relationTypes?: string[];
}

export interface ImpactAnalysisResult {
  root: PlatformResource;
  maxDepth: number;
  nodes: ImpactNode[];
  edges: ImpactEdge[];
  /** True if the BFS hit maxDepth, the node cap, or the catalog scan may itself be capped (large org). */
  truncated: boolean;
}

function buildDerivedReverseIndex(resources: PlatformResource[]): Map<string, ImpactCandidate[]> {
  const index = new Map<string, ImpactCandidate[]>();
  for (const resource of resources) {
    for (const relation of resource.relations) {
      if (relation.source === "persisted") continue; // persisted edges are traversed separately, per-node
      const candidate: ImpactCandidate = { otherKey: resource.key, relationType: relation.type, source: "derived" };
      const bucket = index.get(relation.targetKey);
      if (bucket) bucket.push(candidate);
      else index.set(relation.targetKey, [candidate]);
    }
  }
  return index;
}

/**
 * Answers "what depends on this resource" by walking incoming edges (derived + persisted)
 * outward from `key`, bounded by depth and node count. Every emitted node is resolved through
 * resourceCatalogService under the caller's own org context, so the result can never surface a
 * resource the caller couldn't otherwise see (a stale edge pointing at a deleted or
 * now-invisible resource is silently dropped rather than included).
 */
export async function analyzeResourceImpact(
  orgContext: OrgContext,
  key: string,
  options: ImpactAnalysisOptions = {},
): Promise<ImpactAnalysisResult> {
  if (options.relationTypes?.some((type) => !isResourceRelationType(type))) {
    throw new BadRequestError("Unsupported relation type in relationTypes filter", { relationTypes: options.relationTypes });
  }
  const relationFilter = options.relationTypes?.length ? new Set(options.relationTypes) : null;
  const maxDepth = Math.min(Math.max(Math.trunc(options.maxDepth ?? DEFAULT_MAX_DEPTH), 1), MAX_MAX_DEPTH);

  const root = await resourceCatalogService.getResourceByKey(key, orgContext);

  const catalog = await resourceCatalogService.listResources(orgContext, {
    perTypeLimit: CATALOG_SCAN_PER_TYPE_LIMIT,
  });
  const catalogByKey = new Map(catalog.resources.map((resource) => [resource.key, resource]));
  catalogByKey.set(root.key, root);
  const derivedReverseIndex = buildDerivedReverseIndex(catalog.resources);

  const catalogPossiblyTruncated = Object.values(catalog.summary.byType).some(
    (count) => (count ?? 0) >= CATALOG_SCAN_PER_TYPE_LIMIT,
  );

  const resolveFailed = new Set<string>();
  async function resolve(resourceKey: string): Promise<PlatformResource | null> {
    const cached = catalogByKey.get(resourceKey);
    if (cached) return cached;
    if (resolveFailed.has(resourceKey)) return null;
    const fetched = await resourceCatalogService.getResourceByKey(resourceKey, orgContext).catch(() => null);
    if (fetched) catalogByKey.set(resourceKey, fetched);
    else resolveFailed.add(resourceKey);
    return fetched;
  }

  const nodes = new Map<string, ImpactNode>();
  const edges: ImpactEdge[] = [];
  const edgeSeen = new Set<string>();
  const queued = new Set<string>([root.key]);
  const queue: Array<{ key: string; depth: number }> = [{ key: root.key, depth: 0 }];
  let truncated = catalogPossiblyTruncated;

  while (queue.length > 0) {
    if (nodes.size >= MAX_VISITED_NODES) {
      truncated = true;
      break;
    }
    const current = queue.shift()!;
    const currentResource = await resolve(current.key);
    if (!currentResource) continue;

    if (current.key !== root.key) {
      nodes.set(current.key, { resource: currentResource, depth: current.depth });
    }

    const candidates: ImpactCandidate[] = [...(derivedReverseIndex.get(current.key) ?? [])];
    const persistedRelations = await resourceEdgeService
      .listEdgesForResource(orgContext, currentResource.type, currentResource.id)
      .catch(() => []);
    for (const relation of persistedRelations) {
      if (relation.metadata?.direction !== "target") continue; // only "other -> current" edges are downstream impact
      candidates.push({ otherKey: relation.targetKey, relationType: relation.type, source: "persisted" });
    }

    for (const candidate of candidates) {
      if (relationFilter && !relationFilter.has(candidate.relationType)) continue;
      if (candidate.otherKey === current.key) continue;
      const alreadyQueued = queued.has(candidate.otherKey);
      const nextDepth = current.depth + 1;
      if (!alreadyQueued && nextDepth > maxDepth) {
        truncated = true;
        continue;
      }

      const otherResource = await resolve(candidate.otherKey);
      if (!otherResource) continue;

      const edgeKey = `${candidate.otherKey}|${current.key}|${candidate.relationType}|${candidate.source}`;
      if (!edgeSeen.has(edgeKey)) {
        edgeSeen.add(edgeKey);
        edges.push({ fromKey: candidate.otherKey, toKey: current.key, relationType: candidate.relationType, source: candidate.source });
      }

      if (alreadyQueued) continue;
      queued.add(candidate.otherKey);
      queue.push({ key: candidate.otherKey, depth: nextDepth });
    }
  }

  return {
    root,
    maxDepth,
    nodes: Array.from(nodes.values()).sort((a, b) => a.depth - b.depth),
    edges,
    truncated,
  };
}
