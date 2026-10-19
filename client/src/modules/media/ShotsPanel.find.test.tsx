import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@domain-ui/core/ui/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import { ShotsPanel } from "./ShotsPanel";
import { production, scene, shot, take } from "./fixtures";

/**
 * The panel is a shot list beside one open editor: every other editor is
 * rendered `hidden`, so it is correctly absent from the accessibility tree
 * until its shot is chosen. Tests reaching a shot's controls have to open it
 * first, exactly as a reader would.
 */
const openShot = (n: number) =>
  fireEvent.click(within(screen.getByRole("navigation", { name: "Shot list" })).getAllByRole("button")[n - 1]);

describe("finding, duplicating and pricing shots", () => {
  const view = production({
    scenes: [
      scene({
        id: 21,
        shots: [
          shot({ id: 31, prompt: "Elena crouches behind the parapet", takes: [take({ id: 51, status: "approved", costCents: 152 })] }),
          shot({
            id: 32, prompt: "Wide on the stairwell", dialogue: [{ speaker: "Marco", line: "Down here." }],
            takes: [take({ id: 52, status: "ready_for_review", costCents: 152 }), take({ id: 53, takeNumber: 2, status: "pending_approval", costCents: 152 })],
          }),
        ],
      }),
      scene({ id: 22, sceneKey: "SCENE-02", title: "The chase", shots: [shot({ id: 33, prompt: "She runs", takes: [take({ id: 54, status: "approved", costCents: 91 })] })] }),
    ],
  });

  beforeEach(() => {
    toast.mockReset();
  });

  it("searches direction and dialogue, filters by status and by scenes that need a decision, and says what it hides", () => {
    render(<ShotsPanel production={view} act={vi.fn()} />);
    const search = screen.getByLabelText("Search shots");

    fireEvent.change(search, { target: { value: "marco" } });
    expect(screen.getByTestId("shots-filter-count")).toHaveTextContent("Showing 1 of 3 shots.");
    expect(within(screen.getByTestId("shot-editor-32")).getByText("Shot 2")).toBeInTheDocument();
    expect(screen.queryByTestId("shot-editor-31")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Shots in SCENE-02" })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "unapproved" } });
    expect(screen.getByTestId("shots-filter-count")).toHaveTextContent("Showing 1 of 3 shots.");
    fireEvent.change(screen.getByLabelText("Show"), { target: { value: "all" } });
    fireEvent.click(screen.getByLabelText("Only scenes that need a decision"));
    expect(screen.queryByTestId("shot-editor-33")).not.toBeInTheDocument();
    expect(screen.getByTestId("shot-editor-31")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "helicopter" } });
    expect(screen.getByTestId("shots-no-match")).toHaveTextContent("No shots match");
    fireEvent.click(screen.getByRole("button", { name: "Show all shots" }));
    expect(screen.getByTestId("shot-editor-33")).toBeInTheDocument();
    expect(screen.queryByTestId("shots-filter-count")).not.toBeInTheDocument();
  });

  it("shows each shot's status and spend, duplicates a saved shot, and confirms a take asked for", async () => {
    const act = vi.fn().mockResolvedValue(view);
    render(<ShotsPanel production={view} act={act} />);
    openShot(2);
    const second = screen.getByTestId("shot-editor-32");
    expect(within(second).getByTestId("shot-status-32")).toHaveTextContent("Ready for review");
    expect(within(second).getByTestId("shot-spend-32")).toHaveTextContent("$1.52 spent on this shot; $1.52 more if the take waiting for approval is approved.");

    fireEvent.click(within(second).getByRole("button", { name: "Duplicate shot 2" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("POST", "/api/media-studio/shots/32/duplicate"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Duplicated shot 2", description: "The copy is shot 3, with the same direction and dialogue and no takes." }));

    // Back to shot 1: its editor is hidden while shot 2 is the one open.
    openShot(1);
    fireEvent.click(within(screen.getByTestId("shot-editor-31")).getByRole("button", { name: /^Ask for a take/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({
      title: "Asked for a take of SCENE-01 shot 1",
      description: "It waits for approval in the Decision Inbox before anything renders.",
    }));

    openShot(2);
    fireEvent.change(within(second).getByLabelText("Action"), { target: { value: "Marco waves" } });
    expect(within(second).getByRole("button", { name: "Duplicate shot 2" })).toBeDisabled();
  });
});
