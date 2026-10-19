import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TacticalDispatchDashboard } from "./TacticalDispatchDashboard";

// Mock fetch for dataset endpoints
global.fetch = vi.fn().mockImplementation(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve([]),
  })
);

process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "pk.test.token";

// Mock react-map-gl
vi.mock("react-map-gl", () => ({
  default: ({ children }: any) => <div data-testid="mock-map">{children}</div>,
  Marker: ({ children, onClick }: any) => <div data-testid="mock-marker" onClick={onClick}>{children}</div>,
  Popup: ({ children }: any) => <div data-testid="mock-popup">{children}</div>,
  NavigationControl: () => <div />,
  FullscreenControl: () => <div />,
  ScaleControl: () => <div />,
}));

// Mock PlatformAgentChatBlock
vi.mock("@domain-ui/core/ui/components/packaged/PlatformAgentChatBlock", () => ({
  default: () => <div data-testid="mock-chat-block">Agent Chat</div>,
}));

describe("TacticalDispatchDashboard Component", () => {
  it("renders dispatch header, KPI metrics, and tactical map", () => {
    render(<TacticalDispatchDashboard />);

    expect(screen.getByText("Rescue & Emergency Dispatch")).toBeDefined();
    expect(screen.getByText("Active Incidents")).toBeDefined();
    expect(screen.getByText("SLA Compliance")).toBeDefined();
    expect(screen.getByTestId("mock-map")).toBeDefined();
  });

  it("filters incidents when priority filter button is clicked", () => {
    render(<TacticalDispatchDashboard />);

    // Initially shows incidents
    expect(screen.getAllByText("Data Node 4 (Critical Power Failure)").length).toBeGreaterThan(0);

    // Filter to CRITICAL
    const criticalBtn = screen.getByRole("button", { name: "CRITICAL" });
    fireEvent.click(criticalBtn);

    expect(screen.getAllByText("Data Node 4 (Critical Power Failure)").length).toBeGreaterThan(0);
  });

  it("opens Rapid Triage Drawer when Rapid Triage button is clicked", () => {
    render(<TacticalDispatchDashboard />);

    const triageButtons = screen.getAllByRole("button", { name: /Rapid Triage/i });
    expect(triageButtons.length).toBeGreaterThan(0);
    fireEvent.click(triageButtons[0]);

    // Drawer opens
    expect(screen.getByText("Rapid Triage & Dispatch Drawer")).toBeDefined();
    expect(screen.getByText("Asset Verification")).toBeDefined();
    expect(screen.getByText("Nearby Responders & Field Units")).toBeDefined();
  });

  it("toggles What-If Route & Capacity Simulation Engine", () => {
    render(<TacticalDispatchDashboard />);

    const whatIfBtn = screen.getByRole("button", { name: /What-If Simulator/i });
    fireEvent.click(whatIfBtn);

    // Simulator panel opens
    expect(screen.getByText("What-If Route & Capacity Simulation Engine")).toBeDefined();
    expect(screen.getByText("Eulerian Proximity Matrix")).toBeDefined();
    expect(screen.getByText("Inject to Queue")).toBeDefined();

    // Inject simulated incident
    const injectBtn = screen.getByRole("button", { name: /Inject to Queue/i });
    fireEvent.click(injectBtn);

    expect(screen.getByText(/\[SIMULATED\]/)).toBeDefined();
  });

  it("opens Knowledge Graph Context Lens when asset serial chip is clicked", () => {
    render(<TacticalDispatchDashboard />);

    const serialChips = screen.getAllByTitle("Open Knowledge Graph Entity Lens");
    expect(serialChips.length).toBeGreaterThan(0);
    fireEvent.click(serialChips[0]);

    // Context lens modal appears
    expect(screen.getByText("Knowledge Graph Context Lens")).toBeDefined();
    expect(screen.getByText(/Topological Graph Dependencies/i)).toBeDefined();
    expect(screen.getByText(/Substation Feeder 4-B/i)).toBeDefined();

    // Close button works
    const closeBtn = screen.getByRole("button", { name: "Close Context Lens" });
    fireEvent.click(closeBtn);
  });

  it("interacts with Human-In-The-Loop (HIL) Staged Actions bar", async () => {
    render(<TacticalDispatchDashboard />);

    expect(screen.getByText(/Human-In-The-Loop \(HIL\) Staged Actions/i)).toBeDefined();

    // Pause countdown
    const pauseBtn = screen.getByRole("button", { name: /Pause \/ Hold/i });
    fireEvent.click(pauseBtn);
    expect(screen.getByText("Auto-execution paused by operator")).toBeDefined();

    // Approve All
    const approveBtn = screen.getByRole("button", { name: /Approve All/i });
    fireEvent.click(approveBtn);

    // HIL bar disappears after approval
    await waitFor(() => {
      expect(screen.queryByText(/Human-In-The-Loop \(HIL\) Staged Actions/i)).toBeNull();
    });
  });

  it("toggles Forensic Time-Machine History Replay scrubber", () => {
    render(<TacticalDispatchDashboard />);

    const replayBtn = screen.getByRole("button", { name: /History Replay/i });
    fireEvent.click(replayBtn);

    // Replay bar appears
    expect(screen.getByText("LIVE (T-0m)")).toBeDefined();
    expect(screen.getByRole("button", { name: "Anomaly (T-12m)" })).toBeDefined();

    // Click anomaly preset
    const anomalyBtn = screen.getByRole("button", { name: "Anomaly (T-12m)" });
    fireEvent.click(anomalyBtn);

    expect(screen.getByText(/Historical Replay: T-12m ago/)).toBeDefined();
  });

  it("triggers Forensic Audit Bundle export when button is clicked", () => {
    // Mock URL.createObjectURL and revokeObjectURL
    const createObjectURLMock = vi.fn().mockReturnValue("blob:mock-url");
    const revokeObjectURLMock = vi.fn();
    global.URL.createObjectURL = createObjectURLMock;
    global.URL.revokeObjectURL = revokeObjectURLMock;

    render(<TacticalDispatchDashboard />);

    const exportBtn = screen.getByRole("button", { name: /Export Bundle/i });
    expect(exportBtn).toBeDefined();
    fireEvent.click(exportBtn);

    expect(createObjectURLMock).toHaveBeenCalled();
    expect(revokeObjectURLMock).toHaveBeenCalled();
  });
});
