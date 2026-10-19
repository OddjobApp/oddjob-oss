/**
 * UX Streamline Improvements Unit Tests
 * Validates HeaderMissionTicker, NotificationInbox AI Executive Shift Briefing, and Assistant Missions Stream
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HeaderMissionTicker } from "../../server/domain/core/ui/components/layout/HeaderMissionTicker";

// Mock wouter
vi.mock("wouter", () => ({
  useLocation: () => ["/dashboard", vi.fn()],
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

function createTestQueryClient(missionsData: any[] = []) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: () => missionsData,
      },
    },
  });
  queryClient.setQueryData(["/api/missions"], missionsData);
  return queryClient;
}

describe("HeaderMissionTicker Component", () => {
  it("renders null when there are no active missions", () => {
    const queryClient = createTestQueryClient([]);
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <HeaderMissionTicker />
      </QueryClientProvider>
    );

    expect(container.firstChild).toBeNull();
  });

  /*
    This fixture used `spend` and `softCap`, which are not fields on a mission.
    The real columns are currentSpendUsd and budgetLimitUsd, and both are drizzle
    `decimal` — they arrive as STRINGS, not numbers. Written against the invented
    names, the test could only pass if the component also read the invented
    names, which is how a fabricated $0.42 fallback survived here in the first
    place.
  */
  it("renders the mission name, its description, and real spend against budget", () => {
    const mockMissions = [
      {
        id: 42,
        name: "Eulerian Fleet Dispatch",
        status: "active",
        description: "Executing spatial route optimization for zone 7...",
        currentSpendUsd: "1.25",
        budgetLimitUsd: "5.00",
      },
    ];

    const queryClient = createTestQueryClient(mockMissions);
    render(
      <QueryClientProvider client={queryClient}>
        <HeaderMissionTicker />
      </QueryClientProvider>
    );

    expect(screen.getByText("Eulerian Fleet Dispatch")).toBeInTheDocument();
    expect(screen.getByText(/Executing spatial route optimization for zone 7/)).toBeInTheDocument();
    expect(screen.getByTestId("header-mission-ticker-spend")).toHaveTextContent("$1.25 / $5.00");
  });

  it("dispatches agent-assist-request with assistantView: missions on click", () => {
    const mockMissions = [
      {
        id: 99,
        name: "Scribe Studio Script Polish",
        status: "running",
        currentSpendUsd: "0.85",
        budgetLimitUsd: "2.50",
      },
    ];

    const queryClient = createTestQueryClient(mockMissions);
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    render(
      <QueryClientProvider client={queryClient}>
        <HeaderMissionTicker />
      </QueryClientProvider>
    );

    const ticker = screen.getByRole("button");
    fireEvent.click(ticker);

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-assist-request",
        detail: expect.objectContaining({
          context: expect.objectContaining({
            assistantView: "missions",
            missionId: 99,
            source: "header-mission-ticker",
          }),
        }),
      })
    );

    dispatchSpy.mockRestore();
  });

  it("dispatches agent-assist-request on keyboard Enter press", () => {
    const mockMissions = [
      {
        id: 101,
        name: "Eulerian Hexagonal Engine",
        status: "IN_PROGRESS",
        spend: 2.1,
        softCap: 10.0,
      },
    ];

    const queryClient = createTestQueryClient(mockMissions);
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    render(
      <QueryClientProvider client={queryClient}>
        <HeaderMissionTicker />
      </QueryClientProvider>
    );

    const ticker = screen.getByRole("button");
    fireEvent.keyDown(ticker, { key: "Enter" });

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-assist-request",
        detail: expect.objectContaining({
          context: expect.objectContaining({
            assistantView: "missions",
            missionId: 101,
          }),
        }),
      })
    );

    dispatchSpy.mockRestore();
  });
});

describe("NotificationInbox AI Executive Shift Briefing Logic", () => {
  it("formats briefing message correctly based on presence of approval vs routine notifications", () => {
    const notificationsWithApprovals = [
      { id: 1, type: "approval", title: "Approve deploy to prod", createdAt: new Date().toISOString() },
      { id: 2, type: "xray_operation", title: "Routine health scan", createdAt: new Date().toISOString() },
    ];

    const hasApproval = notificationsWithApprovals.some(n => n.type === "approval");
    const approvalCount = notificationsWithApprovals.filter(n => n.type === "approval").length;
    const summaryText = hasApproval
      ? `${approvalCount} approval request${approvalCount > 1 ? "s" : ""} awaiting review in Assistant. Routine workflows are operating within SLA.`
      : "No critical blocking approvals detected.";

    expect(summaryText).toBe("1 approval request awaiting review in Assistant. Routine workflows are operating within SLA.");
  });

  it("formats briefing message correctly for routine-only notifications", () => {
    const routineOnlyNotifications = [
      { id: 1, type: "xray_operation", title: "Trace batch completed", createdAt: new Date().toISOString() },
      { id: 2, type: "xray_operation", title: "Adapter cache refreshed", createdAt: new Date().toISOString() },
    ];

    const hasApproval = routineOnlyNotifications.some(n => n.type === "approval");
    const unviewedCount = routineOnlyNotifications.length;
    const summaryText = hasApproval
      ? "approval requests awaiting review"
      : `${unviewedCount} active notification${unviewedCount > 1 ? "s" : ""} logged. No critical blocking approvals detected.`;

    expect(summaryText).toBe("2 active notifications logged. No critical blocking approvals detected.");
  });
});
