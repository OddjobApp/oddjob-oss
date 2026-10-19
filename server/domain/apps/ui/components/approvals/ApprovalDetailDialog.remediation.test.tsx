import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn(async () => ({})) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest }));

vi.mock("@domain-ui/core/ui/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { ApprovalDetailDialog } from "./ApprovalDetailDialog";

// Shape produced by SwissCheeseGuardrailService.generateRemediationChips for a
// Layer 2 block, copied from the service rather than invented here.
const layer2Chips = [
  {
    id: "request_rbac_override",
    label: "Request Admin Scope Grant",
    actionType: "request_override" as const,
    description: "Submit a 1-click privilege elevation request to the compliance officer.",
  },
  {
    id: "downgrade_to_readonly",
    label: "Downgrade to Read-Only",
    actionType: "downgrade_scope" as const,
    description: "Execute step using safe read-only introspection without state mutation.",
  },
];

function buildApproval(overrides: Record<string, unknown> = {}) {
  return {
    id: 4471,
    pipelineName: "DEPLOY",
    stepName: "restart-service",
    createdAt: new Date("2026-08-25T10:00:00Z").toISOString(),
    pipelineExecutionId: 9,
    contextSnapshot: {
      blockedAtLayer: 2,
      blockedLayerName: "Policy & Capability Pre-Execution RBAC",
      overallRiskScore: 82,
      remediationChips: layer2Chips,
    },
    ...overrides,
  } as any;
}

function renderDialog(approval: any, onDecision = vi.fn()) {
  render(
    <ApprovalDetailDialog approval={approval} open onOpenChange={vi.fn()} onDecision={onDecision} />
  );
  return onDecision;
}

describe("ApprovalDetailDialog guardrail remediation", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("renders the guardrail verdict and one control per remediation", () => {
    renderDialog(buildApproval());

    expect(screen.getByTestId("guardrail-remediation")).toBeTruthy();
    expect(screen.getByText(/Blocked at Layer 2/)).toBeTruthy();
    expect(screen.getByText("Risk 82/100")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Request Admin Scope Grant/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Downgrade to Read-Only/ })).toBeTruthy();
  });

  it("records which remediation was chosen, not just that it was approved", async () => {
    const onDecision = renderDialog(buildApproval());

    fireEvent.click(screen.getByRole("button", { name: /Downgrade to Read-Only/ }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
    const [method, url, payload] = apiRequest.mock.calls[0] as any[];
    expect(method).toBe("POST");
    expect(url).toBe("/api/approvals/4471/decision");
    expect(payload.decision).toBe("approved");
    expect(payload.comments).toContain("Downgrade to Read-Only");
    expect(payload.modifiedOutput.appliedRemediation).toEqual(layer2Chips[1]);
    expect(onDecision).toHaveBeenCalled();
  });

  it("distinguishes the two chips — the other one sends a different payload", async () => {
    renderDialog(buildApproval());

    fireEvent.click(screen.getByRole("button", { name: /Request Admin Scope Grant/ }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
    const payload = (apiRequest.mock.calls[0] as any[])[2];
    expect(payload.modifiedOutput.appliedRemediation).toEqual(layer2Chips[0]);
    expect(payload.comments).toContain("Request Admin Scope Grant");
  });

  it("preserves the rest of the context snapshot alongside the remediation", async () => {
    renderDialog(buildApproval());

    fireEvent.click(screen.getByRole("button", { name: /Downgrade to Read-Only/ }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
    const payload = (apiRequest.mock.calls[0] as any[])[2];
    expect(payload.modifiedOutput.blockedAtLayer).toBe(2);
    expect(payload.modifiedOutput.overallRiskScore).toBe(82);
  });

  it("renders nothing for an approval the guardrail never blocked", () => {
    renderDialog(buildApproval({ contextSnapshot: { tool: "send_email", risk: "low" } }));

    expect(screen.queryByTestId("guardrail-remediation")).toBeNull();
  });

  it("ignores malformed chips rather than rendering empty controls", () => {
    renderDialog(
      buildApproval({
        contextSnapshot: { remediationChips: [{ nope: true }, null, layer2Chips[0]] },
      })
    );

    expect(screen.getAllByRole("button", { name: /Request Admin Scope Grant/ })).toHaveLength(1);
    expect(screen.getByTestId("guardrail-remediation")).toBeTruthy();
  });

  it("surfaces an already-applied remediation and stops re-deciding", () => {
    renderDialog(
      buildApproval({
        status: "approved",
        contextSnapshot: {
          ...buildApproval().contextSnapshot,
          appliedRemediation: layer2Chips[1],
        },
      })
    );

    expect(screen.getByTestId("applied-remediation").textContent).toContain("Downgrade to Read-Only");
    expect(screen.getByRole("button", { name: /Downgrade to Read-Only/ })).toHaveProperty("disabled", true);
  });
});
