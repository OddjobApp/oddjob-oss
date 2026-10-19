import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgoraDeliberationBriefing } from "./AgoraDeliberationBriefing";

const h = vi.hoisted(() => ({
  api: vi.fn(), toast: vi.fn(), status: "pending", failRead: false, failDecision: false,
}));
vi.mock("@/lib/queryClient", () => ({ apiRequest: h.api }));
vi.mock("@domain-ui/core/ui/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@domain-ui/agora/ui/AgoraCanvas", () => ({ AgoraCanvas: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  h.status = "pending";
  h.failRead = false;
  h.failDecision = false;
  h.api.mockImplementation(async (method, url, body) => {
    if (method === "GET" && url === "/api/approvals/519") {
      if (h.failRead) throw new Error("Approval request not found");
      return { json: async () => ({ id: 519, status: h.status, stepName: "Render scene" }) };
    }
    if (method === "POST" && url === "/api/approvals/519/decision") {
      if (h.failDecision) throw new Error("Permission denied");
      h.status = body.decision;
      return { json: async () => ({ status: h.status }) };
    }
    throw new Error(`Unexpected request ${method} ${url}`);
  });
});
afterEach(cleanup);

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const onResolved = vi.fn();
  render(<QueryClientProvider client={client}><AgoraDeliberationBriefing approvalId={519} onResolved={onResolved} /></QueryClientProvider>);
  return onResolved;
}

describe("Agora approval decisions", () => {
  it.each([
    ["Authorize Execution", "approved"],
    ["Reject with Directives", "rejected"],
  ])("%s submits the server's decision contract with directives", async (button, decision) => {
    const onResolved = mount();
    const action = await screen.findByRole("button", { name: button });
    fireEvent.change(screen.getByPlaceholderText("Optional directives or modifications for the lead agent..."), { target: { value: "Keep the previous take" } });
    fireEvent.click(action);
    await waitFor(() => expect(h.api).toHaveBeenCalledWith("POST", "/api/approvals/519/decision", { decision, comments: "Keep the previous take" }));
    await waitFor(() => expect(onResolved).toHaveBeenCalledOnce());
    expect(await screen.findByText(`Resolved (${decision})`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Authorize Execution" })).not.toBeInTheDocument();
  });

  it("loads an already-resolved decision directly rather than relying on the pending inbox", async () => {
    h.status = "approved";
    mount();
    expect(await screen.findByText("Resolved (approved)")).toBeInTheDocument();
    expect(h.api).toHaveBeenCalledWith("GET", "/api/approvals/519");
    expect(screen.queryByRole("button", { name: "Authorize Execution" })).not.toBeInTheDocument();
  });

  it("does not offer authorization when the approval cannot be loaded", async () => {
    h.failRead = true;
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load this approval");
    expect(screen.queryByRole("button", { name: "Authorize Execution" })).not.toBeInTheDocument();
  });

  it("surfaces a rejected authorization request without reporting success", async () => {
    h.failDecision = true;
    const onResolved = mount();
    fireEvent.click(await screen.findByRole("button", { name: "Authorize Execution" }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Authorization Failed", description: "Permission denied" })));
    expect(onResolved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Authorize Execution" })).toBeInTheDocument();
  });
});
