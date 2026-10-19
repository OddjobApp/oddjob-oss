import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { useQuery } = vi.hoisted(() => ({ useQuery: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery }));

vi.mock("@domain-ui/core/ui/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));
vi.mock("@domain-ui/apps/ui/components/approvals/ApprovalDetailDialog", () => ({
  ApprovalDetailDialog: () => null,
}));
vi.mock("@domain-ui/rescue/ui/modules/rescue/components/TriageCenter", () => ({
  TriageCenter: () => null,
}));

import { DecisionInbox } from "./DecisionInbox";

function approval(id: number, cycleId: number | null) {
  return {
    id,
    pipelineName: `PIPE_${id}`,
    stepName: `step-${id}`,
    createdAt: new Date("2026-08-25T10:00:00Z").toISOString(),
    contextSnapshot: {},
    pipelineExecutionId: id,
    cycleId,
  };
}

function seed(approvals: ReturnType<typeof approval>[]) {
  useQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "/api/approvals") {
      return { data: approvals, isLoading: false, refetch: vi.fn() };
    }
    return { data: [], isLoading: false, refetch: vi.fn() };
  });
}

describe("DecisionInbox cycle scoping", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("shows only this cycle's approvals and counts the rest", () => {
    seed([approval(1, 42), approval(2, 99), approval(3, 42), approval(4, null)]);

    render(<DecisionInbox embedded cycleId={42} />);

    expect(screen.getByText("PIPE_1")).toBeTruthy();
    expect(screen.getByText("PIPE_3")).toBeTruthy();
    expect(screen.queryByText("PIPE_2")).toBeNull();
    expect(screen.queryByText("PIPE_4")).toBeNull();

    // The filtered-out work is disclosed, not silently dropped.
    expect(screen.getByTestId("approvals-elsewhere-note").textContent).toContain("2 more pending");
  });

  it("shows everything and no note when there is no cycle to scope to", () => {
    seed([approval(1, 42), approval(2, 99)]);

    render(<DecisionInbox embedded cycleId={null} />);

    expect(screen.getByText("PIPE_1")).toBeTruthy();
    expect(screen.getByText("PIPE_2")).toBeTruthy();
    expect(screen.queryByTestId("approvals-elsewhere-note")).toBeNull();
  });

  it("reports an empty queue for a cycle whose approvals all belong elsewhere", () => {
    seed([approval(1, 99), approval(2, 99)]);

    render(<DecisionInbox embedded cycleId={42} />);

    expect(screen.queryByText("PIPE_1")).toBeNull();
    expect(screen.getByTestId("approvals-elsewhere-note").textContent).toContain("2 more pending");
  });

  it("drops the page chrome when embedded", () => {
    seed([approval(1, 42)]);

    const { container } = render(<DecisionInbox embedded cycleId={42} />);

    expect(container.querySelector("header")).toBeNull();
    expect(container.querySelector(".min-h-screen")).toBeNull();
  });

  it("keeps the page chrome when rendered as a full page", () => {
    seed([approval(1, 42)]);

    const { container } = render(<DecisionInbox />);

    expect(container.querySelector("header")).toBeTruthy();
  });
});
