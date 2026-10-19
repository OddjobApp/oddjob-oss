/**
 * Execution Flow Service Tests
 * 
 * Tests for execution flow capture and visualization.
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ExecutionFlowService } from "./execution-flow.service.js";

describe("ExecutionFlowService", () => {
  let service: ExecutionFlowService;

  beforeEach(() => {
    service = new ExecutionFlowService();
  });

  describe("startFlow", () => {
    it("should create a new flow with start node", () => {
      const flow = service.startFlow("session-1", "agent-1", 1);

      expect(flow.id).toBeDefined();
      expect(flow.sessionId).toBe("session-1");
      expect(flow.agentId).toBe("agent-1");
      expect(flow.status).toBe("running");
      expect(flow.nodes).toHaveLength(1);
      expect(flow.nodes[0].type).toBe("start");
    });

    it("should store flow in active flows", () => {
      const flow = service.startFlow("session-2", "agent-1", 1);

      const retrieved = service.getFlow("session-2");
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(flow.id);
    });

    it("should initialize stats correctly", () => {
      const flow = service.startFlow("session-3", "agent-1", 1);

      expect(flow.stats.totalSteps).toBe(1); // start node counts as a step
      expect(flow.stats.reflections).toBe(0);
      expect(flow.stats.corrections).toBe(0);
      expect(flow.stats.toolCalls).toBe(0);
    });
  });

  describe("addNode", () => {
    it("should add node to flow", () => {
      const flow = service.startFlow("session-4", "agent-1", 1);
      
      const node = service.addNode(flow, {
        type: "step",
        label: "Test step",
        status: "completed",
        metadata: {},
      });

      expect(flow.nodes).toHaveLength(2);
      expect(node.type).toBe("step");
      expect(node.label).toBe("Test step");
      expect(node.id).toBeDefined();
      expect(node.timestamp).toBeDefined();
    });

    it("should create edge from previous node", () => {
      const flow = service.startFlow("session-5", "agent-1", 1);
      
      service.addNode(flow, {
        type: "step",
        label: "Step 1",
        status: "completed",
        metadata: {},
      });

      expect(flow.edges).toHaveLength(1);
      expect(flow.edges[0].source).toBe(flow.nodes[0].id);
      expect(flow.edges[0].target).toBe(flow.nodes[1].id);
    });

    it("should assign position to node", () => {
      const flow = service.startFlow("session-6", "agent-1", 1, { layout: "vertical" });
      
      const node = service.addNode(flow, {
        type: "step",
        label: "Test",
        status: "completed",
        metadata: {},
      });

      expect(node.position).toBeDefined();
      expect(node.position?.x).toBeDefined();
      expect(node.position?.y).toBeDefined();
    });
  });

  describe("recordStep", () => {
    it("should record a step execution", () => {
      service.startFlow("session-7", "agent-1", 1);
      
      const node = service.recordStep("session-7", {
        label: "Analyze data",
        description: "Processing...",
        strategy: "chain_of_thought",
      });

      expect(node).toBeDefined();
      expect(node?.type).toBe("step");
      expect(node?.label).toBe("Analyze data");
      expect(node?.metadata.strategy).toBe("chain_of_thought");
    });

    it("should return undefined if flow not found", () => {
      const node = service.recordStep("nonexistent", {
        label: "Test",
      });

      expect(node).toBeUndefined();
    });

    it("should update total steps stat", () => {
      const flow = service.startFlow("session-8", "agent-1", 1);
      
      service.recordStep("session-8", { label: "Step 1" });
      service.recordStep("session-8", { label: "Step 2" });

      expect(flow.stats.totalSteps).toBe(3); // 1 start + 2 explicit steps
    });
  });

  describe("recordReflection", () => {
    it("should record reflection with issues", () => {
      service.startFlow("session-9", "agent-1", 1);
      
      const node = service.recordReflection("session-9", {
        issuesFound: 3,
        confidence: 0.75,
        passed: false,
      });

      expect(node?.type).toBe("reflection");
      expect(node?.label).toContain("3 issues");
      expect(node?.status).toBe("failed");
      expect(node?.metadata.issues).toBe(3);
    });

    it("should record successful reflection", () => {
      service.startFlow("session-10", "agent-1", 1);
      
      const node = service.recordReflection("session-10", {
        issuesFound: 0,
        confidence: 0.95,
        passed: true,
      });

      expect(node?.status).toBe("completed");
      expect(node?.style?.color).toBe("#22c55e");
    });

    it("should increment reflections stat", () => {
      const flow = service.startFlow("session-11", "agent-1", 1);
      
      service.recordReflection("session-11", { issuesFound: 0, confidence: 1, passed: true });

      expect(flow.stats.reflections).toBe(1);
    });
  });

  describe("recordToolCall", () => {
    it("should record successful tool call", () => {
      service.startFlow("session-12", "agent-1", 1);
      
      const node = service.recordToolCall("session-12", {
        toolName: "data_query",
        success: true,
        durationMs: 1500,
      });

      expect(node?.type).toBe("tool_call");
      expect(node?.label).toBe("data_query");
      expect(node?.status).toBe("completed");
      expect(node?.durationMs).toBe(1500);
      expect(node?.metadata.toolName).toBe("data_query");
    });

    it("should record failed tool call", () => {
      service.startFlow("session-13", "agent-1", 1);
      
      const node = service.recordToolCall("session-13", {
        toolName: "api_call",
        success: false,
        durationMs: 500,
      });

      expect(node?.status).toBe("failed");
    });

    it("should increment tool calls stat", () => {
      const flow = service.startFlow("session-14", "agent-1", 1);
      
      service.recordToolCall("session-14", { toolName: "tool1", success: true, durationMs: 100 });
      service.recordToolCall("session-14", { toolName: "tool2", success: true, durationMs: 200 });

      expect(flow.stats.toolCalls).toBe(2);
    });
  });

  describe("recordError", () => {
    it("should record recoverable error", () => {
      service.startFlow("session-15", "agent-1", 1);
      
      const node = service.recordError("session-15", {
        message: "Timeout",
        recoverable: true,
      });

      expect(node?.type).toBe("error");
      expect(node?.status).toBe("completed");
      expect(node?.style?.color).toBe("#ef4444");
    });

    it("should record fatal error", () => {
      service.startFlow("session-16", "agent-1", 1);
      
      const node = service.recordError("session-16", {
        message: "Connection lost",
        recoverable: false,
      });

      expect(node?.status).toBe("failed");
    });

    it("should increment errors stat", () => {
      const flow = service.startFlow("session-17", "agent-1", 1);
      
      service.recordError("session-17", { message: "Error", recoverable: true });

      expect(flow.stats.errors).toBe(1);
    });
  });

  describe("completeFlow", () => {
    it("should complete successfully", () => {
      const flow = service.startFlow("session-18", "agent-1", 1);
      service.recordStep("session-18", { label: "Step" });

      const completed = service.completeFlow("session-18", { success: true });

      expect(completed?.status).toBe("completed");
      expect(completed?.completedAt).toBeDefined();
      expect(completed?.nodes[completed.nodes.length - 1].type).toBe("end");
    });

    it("should complete with failure", () => {
      const flow = service.startFlow("session-19", "agent-1", 1);
      
      const completed = service.completeFlow("session-19", { success: false });

      expect(completed?.status).toBe("failed");
    });

    it("should calculate total duration", () => {
      const flow = service.startFlow("session-20", "agent-1", 1);
      
      service.completeFlow("session-20", { success: true });

      expect(flow.stats.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it("should move flow to history", () => {
      service.startFlow("session-21", "agent-1", 1);
      service.completeFlow("session-21", { success: true });

      expect(service.getFlow("session-21")).toBeUndefined();
      
      const history = service.getFlowHistory("agent-1");
      expect(history).toHaveLength(1);
    });
  });

  describe("exportFlow", () => {
    it("should export as JSON", () => {
      const flow = service.startFlow("session-22", "agent-1", 1);
      service.recordStep("session-22", { label: "Test" });
      service.completeFlow("session-22", { success: true });

      const exported = service.exportFlow(flow.id, "json");

      expect(exported).toBeDefined();
      expect(typeof exported).toBe("object");
      expect((exported as any).id).toBe(flow.id);
      expect((exported as any).nodes).toHaveLength(3);
    });

    it("should export as Mermaid", () => {
      const flow = service.startFlow("session-23", "agent-1", 1);
      service.recordStep("session-23", { label: "Test" });
      service.completeFlow("session-23", { success: true });

      const exported = service.exportFlow(flow.id, "mermaid");

      expect(exported).toBeDefined();
      expect(typeof exported).toBe("string");
      expect((exported as string)).toContain("flowchart TD");
    });

    it("should export as DOT", () => {
      const flow = service.startFlow("session-24", "agent-1", 1);
      service.recordStep("session-24", { label: "Test" });
      service.completeFlow("session-24", { success: true });

      const exported = service.exportFlow(flow.id, "dot");

      expect(exported).toBeDefined();
      expect(typeof exported).toBe("string");
      expect((exported as string)).toContain("digraph ExecutionFlow");
    });

    it("should return null for non-existent flow", () => {
      const exported = service.exportFlow("nonexistent", "json");
      expect(exported).toBeNull();
    });
  });

  describe("getFlowHistory", () => {
    it("should return flows for agent", () => {
      const flow1 = service.startFlow("session-25", "agent-2", 1);
      service.completeFlow("session-25", { success: true });

      const flow2 = service.startFlow("session-26", "agent-2", 1);
      service.completeFlow("session-26", { success: false });

      const history = service.getFlowHistory("agent-2");

      expect(history).toHaveLength(2);
    });

    it("should respect limit", () => {
      for (let i = 0; i < 5; i++) {
        service.startFlow(`session-limit-${i}`, "agent-3", 1);
        service.completeFlow(`session-limit-${i}`, { success: true });
      }

      const history = service.getFlowHistory("agent-3", 3);

      expect(history).toHaveLength(3);
    });
  });

  describe("getStats", () => {
    it("should return service statistics", () => {
      service.startFlow("stats-1", "agent-1", 1);
      service.startFlow("stats-2", "agent-2", 1);
      service.completeFlow("stats-2", { success: true });

      const stats = service.getStats();

      expect(stats.activeFlows).toBe(1);
      expect(stats.totalFlows).toBe(1);
      expect(stats.agentsWithHistory).toBe(1);
    });
  });
});

describe("Flow Positioning", () => {
  it("should calculate positions for vertical layout", () => {
    const service = new ExecutionFlowService();
    const flow = service.startFlow("pos-1", "agent-1", 1, { layout: "vertical" });

    service.addNode(flow, { type: "step", label: "Step 1", status: "completed", metadata: {} });
    service.addNode(flow, { type: "step", label: "Step 2", status: "completed", metadata: {} });

    expect(flow.nodes[1].position?.x).toBe(0);
    expect(flow.nodes[1].position?.y).toBe(100);
    expect(flow.nodes[2].position?.x).toBe(0);
    expect(flow.nodes[2].position?.y).toBe(200);
  });

  it("should calculate positions for horizontal layout", () => {
    const service = new ExecutionFlowService();
    const flow = service.startFlow("pos-2", "agent-1", 1, { layout: "horizontal" });

    service.addNode(flow, { type: "step", label: "Step 1", status: "completed", metadata: {} });

    expect(flow.nodes[1].position?.x).toBe(200);
    expect(flow.nodes[1].position?.y).toBe(0);
  });

  it("should calculate positions for auto layout", () => {
    const service = new ExecutionFlowService();
    const flow = service.startFlow("pos-3", "agent-1", 1, { layout: "auto" });

    // Add 4 nodes to create 2 rows
    for (let i = 0; i < 4; i++) {
      service.addNode(flow, { type: "step", label: `Step ${i}`, status: "completed", metadata: {} });
    }

    // 3rd added node (flow.nodes[3], index=3 when added) → row 1, col 0
    expect(flow.nodes[3].position?.x).toBe(0);
    expect(flow.nodes[3].position?.y).toBe(100);
  });
});
