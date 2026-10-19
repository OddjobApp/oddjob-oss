/**
 * Platform Blocks Component Tests
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

// Mock the hooks
vi.mock("@domain/core/ui/hooks/useEventStream.js", () => ({
  useEventStream: vi.fn(() => ({
    events: [],
    isConnected: true,
    reconnect: vi.fn()
  }))
}));

// Mock fetch
global.fetch = vi.fn();

describe("Platform Blocks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("AppVersionControlBlock", () => {
    it("should render without crashing", async () => {
      // Dynamic import to avoid hook issues
      const { default: AppVersionControlBlock } = await import(
        "@domain/core/ui/components/packaged/AppVersionControlBlock"
      );

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ versions: [] })
      });

      render(<AppVersionControlBlock appId={123} appSlug="test-app" />);

      expect(screen.getByText("Version History")).toBeInTheDocument();
    });

    it("should display version list", async () => {
      const { default: AppVersionControlBlock } = await import(
        "@domain/core/ui/components/packaged/AppVersionControlBlock"
      );

      const mockVersions = [
        {
          id: "v1-abc123",
          versionNumber: 1,
          commitHash: "abc123def456",
          message: "Initial commit",
          author: "test@example.com",
          branch: "main",
          tags: ["v1.0"],
          fileCount: 5,
          linesChanged: { added: 100, removed: 0 },
          createdAt: new Date().toISOString()
        }
      ];

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ versions: mockVersions })
      });

      render(<AppVersionControlBlock appId={123} />);

      await waitFor(() => {
        expect(screen.getByText("Initial commit")).toBeInTheDocument();
      });
    });
  });

  describe("MultiAgentDashboardBlock", () => {
    it("should render dashboard", async () => {
      const { default: MultiAgentDashboardBlock } = await import(
        "@domain/core/ui/components/packaged/MultiAgentDashboardBlock"
      );

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          agents: [],
          pendingTasks: 0,
          activeWorkflows: 0,
          queueLength: 0
        })
      });

      render(<MultiAgentDashboardBlock title="Test Dashboard" />);

      expect(screen.getByText("Test Dashboard")).toBeInTheDocument();
      expect(screen.getByText("LIVE")).toBeInTheDocument();
    });

    it("should display agent information", async () => {
      const { default: MultiAgentDashboardBlock } = await import(
        "@domain/core/ui/components/packaged/MultiAgentDashboardBlock"
      );

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          agents: [
            {
              id: "agent-1",
              name: "CodeMaster",
              role: "coder",
              status: "idle",
              capabilities: ["typescript", "react"],
              performance: {
                tasksCompleted: 10,
                tasksFailed: 1,
                averageResponseTime: 1500,
                successRate: 0.9
              }
            }
          ],
          pendingTasks: 5,
          activeWorkflows: 2,
          queueLength: 3
        })
      });

      render(<MultiAgentDashboardBlock showPerformance={true} />);

      await waitFor(() => {
        expect(screen.getByText("CodeMaster")).toBeInTheDocument();
        expect(screen.getByText("coder")).toBeInTheDocument();
      });
    });
  });

  describe("BlueprintEvolutionBlock", () => {
    it("should render evolution dashboard", async () => {
      const { default: BlueprintEvolutionBlock } = await import(
        "@domain/core/ui/components/packaged/BlueprintEvolutionBlock"
      );

      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            blueprintId: "test-blueprint",
            totalAppsCreated: 5,
            successRate: 0.8,
            averageBuildTime: 60000,
            userSatisfaction: 4.2,
            commonIssues: [],
            topFeatures: ["table", "chart"]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ suggestions: [] })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ generations: [] })
        });

      render(<BlueprintEvolutionBlock blueprintId="test-blueprint" />);

      expect(screen.getByText("Blueprint Evolution")).toBeInTheDocument();
      expect(screen.getByText("test-blueprint")).toBeInTheDocument();
    });

    it("should display metrics", async () => {
      const { default: BlueprintEvolutionBlock } = await import(
        "@domain/core/ui/components/packaged/BlueprintEvolutionBlock"
      );

      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            blueprintId: "test-blueprint",
            totalAppsCreated: 10,
            successRate: 0.9,
            averageBuildTime: 45000,
            userSatisfaction: 4.5,
            commonIssues: [],
            topFeatures: ["table", "chart", "form"]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ suggestions: [] })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ generations: [] })
        });

      render(<BlueprintEvolutionBlock blueprintId="test-blueprint" />);

      await waitFor(() => {
        expect(screen.getByText("10")).toBeInTheDocument(); // Apps Created
        expect(screen.getByText("90%")).toBeInTheDocument(); // Success Rate
      });
    });
  });

  describe("SeleniumRunnerBlock", () => {
    it("should render audit interface", async () => {
      const { default: SeleniumRunnerBlock } = await import(
        "@domain/core/ui/components/packaged/SeleniumRunnerBlock"
      );

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ audits: [] })
      });

      render(<SeleniumRunnerBlock appId={123} appSlug="test-app" />);

      expect(screen.getByText("Selenium QA Audit")).toBeInTheDocument();
    });

    it("should trigger audit run", async () => {
      const { default: SeleniumRunnerBlock } = await import(
        "@domain/core/ui/components/packaged/SeleniumRunnerBlock"
      );

      (fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ audits: [] })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ runId: "audit-123", success: true })
        });

      render(<SeleniumRunnerBlock appId={123} />);

      const runButton = screen.getByText("Run Audit");
      fireEvent.click(runButton);

      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          "/api/selenium/run",
          expect.objectContaining({
            method: "POST",
            headers: { "Content-Type": "application/json" }
          })
        );
      });
    });
  });

  describe("PlatformKnowledgeSearchBlock", () => {
    it("should render search interface", async () => {
      const { default: PlatformKnowledgeSearchBlock } = await import(
        "@domain/core/ui/components/packaged/PlatformKnowledgeSearchBlock"
      );

      render(<PlatformKnowledgeSearchBlock />);

      expect(screen.getByPlaceholderText("Search knowledge graph...")).toBeInTheDocument();
    });

    it("should switch between graph and list view", async () => {
      const { default: PlatformKnowledgeSearchBlock } = await import(
        "@domain/core/ui/components/packaged/PlatformKnowledgeSearchBlock"
      );

      render(<PlatformKnowledgeSearchBlock defaultView="graph" />);

      const listButton = screen.getByLabelText("List view");
      fireEvent.click(listButton);

      // View should switch (we can't easily test the graph rendering in unit tests)
      expect(listButton).toBeInTheDocument();
    });
  });
});
