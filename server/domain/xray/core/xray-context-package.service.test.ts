import { describe, expect, it } from "vitest";
import type { CompositionGraph } from "../types/composition.js";
import { xrayContextPackageService } from "./xray-context-package.service.js";
import { xrayOperationalGuideService } from "./xray-operational-guide.service.js";

const graph: CompositionGraph = {
  scope: { id: "agent-training", name: "Agent Performance & Training", type: "forged_app" },
  indexedAt: "2026-07-29T17:45:49.738Z",
  nodes: [
    {
      id: "screen::/agent-training",
      type: "screen",
      label: "Agent Performance & Training",
      description: "Evaluate agents and promote validated improvements.",
    },
    {
      id: "api_endpoint::GET-/api/agent-deployments",
      type: "api_endpoint",
      label: "GET /api/agent-deployments",
      filePath: "server/routes/agent-deployments.ts",
    },
    {
      id: "agent::deployment-controller",
      type: "agent",
      label: "Deployment Controller",
      metadata: { ownerRole: "release-manager" },
    },
    {
      id: "pipeline::unrelated",
      type: "pipeline",
      label: "Unrelated Research Pipeline",
    },
  ],
  edges: [
    {
      id: "screen-deployments",
      source: "screen::/agent-training",
      target: "api_endpoint::GET-/api/agent-deployments",
      relation: "CALLS_API",
      label: "calls deployments",
    },
    {
      id: "deployments-controller",
      source: "api_endpoint::GET-/api/agent-deployments",
      target: "agent::deployment-controller",
      relation: "TRIGGERS",
      label: "invokes deployment controller",
    },
  ],
};

const guide = xrayOperationalGuideService.buildGuide(graph);

describe("XrayContextPackageService", () => {
  it("retrieves a bounded task-relevant subgraph", () => {
    const context = xrayContextPackageService.buildContext(graph, guide, {
      task: "change agent deployment approval",
      maxGraphHops: 1,
    });

    expect(context.nodes.map(node => node.id)).toContain("api_endpoint::GET-/api/agent-deployments");
    expect(context.nodes.map(node => node.id)).toContain("agent::deployment-controller");
    expect(context.nodes.map(node => node.id)).not.toContain("pipeline::unrelated");
    expect(context.selection.maxGraphHops).toBe(1);
    expect(context.guardrails.map(rule => rule.id)).toContain("deployment-requires-evaluation");
    expect(context.suggestedPrompts.map(prompt => prompt.id)).toContain("prompt-request-approval");
  });

  it("honors explicit seed nodes and caps graph traversal at two hops", () => {
    const context = xrayContextPackageService.buildContext(graph, guide, {
      task: "inspect deployment",
      nodeIds: ["screen::/agent-training"],
      maxGraphHops: 99,
    });

    expect(context.selection.seedNodeIds).toContain("screen::/agent-training");
    expect(context.selection.maxGraphHops).toBe(2);
    expect(context.nodes.map(node => node.id)).toContain("agent::deployment-controller");
  });

  it("returns an explicit unknown when no nodes match", () => {
    const context = xrayContextPackageService.buildContext(graph, guide, {
      task: "quantum banana ledger",
    });

    expect(context.nodes).toHaveLength(0);
    expect(context.unknowns[0]).toContain("No X-Ray nodes matched");
    expect(context.questions[0]).toEqual(expect.objectContaining({
      id: "clarify-target-component",
      source: "unresolved_node",
    }));
  });

  it("evaluates a known event without delivering a notification", () => {
    const result = xrayContextPackageService.evaluateEvent(graph, guide, {
      eventType: "benchmark_regressed",
      subjectNodeId: "agent::deployment-controller",
      evidence: { baseline: 0.94, candidate: 0.81 },
    });

    expect(result.notification?.id).toBe("notify-benchmark-regression");
    expect(result.disposition).toEqual(expect.objectContaining({
      mode: "advisory",
      action: "notify",
      requiresHumanReview: true,
    }));
    expect(result.disposition.rationale).toContain("delivery remains advisory");
  });

  it("rejects unknown events and subject nodes", () => {
    expect(() => xrayContextPackageService.evaluateEvent(graph, guide, {
      eventType: "not_registered",
    })).toThrow("Unknown operational event");

    expect(() => xrayContextPackageService.evaluateEvent(graph, guide, {
      eventType: "architecture_changed",
      subjectNodeId: "agent::missing",
    })).toThrow("Unknown subject node");
  });
});
