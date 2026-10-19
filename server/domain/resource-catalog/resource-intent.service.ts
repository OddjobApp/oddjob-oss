import { computeJaccardSimilarity } from "@domain/agents/core/kb-extensions/keyword-similarity.js";
import type { OrgContext } from "@server/utils/auth-context.js";
import { BadRequestError } from "@server/utils/errors.js";
import {
  isResourceType,
  RESOURCE_TYPE_DEFINITIONS,
  type PlatformResource,
  type ResourceAction,
  type ResourceRiskLevel,
  type ResourceType,
} from "@shared/resource-catalog.js";

import { analyzeResourceImpact } from "./resource-impact.service.js";
import { resourceCatalogService } from "./resource-catalog.service.js";

const DEFAULT_MATCH_LIMIT = 5;
const MAX_MATCH_LIMIT = 20;
const MIN_RESOURCE_SCORE = 0.05;
const BLAST_RADIUS_DEPTH = 2;
const INTENT_PER_TYPE_LIMIT = 500;
const HIGH_RISK_LEVELS: ResourceRiskLevel[] = ["high", "critical"];
const ACTION_ALIASES: Record<string, string[]> = {
  activity: ["activity", "events", "history", "timeline", "audit"],
  approve: ["approve", "allow", "accept", "authorize"],
  audit: ["audit", "qa", "review", "inspect"],
  disable: ["disable", "turn off", "deactivate", "stop"],
  enable: ["enable", "turn on", "activate", "start"],
  extract: ["extract", "index", "ingest", "parse"],
  index: ["index", "embed", "vectorize", "reindex"],
  launch: ["launch", "start", "kick off", "begin"],
  pause: ["pause", "hold", "suspend", "stop"],
  publish: ["publish", "go live", "release"],
  reject: ["reject", "deny", "decline"],
  render: ["render", "generate", "create"],
  resume: ["resume", "continue", "restart"],
  run: ["run", "execute", "start", "launch", "trigger"],
  test: ["test", "check", "validate", "verify"],
  validate: ["validate", "verify", "check"],
  versions: ["versions", "version", "history", "revisions"],
  view: ["view", "show", "open", "inspect", "details", "read"],
};

function resourceHaystack(resource: PlatformResource): string {
  return [
    resource.name,
    resource.description ?? "",
    RESOURCE_TYPE_DEFINITIONS[resource.type].label,
    ...resource.tags,
    ...resource.capabilities,
  ].join(" ");
}

/**
 * Token-overlap relevance of a resource against a free-text intent, boosted to a strong score
 * when the resource's own name is literally mentioned in the query (the common case: "pause the
 * Renewal Risk Sweep mission"). Deterministic and dependency-free by design - no embeddings API
 * call per routed intent, so this stays cheap, quota-free, and unit-testable without DB/network.
 */
export function scoreResourceForIntent(resource: PlatformResource, query: string): number {
  const jaccard = computeJaccardSimilarity(resourceHaystack(resource), query);
  const name = resource.name.trim().toLowerCase();
  const isNamedExplicitly = name.length > 0 && query.toLowerCase().includes(name);
  return isNamedExplicitly ? Math.max(jaccard, 0.9) : jaccard;
}

function actionHaystack(action: ResourceAction): string {
  const aliases = ACTION_ALIASES[action.id] ?? [];
  return `${action.id.replace(/_/g, " ")} ${action.label} ${aliases.join(" ")}`;
}

export interface ActionMatch {
  action: ResourceAction;
  score: number;
}

/**
 * Picks the resource action whose id/label best overlaps the intent's verb (e.g. "rotate" ->
 * the credential's "rotate" action). Falls back to the resource's "view" action (or its first
 * action) at score 0 when no verb matches, so an ambiguous intent never defaults to a mutating
 * action just because it's first in the list.
 */
export function selectActionForIntent(resource: PlatformResource, query: string): ActionMatch | null {
  if (resource.actions.length === 0) return null;

  let best = resource.actions[0];
  let bestScore = computeJaccardSimilarity(actionHaystack(best), query);
  for (const action of resource.actions.slice(1)) {
    const score = computeJaccardSimilarity(actionHaystack(action), query);
    if (score > bestScore) {
      best = action;
      bestScore = score;
    }
  }

  if (bestScore === 0) {
    const viewAction = resource.actions.find((candidate) => candidate.id === "view") ?? resource.actions[0];
    return { action: viewAction, score: 0 };
  }
  return { action: best, score: bestScore };
}

export interface ResourceActionMatch {
  resource: PlatformResource;
  action: ResourceAction;
  resourceScore: number;
  actionScore: number;
  /** Set only for destructive/high-risk matches: the Phase 4 downstream impact, so a caller can warn before acting. */
  blastRadius?: { impactedCount: number; truncated: boolean };
}

export interface RouteIntentOptions {
  types?: ResourceType[];
  limit?: number;
}

export interface RouteIntentResult {
  query: string;
  matches: ResourceActionMatch[];
}

/**
 * Resolves a free-text intent ("pause the renewal sweep mission") to ranked
 * (resource, action) pairs. Only ever searches resources the caller's org context can already
 * see (resourceCatalogService.listResources is org-scoped), so intent routing can't surface a
 * resource a generic catalog browse wouldn't. Matches flagged destructive or high/critical risk
 * carry a Phase 4 blast-radius hint so a caller can gate confirmation on it before invoking the action.
 */
export async function routeResourceIntent(
  orgContext: OrgContext,
  query: string,
  options: RouteIntentOptions = {},
): Promise<RouteIntentResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new BadRequestError("Intent query must not be empty");
  }
  if (options.types?.some((type) => !isResourceType(type))) {
    throw new BadRequestError("Unsupported resource type in types filter", { types: options.types });
  }
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? DEFAULT_MATCH_LIMIT), 1), MAX_MATCH_LIMIT);

  // No `limit` passed to listResources: a global limit here would re-trigger known issue #5
  // (filterCatalogResources slices the merged, not per-type, list). The default per-type cap
  // is used instead, same workaround as resource-impact.service.ts's catalog scan.
  const catalog = await resourceCatalogService.listResources(
    orgContext,
    options.types?.length
      ? { types: options.types, perTypeLimit: INTENT_PER_TYPE_LIMIT }
      : { perTypeLimit: INTENT_PER_TYPE_LIMIT },
  );

  const ranked = catalog.resources
    .map((resource) => ({ resource, score: scoreResourceForIntent(resource, trimmed) }))
    .filter((entry) => entry.score >= MIN_RESOURCE_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const matches: ResourceActionMatch[] = [];
  for (const entry of ranked) {
    const actionMatch = selectActionForIntent(entry.resource, trimmed);
    if (!actionMatch) continue;

    const match: ResourceActionMatch = {
      resource: entry.resource,
      action: actionMatch.action,
      resourceScore: entry.score,
      actionScore: actionMatch.score,
    };

    const isLargeBlastRadiusCandidate =
      Boolean(actionMatch.action.destructive) || HIGH_RISK_LEVELS.includes(entry.resource.riskLevel);
    if (isLargeBlastRadiusCandidate) {
      const impact = await analyzeResourceImpact(orgContext, entry.resource.key, { maxDepth: BLAST_RADIUS_DEPTH }).catch(
        () => null,
      );
      if (impact) {
        match.blastRadius = { impactedCount: impact.nodes.length, truncated: impact.truncated };
      }
    }

    matches.push(match);
  }

  return { query: trimmed, matches };
}
