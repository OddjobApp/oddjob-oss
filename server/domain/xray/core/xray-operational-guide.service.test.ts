import { describe, expect, it } from "vitest";
import type { CompositionGraph, CompositionNode } from "../types/composition.js";
import { xrayOperationalGuideService } from "./xray-operational-guide.service.js";

function graph(nodes: CompositionNode[], edges: CompositionGraph["edges"] = []): CompositionGraph {
  return {
    scope: { id: "agent-training", name: "Agent Performance & Training", type: "forged_app" },
    nodes,
    edges,
    indexedAt: "2026-07-29T17:45:49.738Z",
  };
}

describe("XrayOperationalGuideService", () => {
  it("generates a versioned advisory guide with Copilot and supervisor contracts", () => {
    const guide = xrayOperationalGuideService.buildGuide(graph([
      { id: "screen::/agent-training", type: "screen", label: "Agent Training" },
    ]));

    expect(guide.schemaVersion).toBe("1.0.0");
    expect(guide.readiness.mode).toBe("advisory");
    expect(guide.copilot.contextPolicy.maxGraphHops).toBe(2);
    expect(guide.copilot.requiresApproval).toContain("production deployment");
    expect(guide.supervisor.actions).toContain("grant a time-bound exception");
    expect(guide.resources.map(resource => resource.id)).toEqual(["form_agent", "instant_app"]);
    expect(guide.questionEngine.structuredInputResource).toBe("form_agent");
    expect(guide.userPrompts.map(prompt => prompt.id)).toContain("prompt-request-approval");
    expect(guide.businessDefinition.purpose).toContain("Agent Performance & Training");
    expect(guide.businessDefinition.operatingBoundaries).toContain(
      "X-Ray describes and guides operations; it does not grant authority by itself",
    );
    expect(guide.cycles[0].stages.map(stage => stage.id)).toEqual([
      "observe",
      "diagnose",
      "improve",
      "validate",
      "approve",
      "deploy",
      "verify",
    ]);
  });

  it("detects ownership, orphan, and missing coverage gaps", () => {
    const guide = xrayOperationalGuideService.buildGuide(graph([
      { id: "screen::/agent-training", type: "screen", label: "Agent Training" },
      { id: "agent::7", type: "agent", label: "QA Planner" },
    ]));

    expect(guide.gaps.map(gap => gap.id)).toEqual(expect.arrayContaining([
      "production-ownership-missing",
      "production-nodes-orphaned",
      "coverage-missing-dataset",
      "coverage-missing-npm_module",
      "coverage-missing-ui_component",
      "coverage-missing-ui_behavior",
      "coverage-missing-e2e_test",
      "relationship-density-low",
    ]));
    expect(guide.readiness.score).toBeLessThan(100);
  });

  it("recognizes configured ownership and connected nodes", () => {
    const guide = xrayOperationalGuideService.buildGuide(graph([
      {
        id: "mission::12",
        type: "mission",
        label: "Learning Loop",
        metadata: { ownerRole: "training-cycle-owner" },
      },
      {
        id: "pipeline::14",
        type: "pipeline",
        label: "Learning Pipeline",
        metadata: { operationalOwner: "agent-platform" },
      },
    ], [{
      id: "mission::12->pipeline::14:TRIGGERS",
      source: "mission::12",
      target: "pipeline::14",
      relation: "TRIGGERS",
      label: "triggers",
    }]));

    expect(guide.gaps.find(gap => gap.id === "production-ownership-missing")).toBeUndefined();
    expect(guide.gaps.find(gap => gap.id === "production-nodes-orphaned")).toBeUndefined();
  });

  it("defines high-signal events and advisory guardrails", () => {
    const guide = xrayOperationalGuideService.buildGuide(graph([]));

    expect(guide.events.map(event => event.id)).toContain("benchmark_regressed");
    expect(guide.notifications.map(rule => rule.event)).toContain("guardrail_violated");
    expect(guide.guardrails.every(rule => rule.enforcement === "advisory")).toBe(true);
    expect(guide.guardrails.map(rule => rule.id)).toContain("deployment-requires-evaluation");
  });

  it("renders the operational guide into the generated specification", () => {
    const guide = xrayOperationalGuideService.buildGuide(graph([
      { id: "agent::7", type: "agent", label: "QA Planner" },
    ]));
    const markdown = xrayOperationalGuideService.toMarkdown(guide);

    expect(markdown).toContain("## 5. Operational Intelligence Guide");
    expect(markdown).toContain("### 5.2 Advisory Guardrails");
    expect(markdown).toContain("deployment-requires-evaluation");
    expect(markdown).toContain("### Form Agents");
    expect(markdown).toContain("### Instant Apps");
    expect(markdown).toContain("### 5.8 User Guidance and Question Engine");
    expect(markdown).toContain("### 5.9 Supervisor Contract");
  });

  it("renders a separate business definition with provenance", () => {
    const guide = xrayOperationalGuideService.buildGuide(graph([
      {
        id: "screen::/agent-training",
        type: "screen",
        label: "Agent Training",
        description: "Evaluate agents and promote validated improvements.",
        filePath: "server/domain/apps/agent-training",
      },
    ]));
    const markdown = xrayOperationalGuideService.businessDefinitionToMarkdown(guide);

    expect(markdown).toContain("## 0. Business Definition");
    expect(markdown).toContain("### Purpose");
    expect(markdown).toContain("Evaluate agents and promote validated improvements.");
    expect(markdown).toContain("### Business Goals");
    expect(markdown).toContain("deliver-application-objective");
    expect(markdown).toContain("Completion signal");
    expect(markdown).toContain("### Operating Boundaries");
    expect(markdown).toContain("Definition provenance");
    expect(markdown).toContain("configured");
  });
});
