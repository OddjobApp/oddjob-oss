import { describe, expect, it } from "vitest";

import {
  filterCatalogResources,
  isAttentionWorthy,
  isResourceRelationType,
  makeResourceKey,
  RESOURCE_RELATION_TYPES,
  RESOURCE_TYPE_DEFINITIONS,
  RESOURCE_TYPES,
  summarizeCatalogResources,
  summarizeResourceHealth,
  type PlatformResource,
} from "../../shared/resource-catalog";
import {
  scoreResourceForIntent,
  selectActionForIntent,
} from "../../server/domain/resource-catalog/resource-intent.service";
import {
  buildResourceActionContract,
  enrichResourceActionContracts,
} from "../../server/domain/resource-catalog/resource-action-contract.service";

const resources: PlatformResource[] = [
  {
    key: "mission:1",
    type: "mission",
    id: "1",
    name: "Renewal Risk Sweep",
    description: "Find accounts at risk before renewal",
    status: "active",
    lifecycle: "active",
    riskLevel: "medium",
    organizationId: 7,
    tags: ["sales", "renewals"],
    capabilities: ["agentic_execution"],
    actions: [],
    relations: [],
  },
  {
    key: "dataset:3",
    type: "dataset",
    id: "3",
    name: "Renewal Accounts",
    status: "active",
    lifecycle: "active",
    riskLevel: "low",
    organizationId: 7,
    tags: ["crm"],
    capabilities: ["structured_records", "validation_rules"],
    actions: [],
    relations: [],
  },
  {
    key: "approval_request:9",
    type: "approval_request",
    id: "9",
    name: "Approval for execution exec-9",
    status: "pending",
    lifecycle: "waiting",
    riskLevel: "medium",
    organizationId: 7,
    tags: ["internal"],
    capabilities: ["human_approval"],
    actions: [],
    relations: [],
  },
];

describe("resource catalog contract", () => {
  it("builds stable resource keys", () => {
    expect(makeResourceKey("pipeline", 42)).toBe("pipeline:42");
  });

  it("validates relation types for the persisted edges API", () => {
    expect(isResourceRelationType("uses")).toBe(true);
    expect(isResourceRelationType("validated_by")).toBe(true);
    expect(isResourceRelationType("not_a_real_relation")).toBe(false);
  });

  it("keeps every ontology type backed by a definition with valid relation hints", () => {
    const relationTypes = new Set<string>(RESOURCE_RELATION_TYPES);

    expect(Object.keys(RESOURCE_TYPE_DEFINITIONS).sort()).toEqual([...RESOURCE_TYPES].sort());

    for (const type of RESOURCE_TYPES) {
      const definition = RESOURCE_TYPE_DEFINITIONS[type];
      expect(definition.type).toBe(type);
      expect(definition.defaultActions[0]).toBe("view");
      for (const relationHint of definition.relationHints) {
        expect(relationTypes.has(relationHint)).toBe(true);
      }
    }
  });

  it("filters resources by type, lifecycle, and search text", () => {
    const filtered = filterCatalogResources(resources, {
      types: ["mission", "dataset"],
      lifecycle: "active",
      search: "renewal",
    });

    expect(filtered.map((resource) => resource.key)).toEqual(["mission:1", "dataset:3"]);
  });

  it("does not treat perTypeLimit as a final result slice", () => {
    const filtered = filterCatalogResources(resources, {
      perTypeLimit: 1,
    });

    expect(filtered).toHaveLength(resources.length);
  });

  it("summarizes resources by ontology dimensions", () => {
    const summary = summarizeCatalogResources(resources);

    expect(summary.total).toBe(3);
    expect(summary.byType).toMatchObject({
      mission: 1,
      dataset: 1,
      approval_request: 1,
    });
    expect(summary.byLifecycle).toMatchObject({
      active: 2,
      waiting: 1,
    });
    expect(summary.byRisk).toMatchObject({
      low: 1,
      medium: 2,
    });
  });

  it("enriches read-only actions with a low-risk universal action contract", () => {
    const resource: PlatformResource = {
      ...resources[1],
      actions: [{ id: "view", label: "View dataset", method: "GET", href: "/api/datasets/3" }],
    };

    const enriched = enrichResourceActionContracts(resource);
    expect(enriched.actions[0].contract).toMatchObject({
      outputs: { description: "View dataset result" },
      sideEffects: ["read"],
      risk: "low",
      idempotency: "idempotent",
    });
    expect(enriched.actions[0].contract?.dryRun.supported).toBe(false);
  });

  it("marks destructive actions as critical and approval-gated", () => {
    const contract = buildResourceActionContract(resources[1], {
      id: "delete",
      label: "Delete dataset",
      method: "DELETE",
      href: "/api/datasets/3",
      destructive: true,
    });

    expect(contract.risk).toBe("critical");
    expect(contract.sideEffects).toContain("delete");
    expect(contract.policyRequirements.some((requirement) => requirement.requiresApproval)).toBe(true);
    expect(contract.rollback.supported).toBe(false);
  });

  it("adds eval hooks to executable actions so AgentOps can attach scorecards", () => {
    const contract = buildResourceActionContract(resources[0], {
      id: "run",
      label: "Run mission",
      method: "POST",
      href: "/api/missions/1/run",
    });

    expect(contract.evalHooks).toEqual(expect.arrayContaining([
      expect.objectContaining({ when: "post" }),
    ]));
  });
});

