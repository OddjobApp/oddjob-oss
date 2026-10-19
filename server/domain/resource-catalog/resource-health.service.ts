import type { OrgContext } from "@server/utils/auth-context.js";
import { BadRequestError } from "@server/utils/errors.js";
import {
  isAttentionWorthy,
  isResourceType,
  summarizeResourceHealth,
  type PlatformResource,
  type ResourceCatalogSummary,
  type ResourceHealthState,
  type ResourceHealthSummary,
  type ResourceRiskLevel,
  type ResourceType,
} from "@shared/resource-catalog.js";

import { resourceCatalogService } from "./resource-catalog.service.js";

const DEFAULT_ATTENTION_LIMIT = 50;
const MAX_ATTENTION_LIMIT = 200;
const DASHBOARD_PER_TYPE_LIMIT = 500;

const HEALTH_SEVERITY_ORDER: Record<ResourceHealthState, number> = {
  error: 0,
  warning: 1,
  unknown: 2,
  healthy: 3,
};

const RISK_SEVERITY_ORDER: Record<ResourceRiskLevel, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export interface ResourceHealthDashboardOptions {
  types?: ResourceType[];
  limit?: number;
}

export interface ResourceHealthDashboard {
  summary: ResourceCatalogSummary;
  byHealthState: ResourceHealthSummary["byHealthState"];
  needsAttentionCount: number;
  /** Worst-first slice of the needs-attention set, capped at `limit`. */
  needsAttention: PlatformResource[];
  possiblyTruncatedTypes: ResourceType[];
  generatedAt: string;
}

function attentionSeverity(resource: PlatformResource): [number, number] {
  return [HEALTH_SEVERITY_ORDER[resource.health?.state ?? "unknown"], RISK_SEVERITY_ORDER[resource.riskLevel]];
}

/**
 * Aggregates the org-scoped catalog into the counts a health dashboard needs: totals by
 * type/lifecycle/risk (reused from listResources' own summary, not recomputed), a health-state
 * breakdown, and a worst-first, capped list of resources that need a human look. Built on top of
 * resourceCatalogService.listResources, so it's automatically org-scoped and never surfaces a
 * resource the caller couldn't otherwise see.
 */
export async function getResourceHealthDashboard(
  orgContext: OrgContext,
  options: ResourceHealthDashboardOptions = {},
): Promise<ResourceHealthDashboard> {
  if (options.types?.some((type) => !isResourceType(type))) {
    throw new BadRequestError("Unsupported resource type in types filter", { types: options.types });
  }
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? DEFAULT_ATTENTION_LIMIT), 1), MAX_ATTENTION_LIMIT);

  const catalog = await resourceCatalogService.listResources(
    orgContext,
    options.types?.length
      ? { types: options.types, perTypeLimit: DASHBOARD_PER_TYPE_LIMIT }
      : { perTypeLimit: DASHBOARD_PER_TYPE_LIMIT },
  );

  const { byHealthState, needsAttentionCount } = summarizeResourceHealth(catalog.resources);

  const needsAttention = catalog.resources
    .filter(isAttentionWorthy)
    .sort((a, b) => {
      const [aHealth, aRisk] = attentionSeverity(a);
      const [bHealth, bRisk] = attentionSeverity(b);
      return aHealth - bHealth || aRisk - bRisk;
    })
    .slice(0, limit);

  return {
    summary: catalog.summary,
    byHealthState,
    needsAttentionCount,
    needsAttention,
    possiblyTruncatedTypes: Object.entries(catalog.summary.byType)
      .filter(([, count]) => (count ?? 0) >= DASHBOARD_PER_TYPE_LIMIT)
      .map(([type]) => type as ResourceType),
    generatedAt: catalog.generatedAt,
  };
}
