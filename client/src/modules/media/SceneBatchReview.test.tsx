import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest }));

import { SceneBatchReview } from "./SceneBatchReview";
import { production, scene, shot, take } from "./fixtures";

const ok = (body: unknown) => ({ ok: true, json: async () => body });

const film = scene({
  id: 21,
  shots: [
    shot({ id: 31, durationSeconds: 5, takes: [take({ id: 51, takeNumber: 1, status: "ready_for_review" }), take({ id: 52, takeNumber: 2, status: "ready_for_review" })] }),
    shot({ id: 32, durationSeconds: 5, takes: [take({ id: 61, takeNumber: 1, status: "approved" })] }),
  ],
});
const view = production({ scenes: [film] });

function renderBatch(history = { record: vi.fn() } as any) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SceneBatchReview production={view} scene={film} history={history} send={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Review several takes/ }));
  return history;
}

describe("SceneBatchReview", () => {
  beforeEach(() => {
    apiRequest.mockReset();
  });

  it("approves the selected takes at once, says how each went, and records one undo for what went through", async () => {
    apiRequest.mockResolvedValue(ok({ production: view, results: [{ takeId: 51, ok: true }, { takeId: 999, ok: false, error: "Take not found." }] }));
    const history = renderBatch();

    fireEvent.click(screen.getByLabelText("Shot 1, take 1"));
    fireEvent.click(screen.getByLabelText("Shot 1, take 2"));
    expect(screen.getByText(/Shot 1 has more than one take selected/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve selected (2)" })).toBeDisabled();

    fireEvent.click(screen.getByLabelText("Shot 1, take 2"));
    fireEvent.click(screen.getByRole("button", { name: "Approve selected (1)" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("POST", "/api/media-studio/scenes/21/takes/approve", { takeIds: [51] }));
    expect(await screen.findByTestId("scene-batch-outcome-21")).toHaveTextContent("Approved 1 of 2. Undo takes all of them back.");
    expect(screen.getByTestId("scene-batch-outcome-21")).toHaveTextContent("Take not found. It may have been deleted");
    expect(history.record).toHaveBeenCalledWith(expect.objectContaining({ label: "Approved take 1 of SCENE-01 shot 1" }));
  });

  it("re-shoots the selected shots with what was wrong, and shows the cost of asking", async () => {
    apiRequest.mockResolvedValue(ok({ production: view, results: [{ takeId: 61, ok: true, newTakeId: 62 }] }));
    const history = renderBatch();

    fireEvent.click(screen.getByLabelText(/Shot 2, take 1/));
    expect(screen.getByText(/about \$1\.52 for this one at 720p/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("What was wrong (optional)"), { target: { value: "wrong_framing" } });
    fireEvent.change(screen.getByLabelText("What to change (optional)"), { target: { value: " tighter " } });
    fireEvent.click(screen.getByRole("button", { name: "Re-shoot selected (1)" }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("POST", "/api/media-studio/scenes/21/takes/reshoot", {
      items: [{ takeId: 61, defectClass: "wrong_framing", notes: "tighter" }],
    }));
    expect(history.record).toHaveBeenCalledWith(expect.objectContaining({ label: "Asked to re-shoot SCENE-01 shot 2" }));
  });

  it("explains a failed request with what to do", async () => {
    apiRequest.mockRejectedValue(new TypeError("Failed to fetch"));
    renderBatch();
    fireEvent.click(screen.getByLabelText("Select all ready for review"));
    expect(screen.getByRole("button", { name: "Approve selected (2)" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Shot 1, take 2"));
    fireEvent.click(screen.getByRole("button", { name: "Approve selected (1)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The server did not answer.");
  });
});
