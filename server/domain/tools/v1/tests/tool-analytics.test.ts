import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ToolAnalyticsService,
  toolAnalyticsService,
  type ToolInvocation,
  type AnalyticsFilter,
} from "../tool-analytics.service.js";

vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe("ToolAnalyticsService", () => {
  let service: ToolAnalyticsService;

  beforeEach(() => {
    service = new ToolAnalyticsService();
    service.clearData();
  });

  describe("Recording Invocations", () => {
    it("should record a successful invocation", async () => {
      await service.recordInvocation(
        1,
        "curl",
        "api_client",
        { url: "https://api.example.com" },
        { status: 200 },
        {
          organizationId: 1,
          executionTimeMs: 150,
          success: true,
          agentId: "agent-1",
          source: "agent",
        }
      );

      const stats = service.getStats();
      expect(stats.totalInvocations).toBe(1);
    });

    it("should record a failed invocation", async () => {
      await service.recordInvocation(
        1,
        "curl",
        "api_client",
        { url: "https://api.example.com" },
        null,
        {
          organizationId: 1,
          executionTimeMs: 50,
          success: false,
          error: "Connection timeout",
          agentId: "agent-1",
          source: "agent",
        }
      );

      const metrics = await service.getMetrics(1);
      expect(metrics?.failedInvocations).toBe(1);
      expect(metrics?.successRate).toBe(0);
    });

    it("should record multiple invocations", async () => {
      for (let i = 0; i < 5; i++) {
        await service.recordInvocation(
          1,
          "curl",
          "api_client",
          { url: "https://api.example.com" },
          { data: i },
          {
            organizationId: 1,
            executionTimeMs: 100 + i * 10,
            success: i < 4, // 4 success, 1 failure
            agentId: "agent-1",
            source: "agent",
          }
        );
      }

      const metrics = await service.getMetrics(1);
      expect(metrics?.totalInvocations).toBe(5);
      expect(metrics?.successfulInvocations).toBe(4);
      expect(metrics?.failedInvocations).toBe(1);
    });

    it("should separate data by job ID", async () => {
      await service.recordInvocation(
        1, "curl", "api1", {}, {},
        { organizationId: 1, executionTimeMs: 100, success: true, source: "agent" }
      );
      await service.recordInvocation(
        2, "sql_query", "db1", {}, {},
        { organizationId: 1, executionTimeMs: 200, success: true, source: "agent" }
      );

      const metrics1 = await service.getMetrics(1);
      const metrics2 = await service.getMetrics(2);

      expect(metrics1?.totalInvocations).toBe(1);
      expect(metrics2?.totalInvocations).toBe(1);
      expect(metrics1?.jobType).toBe("curl");
      expect(metrics2?.jobType).toBe("sql_query");
    });
  });

  describe("Metrics Calculation", () => {
    beforeEach(async () => {
      // Create varied test data
      const timestamps = [
        new Date("2024-01-01T10:00:00Z"),
        new Date("2024-01-01T11:00:00Z"),
        new Date("2024-01-01T14:00:00Z"),
        new Date("2024-01-02T10:00:00Z"),
        new Date("2024-01-02T11:00:00Z"),
      ];

      for (let i = 0; i < 10; i++) {
        await service.recordInvocation(
          1,
          "curl",
          "test_tool",
          { url: `https://api.example.com/${i}`, method: "GET" },
          { status: 200, data: i },
          {
            organizationId: 1,
            executionTimeMs: 50 + i * 20, // 50, 70, 90, ..., 230ms
            success: i < 8, // 80% success rate
            error: i >= 8 ? "Timeout" : undefined,
            agentId: i % 2 === 0 ? "agent-1" : "agent-2",
            userId: 100 + (i % 3),
            source: "agent",
            timestamp: timestamps[i % timestamps.length],
          }
        );
      }
    });

    it("should calculate success rate correctly", async () => {
      const metrics = await service.getMetrics(1);
      expect(metrics?.successRate).toBe(0.8);
      expect(metrics?.failureRate).toBe(0.2);
    });

    it("should calculate timing statistics", async () => {
      const metrics = await service.getMetrics(1);

      // Times: 50, 70, 90, 110, 130, 150, 170, 190, 210, 230
      expect(metrics?.avgExecutionTimeMs).toBe(140); // Average of 50-230 in steps of 20
      expect(metrics?.minExecutionTimeMs).toBe(50);
      expect(metrics?.maxExecutionTimeMs).toBe(230);
      expect(metrics?.p95ExecutionTimeMs).toBeGreaterThan(0);
      expect(metrics?.p99ExecutionTimeMs).toBeGreaterThan(0);
    });

    it("should identify common errors", async () => {
      const metrics = await service.getMetrics(1);

      expect(metrics?.commonErrors.length).toBeGreaterThan(0);
      expect(metrics?.commonErrors[0].error).toBe("Timeout");
      expect(metrics?.commonErrors[0].count).toBe(2);
    });

    it("should identify peak usage hours", async () => {
      const metrics = await service.getMetrics(1);

      expect(metrics?.peakUsageHours.length).toBeGreaterThan(0);
      // Peak hours should be during working hours (10:00 and 11:00 in test data)
      expect(metrics?.peakUsageHours).toContain(10);
      expect(metrics?.peakUsageHours).toContain(11);
    });

    it("should identify unique users and agents", async () => {
      const metrics = await service.getMetrics(1);

      expect(metrics?.uniqueAgents.length).toBe(2); // agent-1, agent-2
      expect(metrics?.uniqueUsers.length).toBe(3); // 100, 101, 102
    });

    it("should analyze input patterns", async () => {
      const metrics = await service.getMetrics(1);

      const urlField = metrics?.commonInputs.find((f) => f.field === "url");
      expect(urlField).toBeDefined();
      expect(urlField?.sampleValues.length).toBeGreaterThan(0);
    });
  });

  describe("Time Range Filtering", () => {
    beforeEach(async () => {
      const oldDate = new Date("2024-01-01T10:00:00");
      const newDate = new Date("2024-01-15T10:00:00");

      await service.recordInvocation(
        1, "curl", "test", {}, {},
        { organizationId: 1, executionTimeMs: 100, success: true, source: "agent" }
      );

      // Hack: modify timestamp manually for testing
      // (In real code, would use time manipulation)
    });

    beforeEach(async () => {
      vi.useFakeTimers();
      const baseDate = new Date("2024-01-01T10:00:00");
      vi.setSystemTime(baseDate);

      // Add data
      for (let i = 0; i < 5; i++) {
        await service.recordInvocation(
          1, "curl", "test", {}, {},
          { organizationId: 1, executionTimeMs: 100, success: true, source: "agent" }
        );
      }
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should filter by time range", async () => {
      const now = new Date("2024-01-01T10:00:00");
      const metrics = await service.getMetrics(1, {
        start: new Date(now.getTime() - 1000),
        end: new Date(now.getTime() + 1000),
      });

      expect(metrics?.totalInvocations).toBe(5);
    });

    it("should return null for empty time range", async () => {
      // Add data
      await service.recordInvocation(
        1, "curl", "test", {}, {},
        { organizationId: 1, executionTimeMs: 100, success: true, source: "agent" }
      );

      const metrics = await service.getMetrics(1, {
        start: new Date("2023-01-01"),
        end: new Date("2023-01-02"),
      });

      expect(metrics).toBeNull();
    });
  });

  describe("Organization Analytics", () => {
    beforeEach(async () => {
      // Multiple tools in org 1
      for (let i = 0; i < 3; i++) {
        await service.recordInvocation(
          i + 1,
          i === 0 ? "curl" : i === 1 ? "sql_query" : "slack_post",
          `tool-${i + 1}`,
          {},
          {},
          {
            organizationId: 1,
            executionTimeMs: 100,
            success: i < 2, // 2 success, 1 failure
            error: i < 2 ? undefined : "Simulated failure",
            source: "agent",
          }
        );
      }

      // Tool in org 2
      await service.recordInvocation(
        4, "curl", "tool-4", {}, {},
        { organizationId: 2, executionTimeMs: 100, success: true, source: "agent" }
      );
    });

    it("should aggregate by organization", async () => {
      const analytics = await service.getOrganizationAnalytics(1);

      expect(analytics.totalTools).toBe(3);
      expect(analytics.totalInvocations).toBe(3);
      expect(analytics.overallSuccessRate).toBe(2 / 3);
    });

    it("should identify top tools", async () => {
      // Add more data for tool 1
      for (let i = 0; i < 5; i++) {
        await service.recordInvocation(
          100, "curl", "popular_tool", {}, {},
          { organizationId: 1, executionTimeMs: 100, success: true, source: "agent" }
        );
      }

      const analytics = await service.getOrganizationAnalytics(1);

      expect(analytics.topTools.length).toBeGreaterThan(0);
      expect(analytics.topTools[0].toolName).toBe("popular_tool");
    });

    it("should categorize tools", async () => {
      const analytics = await service.getOrganizationAnalytics(1);

      expect(Object.keys(analytics.categoryBreakdown).length).toBeGreaterThan(0);
    });

    it("should identify top errors", async () => {
      const analytics = await service.getOrganizationAnalytics(1);

      expect(analytics.topErrors.length).toBeGreaterThan(0);
    });

    it("should calculate daily usage", async () => {
      const analytics = await service.getOrganizationAnalytics(1);

      expect(analytics.dailyUsage.length).toBeGreaterThan(0);
    });

    it("should isolate organizations", async () => {
      const org1 = await service.getOrganizationAnalytics(1);
      const org2 = await service.getOrganizationAnalytics(2);

      expect(org1.totalTools).toBe(3);
      expect(org2.totalTools).toBe(1);
    });
  });

  describe("Optimization Recommendations", () => {
    it("should recommend for slow execution", async () => {
      // Record slow invocations
      for (let i = 0; i < 5; i++) {
        await service.recordInvocation(
          1, "curl", "slow_tool", {}, {},
          { organizationId: 1, executionTimeMs: 10000, success: true, source: "agent" }
        );
      }

      const recommendations = await service.generateRecommendations(1);

      const perfRec = recommendations.find((r) => r.type === "performance");
      expect(perfRec).toBeDefined();
      expect(perfRec?.title).toContain("Slow");
    });

    it("should recommend for low success rate", async () => {
      for (let i = 0; i < 10; i++) {
        await service.recordInvocation(
          1, "curl", "unreliable", {}, {},
          {
            organizationId: 1,
            executionTimeMs: 100,
            success: i < 5, // 50% success rate
            error: i >= 5 ? "Error" : undefined,
            source: "agent",
          }
        );
      }

      const recommendations = await service.generateRecommendations(1);

      const reliabilityRec = recommendations.find((r) => r.type === "reliability");
      expect(reliabilityRec).toBeDefined();
      expect(reliabilityRec?.severity).toBe("critical");
    });

    it("should recommend for error patterns", async () => {
      for (let i = 0; i < 10; i++) {
        await service.recordInvocation(
          1, "curl", "error_prone", {}, {},
          {
            organizationId: 1,
            executionTimeMs: 100,
            success: i < 3,
            error: i >= 3 ? "SameError" : undefined,
            source: "agent",
          }
        );
      }

      const recommendations = await service.generateRecommendations(1);

      expect(recommendations.length).toBeGreaterThan(0);
    });

    it("should return empty for healthy tool", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-01-01T00:00:00")); // Midnight (outside business hours)

      const healthyJobId = 999;
      for (let i = 0; i < 10; i++) {
        await service.recordInvocation(
          healthyJobId, "curl", "healthy", {}, {},
          { organizationId: 1, executionTimeMs: 50, success: true, source: "agent" }
        );
      }

      const recommendations = await service.generateRecommendations(healthyJobId);

      expect(recommendations.length).toBe(0);
      vi.useRealTimers();
    });

    it("should sort by severity", async () => {
      // Mix of issues
      for (let i = 0; i < 10; i++) {
        await service.recordInvocation(
          1, "curl", "mixed", {}, {},
          {
            organizationId: 1,
            executionTimeMs: 30000, // Slow
            success: i < 2, // Low success rate (critical)
            error: i >= 2 ? "Error" : undefined,
            source: "agent",
          }
        );
      }

      const recommendations = await service.generateRecommendations(1);

      expect(recommendations[0].severity).toBe("critical");
    });
  });

  describe("Time Series", () => {
    beforeEach(async () => {
      // Add invocations over "time" (simulated by just having multiple)
      for (let i = 0; i < 20; i++) {
        await service.recordInvocation(
          1, "curl", "timeseries", {}, {},
          {
            organizationId: 1,
            executionTimeMs: 100 + i,
            success: i % 5 !== 0, // Some failures
            source: "agent",
          }
        );
      }
    });

    it("should generate invocation time series", async () => {
      const series = await service.getTimeSeries("invocations", { jobId: 1 }, "day");

      expect(series.length).toBeGreaterThan(0);
    });

    it("should generate success rate time series", async () => {
      const series = await service.getTimeSeries("successRate", { jobId: 1 }, "day");

      expect(series.length).toBeGreaterThan(0);
      expect(series[0].value).toBeGreaterThanOrEqual(0);
      expect(series[0].value).toBeLessThanOrEqual(1);
    });

    it("should generate execution time series", async () => {
      const series = await service.getTimeSeries("executionTime", { jobId: 1 }, "day");

      expect(series.length).toBeGreaterThan(0);
      expect(series[0].value).toBeGreaterThan(0);
    });

    it("should handle empty data", async () => {
      const series = await service.getTimeSeries("invocations", { jobId: 999 }, "day");

      expect(series.length).toBe(0);
    });
  });

  describe("Period Comparison", () => {
    beforeEach(async () => {
      vi.useFakeTimers();
      const now = new Date("2024-01-02T12:00:00");
      
      // Period 1 data (older: 1.5 seconds ago)
      vi.setSystemTime(new Date(now.getTime() - 1500));
      for (let i = 0; i < 5; i++) {
        await service.recordInvocation(
          1, "curl", "compare", {}, {},
          { organizationId: 1, executionTimeMs: 100, success: true, source: "agent" }
        );
      }

      // Period 2 data (more recent: 0.5 seconds ago)
      vi.setSystemTime(new Date(now.getTime() - 500));
      for (let i = 0; i < 10; i++) {
        await service.recordInvocation(
          1, "curl", "compare", {}, {},
          { organizationId: 1, executionTimeMs: 50, success: true, source: "agent" }
        );
      }
      
      vi.setSystemTime(now);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should compare two periods", async () => {
      const now = new Date("2024-01-02T12:00:00");
      const period1 = { start: new Date(now.getTime() - 2000), end: new Date(now.getTime() - 1000) };
      const period2 = { start: new Date(now.getTime() - 1000), end: now };

      const comparison = await service.comparePeriods(1, period1, period2);

      expect(comparison.changes.invocations.absolute).toBe(5); // 10 - 5
      expect(comparison.changes.avgExecutionTime.absolute).toBe(-50); // 50 - 100
    });
  });

  describe("Dashboard Summary", () => {
    it("should generate dashboard summary", async () => {
      // Add recent data
      for (let i = 0; i < 10; i++) {
        await service.recordInvocation(
          i % 3 + 1, // 3 different tools
          "curl",
          `tool-${i + 1}`,
          {},
          {},
          {
            organizationId: 1,
            executionTimeMs: 100,
            success: i < 9, // 90% success
            source: "agent",
          }
        );
      }

      const summary = await service.getDashboardSummary(1);

      expect(summary.totalInvocations24h).toBe(10);
      expect(summary.successRate24h).toBe(0.9);
      expect(summary.mostUsedTools.length).toBeGreaterThan(0);
      expect(summary.trending).toBeDefined();
    });

    it("should identify errors in summary", async () => {
      await service.recordInvocation(
        1, "curl", "error_tool", {}, {},
        {
          organizationId: 1,
          executionTimeMs: 100,
          success: false,
          error: "Test Error",
          source: "agent",
        }
      );

      const summary = await service.getDashboardSummary(1);

      expect(summary.topErrors24h.length).toBeGreaterThan(0);
      expect(summary.topErrors24h[0].error).toBe("Test Error");
    });
  });

  describe("Store Management", () => {
    it("should clear all data", async () => {
      await service.recordInvocation(
        1, "curl", "test", {}, {},
        { organizationId: 1, executionTimeMs: 100, success: true, source: "agent" }
      );

      await service.clearData();

      const stats = service.getStats();
      expect(stats.totalInvocations).toBe(0);
    });

    it("should provide stats", async () => {
      for (let i = 0; i < 100; i++) {
        await service.recordInvocation(
          1, "curl", "test", {}, {},
          { organizationId: 1, executionTimeMs: 100, success: true, source: "agent" }
        );
      }

      const stats = service.getStats();

      expect(stats.totalInvocations).toBe(100);
      expect(stats.memorySize).toBeGreaterThan(0);
    });
  });

  describe("Singleton Instance", () => {
    it("should export singleton instance", () => {
      expect(toolAnalyticsService).toBeInstanceOf(ToolAnalyticsService);
    });
  });
});
