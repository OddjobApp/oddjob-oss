import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest }));
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@domain-ui/core/ui/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
// Handles need a React Flow canvas around them; the node's own behaviour does not.
vi.mock("reactflow", async (importOriginal) => ({ ...(await importOriginal<typeof import("reactflow")>()), Handle: () => null }));

import { OperationalWorkflowNode, type OperationalWorkflowNodeData } from "./OperationalWorkflowNode";

function renderNode(data: OperationalWorkflowNodeData) {
  const props = { id: "n1", data, selected: false, type: "operationalWorkflow", xPos: 0, yPos: 0, zIndex: 0, isConnectable: true, dragging: false } as any;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <OperationalWorkflowNode {...props} />
    </QueryClientProvider>,
  );
}

const slack: OperationalWorkflowNodeData = { id: 42, name: "Slack Channel Alert", kind: "saas", category: "messaging", target: "slack_post_message", status: "idle" };

describe("OperationalWorkflowNode", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("asks for approval instead of running, and shows that it is waiting", async () => {
    apiRequest.mockResolvedValue({ json: async () => ({ status: "pending_approval", approvalId: 7, alreadyPending: false }) });
    renderNode(slack);

    fireEvent.click(screen.getByRole("button", { name: /request run/i }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Awaiting approval"));
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/workflow-nodes/42/run", {});
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Sent for approval" }));
    expect(screen.getByRole("button", { name: /request run/i })).toBeDisabled();
  });

  it("says why a run could not be requested", async () => {
    apiRequest.mockRejectedValue(new Error('"Jira Issue Dispatch" runs jira_create_issue, and this platform has no tool by that name, so there is nothing to approve.'));
    renderNode({ ...slack, name: "Jira Issue Dispatch", target: "jira_create_issue" });
    fireEvent.click(screen.getByRole("button", { name: /request run/i }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Not sent for approval", variant: "destructive" })));
  });

  it("cannot run a node that was not saved, and a scaffold pack has no run at all", () => {
    const { unmount } = renderNode({ ...slack, id: "op-1757", status: "error" });
    expect(screen.getByRole("button", { name: /request run/i })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Not saved");
    unmount();
    renderNode({ id: 9, name: "Node Express Core", kind: "scaffold_pack", target: "core-node-express" });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows how the last run went, and asks a review gate for sign-off", () => {
    const { unmount } = renderNode({ ...slack, status: "failed", lastRun: { approvalId: 7, error: "Error: channel not found" } });
    expect(screen.getByRole("status")).toHaveTextContent("Failed");
    expect(screen.getByText("Error: channel not found")).toBeInTheDocument();
    unmount();
    renderNode({ id: 11, name: "HIL Human Review Gate", kind: "hil_gate", target: "hil_approval_request", status: "success" });
    expect(screen.getByRole("status")).toHaveTextContent("Signed off");
    expect(screen.getByRole("button", { name: /request sign-off/i })).toBeInTheDocument();
  });
});
