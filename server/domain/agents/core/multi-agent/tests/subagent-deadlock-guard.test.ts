/**
 * Unit Tests for Sub-Agent Delegation Deadlock & Cycle Guard (Level 5)
 */

import { describe, expect, it, beforeEach } from "vitest";
import { MultiAgentOrchestrator } from "../orchestrator.service.js";

describe("Sub-Agent Delegation Deadlock & Cycle Guard (Level 5)", () => {
  let orchestrator: MultiAgentOrchestrator;

  beforeEach(() => {
    orchestrator = new MultiAgentOrchestrator();
  });

  it("detects self-delegation cycle (A -> A)", () => {
    const cycle = orchestrator.detectDelegationCycle("agent-alpha", "agent-alpha");
    expect(cycle.hasCycle).toBe(true);
    expect(cycle.cyclePath).toEqual(["agent-alpha", "agent-alpha"]);
  });

  it("detects direct circular delegation (A -> B -> A)", () => {
    // Register A -> B
    (orchestrator as any).delegationEdges.set("agent-alpha", new Set(["agent-beta"]));

    // Check if B -> A creates a cycle
    const cycle = orchestrator.detectDelegationCycle("agent-beta", "agent-alpha");
    expect(cycle.hasCycle).toBe(true);
    expect(cycle.cyclePath).toEqual(["agent-beta", "agent-alpha", "agent-beta"]);
  });

  it("detects indirect multi-hop circular delegation (A -> B -> C -> A)", () => {
    // Register A -> B and B -> C
    (orchestrator as any).delegationEdges.set("agent-alpha", new Set(["agent-beta"]));
    (orchestrator as any).delegationEdges.set("agent-beta", new Set(["agent-gamma"]));

    // Check if C -> A creates a cycle
    const cycle = orchestrator.detectDelegationCycle("agent-gamma", "agent-alpha");
    expect(cycle.hasCycle).toBe(true);
    expect(cycle.cyclePath).toEqual(["agent-gamma", "agent-alpha", "agent-beta", "agent-gamma"]);
  });

  it("allows non-circular acyclic delegations (A -> B -> C and D -> C)", () => {
    (orchestrator as any).delegationEdges.set("agent-alpha", new Set(["agent-beta"]));
    (orchestrator as any).delegationEdges.set("agent-beta", new Set(["agent-gamma"]));

    // D delegating to C should not create a cycle
    const cycle = orchestrator.detectDelegationCycle("agent-delta", "agent-gamma");
    expect(cycle.hasCycle).toBe(false);
  });

  it("finds a healthy fallback specialist excluding cycle participants", () => {
    const mockContext: any = {
      mesh: {
        nodes: [
          { id: "agent-alpha", health: "healthy" },
          { id: "agent-beta", health: "healthy" },
          { id: "agent-specialist", health: "healthy" },
        ],
      },
      team: {
        leadAgentId: "agent-alpha",
      },
    };

    const fallback = orchestrator.findFallbackSpecialist(mockContext, ["agent-alpha", "agent-beta"]);
    expect(fallback).toBe("agent-specialist");
  });
});
