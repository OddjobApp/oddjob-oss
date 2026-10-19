import { describe, it, expect, beforeEach, vi } from "vitest";
import { GovernanceService, type BudgetPolicy, type AgentSalary } from "../core/governance.service.js";

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

describe("GovernanceService", () => {
  let service: GovernanceService;

  beforeEach(() => {
    service = new GovernanceService();
    // Clear internal store
    (service as any).store.clear();
  });

  describe("Budget Policy Management", () => {
    it("should set a budget policy", async () => {
      const policy = await service.setBudgetPolicy({
        organizationId: 1,
        monthlyLimit: 1000000,
        alertThreshold: 0.8,
        hardLimit: 2000000,
        currency: "tokens",
        resetDay: 1,
      });

      expect(policy.id).toBeDefined();
      expect(policy.organizationId).toBe(1);
      expect(policy.monthlyLimit).toBe(1000000);
      expect(policy.alertThreshold).toBe(0.8);
    });

    it("should retrieve a budget policy by organization", async () => {
      await service.setBudgetPolicy({
        organizationId: 1,
        monthlyLimit: 500000,
        alertThreshold: 0.75,
        hardLimit: 1000000,
        currency: "tokens",
        resetDay: 1,
      });

      const retrieved = await service.getBudgetPolicy(1);

      expect(retrieved).toBeDefined();
      expect(retrieved?.monthlyLimit).toBe(500000);
    });

    it("should support department-specific budgets", async () => {
      await service.setBudgetPolicy({
        organizationId: 1,
        department: "engineering",
        monthlyLimit: 300000,
        alertThreshold: 0.7,
        hardLimit: 500000,
        currency: "tokens",
        resetDay: 1,
      });

      await service.setBudgetPolicy({
        organizationId: 1,
        department: "sales",
        monthlyLimit: 200000,
        alertThreshold: 0.6,
        hardLimit: 400000,
        currency: "tokens",
        resetDay: 1,
      });

      const engBudget = await service.getBudgetPolicy(1, "engineering");
      const salesBudget = await service.getBudgetPolicy(1, "sales");

      expect(engBudget?.monthlyLimit).toBe(300000);
      expect(salesBudget?.monthlyLimit).toBe(200000);
    });
  });

  describe("Agent Salary Management", () => {
    it("should set agent salary", async () => {
      const salary = await service.setAgentSalary("agent-1", 1, 50000, "session-1");

      expect(salary.agentId).toBe("agent-1");
      expect(salary.organizationId).toBe(1);
      expect(salary.tokenAllowance).toBe(50000);
      expect(salary.currentSpend).toBe(0);
    });

    it("should preserve spend when updating salary", async () => {
      await service.setAgentSalary("agent-1", 1, 50000);

      // Record some spend
      await service.recordSpend("agent-1", 1, 10000, true);

      // Update salary
      const updated = await service.setAgentSalary("agent-1", 1, 75000);

      expect(updated.currentSpend).toBe(10000);
      expect(updated.tokenAllowance).toBe(75000);
    });
  });

  describe("Budget Checking", () => {
    beforeEach(async () => {
      // Set up budget and salary
      await service.setBudgetPolicy({
        organizationId: 1,
        monthlyLimit: 100000,
        alertThreshold: 0.8,
        hardLimit: 150000,
        currency: "tokens",
        resetDay: 1,
      });

      await service.setAgentSalary("agent-1", 1, 50000);
    });

    it("should allow operation within budget", async () => {
      const result = await service.checkBudget("agent-1", 1, 10000);

      expect(result.allowed).toBe(true);
      expect(result.wouldExceedLimit).toBe(false);
      expect(result.alertLevel).toBe("none");
    });

    it("should deny operation that exceeds salary", async () => {
      // Record some spend first
      await service.recordSpend("agent-1", 1, 45000, true);

      const result = await service.checkBudget("agent-1", 1, 10000);

      expect(result.allowed).toBe(false);
      expect(result.wouldExceedLimit).toBe(true);
      expect(result.reason).toContain("exceed agent salary limit");
    });

    it("should require approval for high-risk operations", async () => {
      const result = await service.checkBudget("agent-1", 1, 5000, {
        riskLevel: "high",
      });

      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
      expect(result.approvalType).toBe("board");
    });

    it("should detect cost spikes", async () => {
      // Record high spend in last 24h
      await service.recordSpend("agent-1", 1, 30000, true);

      const result = await service.checkBudget("agent-1", 1, 1000);

      expect(result.requiresApproval).toBe(true);
      expect(result.approvalType).toBe("manager");
    });

    it("should return warning alert level when approaching threshold", async () => {
      // Spend 82% of budget
      await service.recordSpend("agent-1", 1, 41000, true);

      const result = await service.checkBudget("agent-1", 1, 1000);

      expect(result.alertLevel).toBe("warning");
    });

    it("should deny if no salary found", async () => {
      const result = await service.checkBudget("unknown-agent", 1, 1000);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("No salary allocation");
    });

    it("should deny if no budget configured", async () => {
      await service.setAgentSalary("agent-2", 2, 50000);

      const result = await service.checkBudget("agent-2", 2, 1000);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("No budget policy configured");
    });
  });

  describe("Spend Recording", () => {
    beforeEach(async () => {
      await service.setBudgetPolicy({
        organizationId: 1,
        monthlyLimit: 100000,
        alertThreshold: 0.8,
        hardLimit: 150000,
        currency: "tokens",
        resetDay: 1,
      });

      await service.setAgentSalary("agent-1", 1, 50000);
    });

    it("should record spend and update totals", async () => {
      await service.recordSpend("agent-1", 1, 5000, true);

      const salary = (service as any).store.getSalaryForAgent("agent-1", 1);
      expect(salary.currentSpend).toBe(5000);
      expect(salary.lifetimeSpend).toBe(5000);
    });

    it("should calculate efficiency score", async () => {
      // Mix of successful and failed spends
      for (let i = 0; i < 10; i++) {
        await service.recordSpend("agent-1", 1, 1000, i < 8); // 80% success
      }

      const salary = (service as any).store.getSalaryForAgent("agent-1", 1);
      expect(salary.efficiencyScore).toBeGreaterThan(0);
      expect(salary.efficiencyScore).toBeLessThan(1);
    });

    it("should emit budget warning when threshold exceeded", async () => {
      // Spend past alert threshold
      for (let i = 0; i < 9; i++) {
        await service.recordSpend("agent-1", 1, 5000, true); // 45k / 50k = 90%
      }

      // Verify event would be published (mock)
      const { eventStream } = await import("@server/domain/core/infrastructure/event-stream.service.js");
      expect(eventStream.publish).toHaveBeenCalledWith(
        "governance.budget_warning",
        expect.any(Object),
        expect.any(Object),
        "governance"
      );
    });
  });

  describe("Approval Workflow", () => {
    it("should create approval request", async () => {
      const request = await service.createApprovalRequest({
        organizationId: 1,
        type: "budget_exceeded",
        requesterId: "agent-1",
        projectedCost: 100000,
        currentSpend: 45000,
        budgetLimit: 50000,
        riskLevel: "high",
        description: "Mission requires extensive API calls",
        requiredBy: new Date(Date.now() + 3600000),
      });

      expect(request.id).toBeDefined();
      expect(request.status).toBe("pending");
      expect(request.type).toBe("budget_exceeded");
    });

    it("should approve request", async () => {
      const request = await service.createApprovalRequest({
        organizationId: 1,
        type: "budget_exceeded",
        requesterId: "agent-1",
        projectedCost: 100000,
        currentSpend: 45000,
        budgetLimit: 50000,
        riskLevel: "high",
        description: "Test",
      });

      const approved = await service.resolveApproval(request.id, "approved", "user-123");

      expect(approved.status).toBe("approved");
      expect(approved.approvedBy).toBe("user-123");
      expect(approved.approvedAt).toBeDefined();
    });

    it("should reject request with reason", async () => {
      const request = await service.createApprovalRequest({
        organizationId: 1,
        type: "budget_exceeded",
        requesterId: "agent-1",
        projectedCost: 100000,
        currentSpend: 45000,
        budgetLimit: 50000,
        riskLevel: "high",
        description: "Test",
      });

      const rejected = await service.resolveApproval(
        request.id,
        "rejected",
        "user-123",
        "Insufficient budget for Q4"
      );

      expect(rejected.status).toBe("rejected");
      expect(rejected.rejectionReason).toBe("Insufficient budget for Q4");
    });

    it("should get pending approvals for organization", async () => {
      await service.createApprovalRequest({
        organizationId: 1,
        type: "budget_exceeded",
        requesterId: "agent-1",
        projectedCost: 100000,
        currentSpend: 45000,
        budgetLimit: 50000,
        riskLevel: "high",
        description: "Test 1",
      });

      await service.createApprovalRequest({
        organizationId: 1,
        type: "high_risk_manifest",
        requesterId: "agent-2",
        projectedCost: 50000,
        currentSpend: 20000,
        budgetLimit: 50000,
        riskLevel: "critical",
        description: "Test 2",
      });

      await service.createApprovalRequest({
        organizationId: 2, // Different org
        type: "budget_exceeded",
        requesterId: "agent-3",
        projectedCost: 100000,
        currentSpend: 45000,
        budgetLimit: 50000,
        riskLevel: "high",
        description: "Test 3",
      });

      const pending = await service.getPendingApprovals(1);

      expect(pending.length).toBe(2);
      expect(pending.every((p) => p.organizationId === 1)).toBe(true);
    });

    it("should not allow resolving already resolved request", async () => {
      const request = await service.createApprovalRequest({
        organizationId: 1,
        type: "budget_exceeded",
        requesterId: "agent-1",
        projectedCost: 100000,
        currentSpend: 45000,
        budgetLimit: 50000,
        riskLevel: "high",
        description: "Test",
      });

      await service.resolveApproval(request.id, "approved", "user-123");

      await expect(service.resolveApproval(request.id, "rejected", "user-456")).rejects.toThrow(
        "already approved"
      );
    });
  });

  describe("Cost Analytics", () => {
    beforeEach(async () => {
      await service.setBudgetPolicy({
        organizationId: 1,
        monthlyLimit: 100000,
        alertThreshold: 0.8,
        hardLimit: 150000,
        currency: "tokens",
        resetDay: 1,
      });

      // Create 3 agents with different performance
      await service.setAgentSalary("agent-1", 1, 50000);
      await service.setAgentSalary("agent-2", 1, 50000);
      await service.setAgentSalary("agent-3", 1, 50000);

      // Record varied spend patterns
      for (let i = 0; i < 10; i++) {
        await service.recordSpend("agent-1", 1, 1000, i < 9); // 90% success
        await service.recordSpend("agent-2", 1, 2000, i < 5); // 50% success, higher cost
        await service.recordSpend("agent-3", 1, 500, i < 7); // 70% success, lower cost
      }
    });

    it("should calculate cost analytics", async () => {
      const analytics = await service.getCostAnalytics(1, {
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        end: new Date(),
      });

      expect(analytics.totalSpend).toBeGreaterThan(0);
      expect(analytics.successfulSpend).toBeGreaterThan(0);
      expect(analytics.failedSpend).toBeGreaterThan(0);
      expect(analytics.efficiency).toBeGreaterThan(0);
      expect(analytics.topSpenders.length).toBeGreaterThan(0);
    });

    it("should identify top spenders correctly", async () => {
      const analytics = await service.getCostAnalytics(1, {
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        end: new Date(),
      });

      // agent-2 should be top spender (2000 * 10 = 20000)
      expect(analytics.topSpenders[0].agentId).toBe("agent-2");
      expect(analytics.topSpenders[0].spend).toBe(20000);
    });

    it("should calculate budget utilization", async () => {
      const analytics = await service.getCostAnalytics(1, {
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        end: new Date(),
      });

      expect(analytics.budgetUtilization).toBeGreaterThan(0);
      expect(analytics.budgetUtilization).toBeLessThanOrEqual(1);
    });
  });

  describe("Salary Adjustments", () => {
    beforeEach(async () => {
      await service.setAgentSalary("agent-1", 1, 50000);
    });

    it("should adjust salary", async () => {
      const adjusted = await service.adjustSalary("agent-1", 1, 75000, "Merit increase");

      expect(adjusted.tokenAllowance).toBe(75000);
    });

    it("should emit event on salary adjustment", async () => {
      const { eventStream } = await import("@server/domain/core/infrastructure/event-stream.service.js");

      await service.adjustSalary("agent-1", 1, 75000, "Merit increase");

      expect(eventStream.publish).toHaveBeenCalledWith(
        "governance.salary_adjusted",
        expect.objectContaining({
          agentId: "agent-1",
          oldAllowance: 50000,
          newAllowance: 75000,
          reason: "Merit increase",
        }),
        expect.any(Object),
        "governance"
      );
    });

    it("should fail if salary not found", async () => {
      await expect(service.adjustSalary("unknown", 1, 100000, "Test")).rejects.toThrow(
        "No salary found"
      );
    });
  });

  describe("Monthly Reset", () => {
    it("should reset monthly spend counters", async () => {
      await service.setBudgetPolicy({
        organizationId: 1,
        monthlyLimit: 100000,
        alertThreshold: 0.8,
        hardLimit: 150000,
        currency: "tokens",
        resetDay: 1,
      });

      await service.setAgentSalary("agent-1", 1, 50000);
      await service.recordSpend("agent-1", 1, 30000, true);

      let salary = (service as any).store.getSalaryForAgent("agent-1", 1);
      expect(salary.currentSpend).toBe(30000);

      await service.resetMonthlySpend(1);

      salary = (service as any).store.getSalaryForAgent("agent-1", 1);
      expect(salary.currentSpend).toBe(0);
    });
  });
});
