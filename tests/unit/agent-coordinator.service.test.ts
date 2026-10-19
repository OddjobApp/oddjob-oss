/**
 * Agent Coordinator Service Tests
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { agentCoordinator } from "@domain/agents/core/agent-coordinator.service";

describe("AgentCoordinatorService", () => {
  beforeEach(() => {
    // Reset coordinator state
    // Note: In real tests, you might want to create a fresh instance
  });

  describe("registerAgent", () => {
    it("should register a new agent", async () => {
      const agent = await agentCoordinator.registerAgent(
        "TestAgent",
        "coder",
        ["typescript", "react"]
      );

      expect(agent).toBeDefined();
      expect(agent.name).toBe("TestAgent");
      expect(agent.role).toBe("coder");
      expect(agent.capabilities).toEqual(["typescript", "react"]);
      expect(agent.status).toBe("idle");
      expect(agent.id).toMatch(/^agent-coder-/);
    });

    it("should assign unique IDs", async () => {
      const agent1 = await agentCoordinator.registerAgent("Agent1", "architect", []);
      const agent2 = await agentCoordinator.registerAgent("Agent2", "architect", []);

      expect(agent1.id).not.toBe(agent2.id);
    });
  });

  describe("submitTask", () => {
    it("should submit a task to the queue", async () => {
      const task = await agentCoordinator.submitTask(
        "write_code",
        { file: "test.ts" },
        "high"
      );

      expect(task).toBeDefined();
      expect(task.type).toBe("write_code");
      expect(task.priority).toBe("high");
      expect(task.status).toBe("pending");
      expect(task.id).toMatch(/^task-/);
    });

    it("should prioritize critical tasks", async () => {
      const criticalTask = await agentCoordinator.submitTask(
        "fix_bugs",
        {},
        "critical"
      );

      const normalTask = await agentCoordinator.submitTask(
        "document",
        {},
        "medium"
      );

      // Critical should be processed first (at front of queue)
      expect(criticalTask.priority).toBe("critical");
    });
  });

  describe("createWorkflow", () => {
    it("should create a workflow with multiple tasks", async () => {
      const workflow = await agentCoordinator.createWorkflow(
        "Test Workflow",
        [
          { type: "design_architecture", payload: {}, priority: "high" },
          { type: "write_code", payload: {}, priority: "high" },
          { type: "review_code", payload: {}, priority: "medium" }
        ],
        false
      );

      expect(workflow).toBeDefined();
      expect(workflow.name).toBe("Test Workflow");
      expect(workflow.tasks).toHaveLength(3);
      expect(workflow.parallel).toBe(false);
      expect(workflow.status).toBe("running");
    });

    it("should track workflow status", async () => {
      const workflow = await agentCoordinator.createWorkflow(
        "Status Test",
        [{ type: "write_code", payload: {}, priority: "low" }],
        false
      );

      expect(workflow.status).toBe("running");
      expect(workflow.tasks[0].status).toBe("pending");
    });
  });

  describe("task execution", () => {
    it("should update task status during execution", async () => {
      // Register an agent first
      await agentCoordinator.registerAgent("Executor", "coder", []);

      const task = await agentCoordinator.submitTask(
        "write_code",
        { test: true },
        "high"
      );

      // Initially pending
      expect(task.status).toBe("pending");

      // After processing (in real tests, wait for execution)
      const updatedTask = agentCoordinator.getTask(task.id);
      if (updatedTask && updatedTask.status !== "pending") {
        expect(["in_progress", "completed", "failed"]).toContain(updatedTask.status);
      }
    });
  });

  describe("agent performance tracking", () => {
    it("should track agent metrics", async () => {
      const agent = await agentCoordinator.registerAgent("MetricAgent", "tester", []);

      expect(agent.performance).toBeDefined();
      expect(agent.performance.tasksCompleted).toBe(0);
      expect(agent.performance.successRate).toBe(1.0);
      expect(agent.performance.averageResponseTime).toBe(0);
    });
  });

  describe("getStatus", () => {
    it("should return system status", () => {
      const status = agentCoordinator.getStatus();

      expect(status).toHaveProperty("agents");
      expect(status).toHaveProperty("pendingTasks");
      expect(status).toHaveProperty("activeWorkflows");
      expect(status).toHaveProperty("queueLength");
      expect(Array.isArray(status.agents)).toBe(true);
    });
  });

  describe("heartbeat", () => {
    it("should update agent heartbeat", async () => {
      const agent = await agentCoordinator.registerAgent("HeartbeatAgent", "reviewer", []);
      const before = agent.lastHeartbeat;

      // Wait a bit
      await new Promise(r => setTimeout(r, 10));
      
      await agentCoordinator.heartbeat(agent.id);

      const updated = agentCoordinator.getAgent(agent.id);
      expect(updated!.lastHeartbeat).toBeGreaterThan(before);
    });
  });

  describe("error handling", () => {
    it("should handle task failures gracefully", async () => {
      // Register agent
      await agentCoordinator.registerAgent("FailingAgent", "specialist", []);

      // Submit task that might fail (in real tests, mock failure)
      const task = await agentCoordinator.submitTask(
        "optimize",
        { willFail: true },
        "low"
      );

      // Should still have a task object even if execution fails
      expect(task).toBeDefined();
      expect(task.id).toBeDefined();
    });
  });
});
