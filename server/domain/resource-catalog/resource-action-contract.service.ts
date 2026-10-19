import type {
  PlatformResource,
  ResourceAction,
  ResourceActionContract,
  ResourceActionRisk,
  ResourceActionSideEffect,
} from "@shared/resource-catalog.js";

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const HIGH_RISK_ACTIONS = new Set(["delete", "disconnect", "deploy", "publish", "approve", "reject", "disable"]);
const DRY_RUN_FRIENDLY_ACTIONS = new Set(["run", "test", "validate", "audit"]);

function riskRank(risk: ResourceActionRisk): number {
  switch (risk) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
    default:
      return 1;
  }
}

function maxRisk(a: ResourceActionRisk, b: ResourceActionRisk): ResourceActionRisk {
  return riskRank(a) >= riskRank(b) ? a : b;
}

function inferSideEffects(resource: PlatformResource, action: ResourceAction): ResourceActionSideEffect[] {
  if (action.contract?.sideEffects?.length) return action.contract.sideEffects;
  if (action.method === "GET" || action.id === "view" || action.id === "activity" || action.id === "versions") return ["read"];

  const effects = new Set<ResourceActionSideEffect>();
  if (action.method && MUTATING_METHODS.has(action.method)) effects.add("write");
  if (action.id === "delete" || action.method === "DELETE") effects.add("delete");
  if (["run", "resume", "deploy", "publish", "test", "extract", "validate"].includes(action.id)) effects.add("external_api");
  if (["deploy", "publish"].includes(action.id)) effects.add("deployment");
  if (resource.type === "credential") effects.add("credential_use");
  if (resource.type === "approval_request" || action.id === "approve" || action.id === "reject") effects.add("human_approval");
  if (effects.size === 0) effects.add("none");
  return Array.from(effects);
}

function inferRisk(resource: PlatformResource, action: ResourceAction, sideEffects: ResourceActionSideEffect[]): ResourceActionRisk {
  const base = action.contract?.risk ?? resource.riskLevel;
  if (action.destructive || sideEffects.includes("delete")) return maxRisk(base, "critical");
  if (HIGH_RISK_ACTIONS.has(action.id)) return maxRisk(base, "high");
  if (sideEffects.some((effect) => effect !== "read" && effect !== "none")) return maxRisk(base, "medium");
  return base;
}

export function buildResourceActionContract(resource: PlatformResource, action: ResourceAction): ResourceActionContract {
  const sideEffects = inferSideEffects(resource, action);
  const risk = inferRisk(resource, action, sideEffects);
  const isMutating = sideEffects.some((effect) => effect !== "read" && effect !== "none");
  const requiresApproval =
    (action.contract?.policyRequirements?.some((policy) => policy.requiresApproval) ??
      false) ||
    action.destructive === true ||
    risk === "high" ||
    risk === "critical" ||
    resource.governance?.requiresApproval === true;

  return {
    inputs: action.contract?.inputs ?? (action.params ? { fields: action.params.fields } : undefined),
    outputs: action.contract?.outputs ?? { description: `${action.label} result` },
    sideEffects,
    risk,
    dryRun: action.contract?.dryRun ?? {
      supported: DRY_RUN_FRIENDLY_ACTIONS.has(action.id),
      description: DRY_RUN_FRIENDLY_ACTIONS.has(action.id)
        ? "Validate intent, inputs, policy, and impact without performing the action."
        : "No domain dry-run endpoint is currently registered for this action.",
    },
    rollback: action.contract?.rollback ?? {
      supported: action.id === "publish" || action.id === "deploy" || action.id === "run",
      automatic: false,
      description: "Rollback support depends on the target domain versioning/execution system.",
    },
    policyRequirements: action.contract?.policyRequirements ?? [
      {
        policyId: resource.governance?.policyId,
        requiresApproval,
        dataClassification: resource.governance?.dataClassification,
        reason: requiresApproval
          ? "Action risk, destructive flag, or resource governance requires approval."
          : "No explicit approval requirement detected.",
      },
    ],
    evalHooks: action.contract?.evalHooks ?? [
      {
        id: `${resource.type}.${action.id}.post`,
        label: `${action.label} post-check`,
        when: "post",
        metric: "success",
      },
    ],
    idempotency: action.contract?.idempotency ?? (isMutating ? "unknown" : "idempotent"),
    costProfile: action.contract?.costProfile ?? {
      unit: sideEffects.includes("external_api") || sideEffects.includes("cost") ? "unknown" : "free",
      meteredBy: sideEffects.includes("external_api") ? "target domain" : undefined,
    },
  };
}

export function enrichResourceActionContracts(resource: PlatformResource): PlatformResource {
  return {
    ...resource,
    actions: resource.actions.map((action) => ({
      ...action,
      contract: buildResourceActionContract(resource, action),
    })),
  };
}