describe("intent-to-action routing (Phase 5)", () => {
  const mission = resources[0];
  const dataset = resources[1];

  it("scores a resource highly when its name is mentioned explicitly", () => {
    const named = scoreResourceForIntent(mission, "pause the Renewal Risk Sweep mission");
    const unrelated = scoreResourceForIntent(mission, "rotate the stripe credential");

    expect(named).toBeGreaterThanOrEqual(0.9);
    expect(unrelated).toBeLessThan(named);
  });

  it("scores via token overlap even without an exact name match", () => {
    const score = scoreResourceForIntent(dataset, "show renewal accounts data");
    expect(score).toBeGreaterThan(0);
  });

  it("selects the action whose id/label best overlaps the intent's verb", () => {
    const withActions: PlatformResource = {
      ...mission,
      actions: [
        { id: "view", label: "View mission" },
        { id: "run", label: "Run mission" },
        { id: "pause", label: "Pause mission" },
      ],
    };

    const match = selectActionForIntent(withActions, "pause the renewal sweep mission");
    expect(match?.action.id).toBe("pause");
    expect(match?.score).toBeGreaterThan(0);
  });

  it("uses common verb aliases when selecting actions", () => {
    const withActions: PlatformResource = {
      ...mission,
      actions: [
        { id: "view", label: "View mission" },
        { id: "run", label: "Run mission" },
      ],
    };

    const match = selectActionForIntent(withActions, "execute the renewal sweep mission");
    expect(match?.action.id).toBe("run");
    expect(match?.score).toBeGreaterThan(0);
  });

  it("falls back to the view action at score 0 when no verb matches", () => {
    const withActions: PlatformResource = {
      ...mission,
      actions: [
        { id: "view", label: "View mission" },
        { id: "run", label: "Run mission", destructive: false },
      ],
    };

    const match = selectActionForIntent(withActions, "tell me about xyz unrelated gibberish");
    expect(match?.action.id).toBe("view");
    expect(match?.score).toBe(0);
  });

  it("returns null when the resource has no actions at all", () => {
    expect(selectActionForIntent(mission, "pause it")).toBeNull();
  });
});

