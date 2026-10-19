import type { OrgContext } from "@server/utils/auth-context.js";
import {
  type PlatformResource,
  type ResourceActionPolicyRequirement,
  type ResourceStudioResponse,
} from "@shared/resource-catalog.js";

import { enrichResourceActionContracts } from "./resource-action-contract.service.js";
import { analyzeResourceImpact } from "./resource-impact.service.js";
import { getResourceGraph } from "./resource-graph.service.js";

function uniqueResources(resources: PlatformResource[]): PlatformResource[] {
  const seen = new Set<string>();
  const result: PlatformResource[] = [];
  for (const resource of resources) {
    if (seen.has(resource.key)) continue;
    seen.add(resource.key);
    result.push(enrichResourceActionContracts(resource));
  }
  return result;
}

function collectPolicies(resources: PlatformResource[]): ResourceActionPolicyRequirement[] {
  const policies = new Map<string, ResourceActionPolicyRequirement>();
  for (const resource of resources) {
    for (const action of resource.actions) {
      for (const requirement of action.contract?.policyRequirements ?? []) {
        const key = [
          requirement.policyId ?? "",
          requirement.policyPackId ?? "",
          requirement.requiredRole ?? "",
          requirement.dataClassification ?? "",
          String(requirement.requiresApproval ?? false),
        ].join("|");
        policies.set(key, requirement);
      }
    }
  }
  return Array.from(policies.values());
}

export async function getResourceStudio(
  orgContext: OrgContext,
  key: string,
  options: { maxDepth?: number } = {},
): Promise<ResourceStudioResponse> {
  const graph = await getResourceGraph(orgContext, key, { maxDepth: options.maxDepth ?? 2 });
  const enrichedNodes = graph.nodes.map((node) => ({ ...node, resource: enrichResourceActionContracts(node.resource) }));
  const resources = uniqueResources(enrichedNodes.map((node) => node.resource));
  const impact = await analyzeResourceImpact(orgContext, key, { maxDepth: 2 }).catch(() => null);

  return {
    root: enrichResourceActionContracts(graph.root),
    graph: {
      ...graph,
      root: enrichResourceActionContracts(graph.root),
      nodes: enrichedNodes,
    },
    impact: {
      downstreamCount: impact?.nodes.length ?? 0,
      truncated: impact?.truncated ?? false,
    },
    bindings: {
      forms: resources.filter((resource) => resource.type === "hil_form" || resource.type === "approval_request"),
      schemas: resources.filter((resource) => resource.schema || resource.type === "dataset" || resource.type === "pipeline_step"),
      policies: collectPolicies(resources),
      pipelines: resources.filter((resource) => resource.type === "pipeline" || resource.type === "pipeline_step"),
      jobs: resources.filter((resource) => resource.type === "job"),
    },
    generatedAt: new Date().toISOString(),
  };
}
