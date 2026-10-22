import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const state = vi.hoisted(() => ({ orgId: 7 as number | null, request: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: state.request }));
vi.mock("@domain-ui/core/ui/hooks/use-org-context", () => ({ useOrgContext: () => ({ selectedOrgId: state.orgId }) }));
import TimelineTab from "./TimelineTab";
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><TimelineTab mission={{ estimatedDuration: 2 }} run={{ id: 19 }} /></QueryClientProvider>);
}
describe("mission execution evidence", () => {
  beforeEach(() => { state.orgId = 7; state.request.mockReset(); });
  it("loads the selected run in the active organization and shows recorded approvals and computer-use steps", async () => {
    state.request.mockResolvedValue({ json: async () => ({ events: [
      { id: "approval:3", kind: "approval", title: "Review requested", timestamp: "2026-10-22T12:00:00Z", status: "pending", summary: "DEMO internal review" },
      { id: "step:4", kind: "computer_use", title: "Observed application state", timestamp: "2026-10-22T12:01:00Z", status: "completed" },
    ] }) });
    mount();
    expect(await screen.findByText("Review requested")).toBeInTheDocument();
    expect(screen.getByText("Observed application state")).toBeInTheDocument();
    expect(state.request.mock.calls[0][1]).toBe("/api/mission-runs/19/evidence-timeline?orgId=7&includePayloads=false&direction=desc");
    expect(screen.queryByText("Gantt chart would render here")).not.toBeInTheDocument();
  });
  it("does not request evidence when the organization is missing", () => {
    state.orgId = null; mount();
    expect(screen.getByText("Select a run in an organization to inspect its evidence.")).toBeInTheDocument();
    expect(state.request).not.toHaveBeenCalled();
  });
  it("reports a failed fetch instead of presenting it as empty evidence", async () => {
    state.request.mockRejectedValue(new Error("Unavailable")); mount();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded"));
    expect(screen.queryByText("No execution evidence has been recorded for this run.")).not.toBeInTheDocument();
  });
});
