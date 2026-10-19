import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  PerformanceManagerService,
  type AgentPerformance,
  type PerformanceImprovementPlan,
} from "../core/performance-manager.service.js";

vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@server/domain/core/infrastructure/event-stream.service.js", () => ({
  eventStream: {
    publish: vi.fn(),
  },
}));

describe("PerformanceManagerService", () => {
  let service: PerformanceManagerService;

  beforeEach(() => {
    service = new PerformanceManagerService();
    // Clear internal store
    (service as any).store.clear();
  });

  describe("Agent Evaluation", () => {
    it("should evaluate agent with sufficient mission history", async () => {
      const missions = Array.from({ length: 10 }, (_, i) => ({
        missionId: i + 1,
        success: i < 8, // 80% success
        cost: 1000,
        timestamp: new Date(Date.now() - i * 24 * 60 * 60 * 1000), // Daily missions
      }));

      const result = await service.evaluateAgent("agent-1", 1, missions);

      expect(result.agentId).toBe("agent-1");
      expect(result.metrics.successRate).toBe(0.8);
      expect(result.previousStatus).toBe("active");
      expect(result.newStatus).toBe("active"); // Good performance stays active
    });

    it("should return insufficient data warning for few missions", async () => {
      const missions = Array.from({ length: 3 }, (_, i) => ({
        missionId: i + 1,
        success: true,
        cost: 1000,
        timestamp: new Date(),
      }));

      const result = await service.evaluateAgent("agent-1", 1, missions);

      expect(result.actionRequired).toBe("none");
      expect(result.reasons[0]).toContain("Insufficient mission history");
    });

    it("should detect poor performance and trigger PIP", async () => {
      // 30% success rate (below 70% threshold)
      const missions = Array.from({ length: 10 }, (_, i) => ({
        missionId: i + 1,
        success: i < 3, // 30% success
        cost: 10000, // High cost
        timestamp: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
      }));

      const result = await service.evaluateAgent("agent-1", 1, missions);

      expect(result.actionRequired).toBe("pip");
      expect(result.newStatus).toBe("pip");
      expect(result.reasons.length).toBeGreaterThan(0);
      expect(result.reasons[0]).toContain("Success rate");
    });

    it("should detect declining trend", async () => {
      // Declining performance: first 5 succeed, last 5 fail
      const missions = [
        ...Array.from({ length: 5 }, (_, i) => ({
          missionId: i + 1,
          success: true,
          cost: 1000,
          timestamp: new Date(Date.now() - (10 - i) * 24 * 60 * 60 * 1000),
        })),
        ...Array.from({ length: 5 }, (_, i) => ({
          missionId: i + 6,
          success: false,
          cost: 1000,
          timestamp: new Date(Date.now() - (5 - i) * 24 * 60 * 60 * 1000),
        })),
      ];

      // First evaluation to establish baseline
      await service.evaluateAgent("agent-1", 1, missions.slice(0, 5));

      // Second evaluation with declining trend
      const result = await service.evaluateAgent("agent-1", 1, missions);

      const perf = (service as any).store.getPerformance("agent-1", 1);
      expect(perf.trend).toBe("declining");
    });

    it("should detect improving trend", async () => {
      // Improving performance: first 5 fail, last 5 succeed
      const missions = [
        ...Array.from({ length: 5 }, (_, i) => ({
          missionId: i + 1,
          success: false,
          cost: 1000,
          timestamp: new Date(Date.now() - (10 - i) * 24 * 60 * 60 * 1000),
        })),
        ...Array.from({ length: 5 }, (_, i) => ({
          missionId: i + 6,
          success: true,
          cost: 1000,
          timestamp: new Date(Date.now() - (5 - i) * 24 * 60 * 60 * 1000),
        })),
      ];

      // First evaluation
      await service.evaluateAgent("agent-1", 1, missions.slice(0, 5));

      // Second evaluation with improving trend
      const result = await service.evaluateAgent("agent-1", 1, missions);

      const perf = (service as any).store.getPerformance("agent-1", 1);
      expect(perf.trend).toBe("improving");
    });

    it("should put underperforming agent on probation before PIP", async () => {
      // 60% success (below 70% threshold but not terrible)
      const missions = Array.from({ length: 10 }, (_, i) => ({
        missionId: i + 1,
        success: i < 6,
        cost: 1000,
        timestamp: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
      }));

      const result = await service.evaluateAgent("agent-1", 1, missions);

      expect(result.actionRequired).toBe("warn");
      expect(result.newStatus).toBe("probation");
    });

    it("should calculate efficiency score", async () => {
      const missions = Array.from({ length: 10 }, (_, i) => ({
        missionId: i + 1,
        success: i < 8,
        cost: 1000,
        timestamp: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
      }));

      const result = await service.evaluateAgent("agent-1", 1, missions);

      expect(result.metrics.efficiencyScore).toBeGreaterThan(0);
      expect(result.metrics.efficiencyScore).toBeLessThanOrEqual(1);
    });
  });

  describe("Performance Improvement Plan (PIP)", () => {
    it("should create a PIP", async () => {
      const pip = await service.createPIP("agent-1", 1, "Low success rate", "below_threshold");

      expect(pip.id).toBeDefined();
      expect(pip.agentId).toBe("agent-1");
      expect(pip.organizationId).toBe(1);
      expect(pip.status).toBe("pending");
      expect(pip.triggerReason).toBe("Low success rate");
      expect(pip.deadlineDays).toBe(14);
    });

    it("should not allow duplicate active PIPs", async () => {
      await service.createPIP("agent-1", 1, "Low success rate", "below_threshold");

      await expect(
        service.createPIP("agent-1", 1, "Another issue", "below_threshold")
      ).rejects.toThrow("Active PIP already exists");
    });

    it("should start a PIP and trigger upskilling", async () => {
      const pip = await service.createPIP("agent-1", 1, "Low success rate", "below_threshold");

      const started = await service.startPIP(pip.id);

      expect(started.status).toBe("active");
      expect(started.startedAt).toBeDefined();
    });

    it("should complete PIP with promoted outcome", async () => {
      const pip = await service.createPIP("agent-1", 1, "Low success rate", "below_threshold");
      await service.startPIP(pip.id);

      const completed = await service.completePIP(pip.id, {
        successRate: 0.8,
        costEfficiency: 5000,
      });

      expect(completed.status).toBe("completed");
      expect(completed.outcome).toBe("promoted");
      expect(completed.finalSuccessRate).toBe(0.8);
    });

    it("should complete PIP with terminated outcome", async () => {
      const pip = await service.createPIP("agent-1", 1, "Low success rate", "below_threshold");
      await service.startPIP(pip.id);

      // Simulate max upskilling attempts reached
      pip.upskillingAttempts = 3;
      (service as any).store.setPip(pip);

      const completed = await service.completePIP(pip.id, {
        successRate: 0.5, // Below 75% target
        costEfficiency: 15000,
      });

      expect(completed.status).toBe("failed");
      expect(completed.outcome).toBe("terminated");
    });

    it("should complete PIP with extended outcome", async () => {
      const pip = await service.createPIP("agent-1", 1, "Low success rate", "below_threshold");
      await service.startPIP(pip.id);

      // Less than max upskilling attempts
      pip.upskillingAttempts = 1;
      (service as any).store.setPip(pip);

      const completed = await service.completePIP(pip.id, {
        successRate: 0.5, // Below 75% target
        costEfficiency: 15000,
      });

      expect(completed.status).toBe("active"); // Extended, not completed
      expect(completed.outcome).toBe("extended");
    });

    it("should update agent status when PIP completes", async () => {
      // Create performance record
      const missions = Array.from({ length: 5 }, (_, i) => ({
        missionId: i + 1,
        success: true,
        cost: 1000,
        timestamp: new Date(),
      }));
      await service.evaluateAgent("agent-1", 1, missions);

      // Set status to PIP
      const perf = (service as any).store.getPerformance("agent-1", 1);
      perf.status = "pip";
      (service as any).store.setPerformance(perf);

      // Create and complete PIP
      const pip = await service.createPIP("agent-1", 1, "Low success rate", "below_threshold");
      await service.startPIP(pip.id);

      await service.completePIP(pip.id, {
        successRate: 0.8,
        costEfficiency: 5000,
      });

      const updatedPerf = (service as any).store.getPerformance("agent-1", 1);
      expect(updatedPerf.status).toBe("active"); // Promoted back to active
    });
  });

  describe("Upskilling Jobs", () => {
    it("should initiate upskilling", async () => {
      const pip = await service.createPIP("agent-1", 1, "Low success rate", "below_threshold");

      const job = await service.initiateUpskilling("agent-1", 1, pip.id, "fine_tuning");

      expect(job.id).toBeDefined();
      expect(job.agentId).toBe("agent-1");
      expect(job.pipId).toBe(pip.id);
      expect(job.status).toBe("queued");
      expect(job.type).toBe("fine_tuning");
      expect(pip.upskillingAttempts).toBe(1);
    });

    it("should track upskilling progress", async () => {
      const pip = await service.createPIP("agent-1", 1, "Low success rate", "below_threshold");

      const job = await service.initiateUpskilling("agent-1", 1, pip.id, "fine_tuning");

      // Wait for simulation to complete (simulated is 5 seconds)
      await new Promise((resolve) => setTimeout(resolve, 7000));

      const updated = (service as any).store.getUpskilling(job.id);
      expect(updated.status).toMatch(/completed|failed/);
      expect(updated.progressPercent).toBe(100);
    });
  });

  describe("Performance Summary", () => {
    beforeEach(async () => {
      // Create 5 agents with different performance levels
      const scenarios = [
        { agentId: "agent-1", successRate: 0.9, cost: 1000 }, // Top performer
        { agentId: "agent-2", successRate: 0.8, cost: 1200 }, // Good
        { agentId: "agent-3", successRate: 0.6, cost: 1500 }, // Average
        { agentId: "agent-4", successRate: 0.5, cost: 2000 }, // Below avg
        { agentId: "agent-5", successRate: 0.3, cost: 3000 }, // Poor
      ];

      for (const scenario of scenarios) {
        const missions = Array.from({ length: 10 }, (_, i) => ({
          missionId: i + 1,
          success: i < scenario.successRate * 10,
          cost: scenario.cost,
          timestamp: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
        }));

        await service.evaluateAgent(scenario.agentId, 1, missions);
      }
    });

    it("should return performance summary", async () => {
      const summary = await service.getPerformanceSummary(1);

      expect(summary.totalAgents).toBe(5);
      expect(summary.avgEfficiency).toBeGreaterThan(0);
      expect(summary.topPerformers.length).toBe(5);
      expect(summary.atRiskAgents.length).toBeGreaterThan(0);
    });

    it("should identify at-risk agents correctly", async () => {
      const summary = await service.getPerformanceSummary(1);

      // agent-5 with 30% success and high cost should be at risk
      const atRiskIds = summary.atRiskAgents.map((a) => a.agentId);
      expect(atRiskIds).toContain("agent-5");
    });

    it("should identify top performers correctly", async () => {
      const summary = await service.getPerformanceSummary(1);

      // Top performer should be first
      expect(summary.topPerformers[0].agentId).toBe("agent-1");
      expect(summary.topPerformers[0].successRate).toBe(0.9);
    });

    it("should calculate trend", async () => {
      const summary = await service.getPerformanceSummary(1);

      expect(["improving", "declining", "stable"]).toContain(summary.trend);
    });
  });

  describe("Daily Evaluation", () => {
    it("should run daily evaluation", async () => {
      // Create some agents
      for (let i = 1; i <= 3; i++) {
        const missions = Array.from({ length: 5 }, (_, j) => ({
          missionId: j + 1,
          success: j < 3, // Poor performance
          cost: 1000,
          timestamp: new Date(Date.now() - j * 24 * 60 * 60 * 1000),
        }));
        await service.evaluateAgent(`agent-${i}`, 1, missions);

        // Reset evaluation time to force re-evaluation
        const perf = (service as any).store.getPerformance(`agent-${i}`, 1);
        perf.lastEvaluatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
        (service as any).store.setPerformance(perf);
      }

      const results = await service.runDailyEvaluation(1);

      expect(results.evaluated).toBe(3);
    });

    it("should not re-evaluate recently evaluated agents", async () => {
      // Create agent with recent evaluation
      const missions = Array.from({ length: 5 }, (_, j) => ({
        missionId: j + 1,
        success: true,
        cost: 1000,
        timestamp: new Date(),
      }));
      await service.evaluateAgent("agent-1", 1, missions);

      const results = await service.runDailyEvaluation(1);

      expect(results.evaluated).toBe(0);
    });

    it("should complete PIPs that have exceeded deadline", async () => {
      // Create performance
      const missions = Array.from({ length: 5 }, (_, j) => ({
        missionId: j + 1,
        success: true,
        cost: 1000,
        timestamp: new Date(),
      }));
      await service.evaluateAgent("agent-1", 1, missions);

      // Set status to PIP
      const perf = (service as any).store.getPerformance("agent-1", 1);
      perf.status = "pip";
      perf.lastEvaluatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000); // Exceed 24 hours
      (service as any).store.setPerformance(perf);

      // Create and start PIP 15 days ago (exceeds 14 day deadline)
      const pip = await service.createPIP("agent-1", 1, "Low success rate", "below_threshold");
      pip.status = "active";
      pip.startedAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
      (service as any).store.setPip(pip);

      const results = await service.runDailyEvaluation(1);

      expect(results.pipsCompleted).toBe(1);
    });
  });

  describe("Custom Thresholds", () => {
    it("should use custom thresholds when provided", async () => {
      const customService = new PerformanceManagerService({
        reliabilityMin: 0.5, // Lower threshold
        costEfficiencyMax: 50000,
        missionCountMin: 3,
        evaluationWindowDays: 60,
      });

      // 60% success is now above 50% threshold
      const missions = Array.from({ length: 5 }, (_, i) => ({
        missionId: i + 1,
        success: i < 3,
        cost: 1000,
        timestamp: new Date(),
      }));

      const result = await customService.evaluateAgent("agent-1", 1, missions);

      // Should not trigger PIP with 60% success when threshold is 50%
      expect(result.actionRequired).toBe("none");
    });
  });

  describe("Organization PIPs", () => {
    it("should get PIPs for organization", async () => {
      await service.createPIP("agent-1", 1, "Issue 1", "below_threshold");
      await service.createPIP("agent-2", 1, "Issue 2", "below_threshold");
      await service.createPIP("agent-3", 2, "Issue 3", "below_threshold"); // Different org

      const pips = await service.getOrganizationPIPs(1);

      expect(pips.length).toBe(2);
      expect(pips.every((p) => p.organizationId === 1)).toBe(true);
    });

    it("should filter PIPs by status", async () => {
      const pip1 = await service.createPIP("agent-1", 1, "Issue 1", "below_threshold");
      const pip2 = await service.createPIP("agent-2", 1, "Issue 2", "below_threshold");

      // Start one PIP
      await service.startPIP(pip1.id);

      const activePips = await service.getOrganizationPIPs(1, "active");
      const pendingPips = await service.getOrganizationPIPs(1, "pending");

      expect(activePips.length).toBe(1);
      expect(pendingPips.length).toBe(1);
    });
  });
});