describe("resource type definitions stay in sync with real per-resource actions[]", () => {
  // Regression coverage for the "defaultActions describes product intent, not real actions[]"
  // gap: defaultActions must only ever name ids that the matching collector actually emits, never
  // a fabricated/aspirational action with no backing route (e.g. cycle "launch", job "run",
  // document_template "render", knowledge_document "index" were all dropped for this reason).
  const expectedDefaultActions: Record<(typeof RESOURCE_TYPES)[number], string[]> = {
    cycle: ["view", "resume", "pause"],
    cycle_blueprint: ["view"],
    mission: ["view", "run", "activity"],
    mission_run: ["view", "resume"],
    agent: ["view"],
    agent_deployment: ["view"],
    agent_session: ["view"],
    agent_run: ["view"],
    agent_state: ["view"],
    pipeline: ["view", "run", "versions"],
    pipeline_step: ["view", "edit"],
    job: ["view", "test"],
    tool: ["view"],
    tool_call: ["view"],
    capability: ["view"],
    connector_action: ["view"],
    mcp_server: ["view"],
    dataset: ["view", "export", "validate", "extract"],
    memory: ["view"],
    context_packet: ["view"],
    retrieval_result: ["view"],
    knowledge_topic: ["view"],
    knowledge_document: ["view"],
    knowledge_source: ["view"],
    claim: ["view"],
    fact: ["view"],
    contradiction: ["view"],
    document_template: ["view"],
    hil_form: ["view", "submit"],
    approval_request: ["view", "approve", "reject"],
    policy: ["view"],
    policy_pack: ["view"],
    risk_control: ["view"],
    approval_policy: ["view"],
    app: ["view", "deploy", "audit"],
    crew_room: ["view"],
    app_deployment: ["view", "publish"],
    app_release: ["view"],
    artifact: ["view"],
    report: ["view"],
    evidence_bundle: ["view"],
    trace: ["view"],
    trace_event: ["view"],
    eval_dataset: ["view"],
    eval_run: ["view"],
    eval_gate: ["view"],
    schedule: ["view", "enable", "disable"],
    credential: ["view", "test"],
    slack_workspace: ["view", "configure", "disconnect"],
    user: ["view"],
    team: ["view"],
    role: ["view"],
    stakeholder: ["view"],
    owner_group: ["view"],
    incident: ["view"],
    alert: ["view"],
    failure_pattern: ["view"],
    remediation: ["view"],
    runbook: ["view"],
  };

  it.each(RESOURCE_TYPES)("matches the verified action set for %s", (type) => {
    expect(RESOURCE_TYPE_DEFINITIONS[type].defaultActions).toEqual(expectedDefaultActions[type]);
  });

  it("never lists a 'view' action without it being the first default action", () => {
    for (const type of RESOURCE_TYPES) {
      expect(RESOURCE_TYPE_DEFINITIONS[type].defaultActions[0]).toBe("view");
    }
  });
});

describe("resource health dashboard (Phase 6)", () => {
  const healthResources: PlatformResource[] = [
    { ...resources[0], riskLevel: "low", health: { state: "healthy" } },
    { ...resources[1], riskLevel: "low", health: { state: "warning" } },
    { ...resources[2], riskLevel: "critical", health: { state: "healthy" } },
    { ...resources[0], key: "mission:2", id: "2", riskLevel: "high", health: { state: "error" } },
  ];

  it("flags a resource as needing attention via either an unhealthy state or high/critical risk", () => {
    expect(isAttentionWorthy(healthResources[0])).toBe(false); // healthy + low risk
    expect(isAttentionWorthy(healthResources[1])).toBe(true); // warning state, low risk
    expect(isAttentionWorthy(healthResources[2])).toBe(true); // healthy state, critical risk
    expect(isAttentionWorthy(healthResources[3])).toBe(true); // both
  });

  it("treats a missing health field as unknown rather than crashing", () => {
    const noHealth: PlatformResource = { ...resources[0], health: undefined };
    expect(isAttentionWorthy(noHealth)).toBe(false);
    expect(summarizeResourceHealth([noHealth]).byHealthState.unknown).toBe(1);
  });

  it("summarizes health state counts and the needs-attention total", () => {
    const summary = summarizeResourceHealth(healthResources);

    expect(summary.byHealthState).toMatchObject({ healthy: 2, warning: 1, error: 1 });
    expect(summary.needsAttentionCount).toBe(3);
  });
});
