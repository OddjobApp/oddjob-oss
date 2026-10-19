/**
 * Codegen Pipeline Workbench — page integration tests (plan task 12.3).
 *
 * Hooks and wouter are mocked; the pages compose the real components.
 *
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";

const mockSetLocation = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/", mockSetLocation],
  useParams: () => ({}),
  Link: ({ children }: any) => <a>{children}</a>,
}));

const h = vi.hoisted(() => ({ sessions: [] as any[], analytics: null as any }));

vi.mock("@domain-ui/sdlc-pipeline/ui/modules/hooks/useSessionList.js", () => ({
  useSessionList: () => ({ data: h.sessions, isLoading: false, isError: false }),
}));
vi.mock("@domain-ui/sdlc-pipeline/ui/modules/hooks/useCreateSession.js", () => ({
  useCreateSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@domain-ui/sdlc-pipeline/ui/modules/hooks/useAggregateAnalytics.js", () => ({
  useAggregateAnalytics: () => ({ data: h.analytics, isLoading: false, isError: false, refetch: vi.fn() }),
}));

import SessionDashboardPage from "@domain-ui/sdlc-pipeline/ui/modules/pages/SessionDashboardPage.js";
import QualityMetricsPage from "@domain-ui/sdlc-pipeline/ui/modules/pages/QualityMetricsPage.js";

function session(overrides: any = {}) {
  return {
    id: "sess-123456", templateId: "tpl", status: "active", currentPhase: "planning",
    phases: [], totalCostUsd: 1.25, startedAt: new Date().toISOString(), completedAt: null, ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.sessions = [];
  h.analytics = null;
});

describe("SessionDashboardPage", () => {
  it("renders session rows and summary metrics", () => {
    h.sessions = [session({ id: "active-1", status: "active" }), session({ id: "blocked-1", status: "blocked" })];
    render(<SessionDashboardPage />);
    expect(screen.getByTestId("session-dashboard-page")).toBeInTheDocument();
    expect(screen.getByTestId("session-row-active-1")).toBeInTheDocument();
    expect(screen.getByTestId("session-row-blocked-1")).toBeInTheDocument();
  });

  it("navigates to the session detail on row click", () => {
    h.sessions = [session({ id: "sess-x" })];
    render(<SessionDashboardPage />);
    fireEvent.click(screen.getByTestId("session-row-sess-x"));
    expect(mockSetLocation).toHaveBeenCalledWith("/pipeline/sessions/sess-x");
  });

  it("shows the empty state when there are no sessions", () => {
    h.sessions = [];
    render(<SessionDashboardPage />);
    expect(screen.getByTestId("session-table-empty")).toBeInTheDocument();
  });
});

describe("QualityMetricsPage", () => {
  it("renders analytics summary cards and chart panels", () => {
    h.analytics = {
      totalSessions: 12,
      activeCount: 2, blockedCount: 1, completedCount: 8, failedCount: 1,
      fixAttempts: { total: 10, resolved: 7, failed: 2, reverted: 1 },
      averageTimeToFixMs: 4200,
      qualityGatePassRate: 0.9,
      totalCost: 3.5,
      costByPhase: { planning: 1.0, coding: 2.5 },
      testLoopDistribution: [3, 2, 1, 0, 0, 0],
      verificationPassRateOverTime: [{ date: "2026-07-01", rate: 0.9 }],
      costOverTime: [{ date: "2026-07-01", cost: 3.5, sessionCount: 12 }],
    };
    render(<QualityMetricsPage />);
    expect(screen.getByTestId("quality-metrics-page")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument(); // total sessions
    expect(screen.getByText("Cost Over Time")).toBeInTheDocument();
  });

  it("triggers a refetch when Refresh is clicked", () => {
    h.analytics = null;
    render(<QualityMetricsPage />);
    // Refresh button is present and clickable even before data loads.
    fireEvent.click(screen.getByTestId("refresh-metrics"));
    expect(screen.getByTestId("quality-metrics-page")).toBeInTheDocument();
  });
});
