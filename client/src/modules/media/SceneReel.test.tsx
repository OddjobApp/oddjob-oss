import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SceneReel } from "./SceneReel";
import { assembly, production, scene, shot, take } from "./fixtures";

const approved = (id: number, videoUrl: string | null = `/api/media-studio/assets/${id}`) => take({ id, status: "approved", videoUrl });

describe("SceneReel", () => {
  it("says which shots keep the scene from being assembled", () => {
    const blocked = scene({ shots: [shot({ id: 31, takes: [approved(51)] }), shot({ id: 32, takes: [take({ id: 52, status: "ready_for_review" })] }), shot({ id: 33 })] });
    const { rerender } = render(<SceneReel scene={blocked} act={vi.fn()} />);
    expect(screen.getByTestId("reel-problem-21")).toHaveTextContent("Shots 2 and 3 have no approved take. Approve a take of every shot before assembling SCENE-01.");
    expect(screen.getByRole("button", { name: "Assemble reel" })).toBeDisabled();

    rerender(<SceneReel scene={scene({ shots: [shot({ takes: [approved(51, null)] })] })} act={vi.fn()} />);
    expect(screen.getByTestId("reel-problem-21")).toHaveTextContent("Shot 1 has an approved take with no video. Approve a rendered take instead.");
    rerender(<SceneReel scene={scene()} act={vi.fn()} />);
    expect(screen.getByTestId("reel-problem-21")).toHaveTextContent("SCENE-01 has no shots to assemble.");
  });

  it("assembles a scene whose shots all have an approved take with video", async () => {
    const act = vi.fn(async () => production());
    render(<SceneReel scene={scene({ shots: [shot({ id: 31, takes: [approved(51)] })] })} act={act} />);
    expect(screen.queryByTestId("reel-problem-21")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Assemble reel" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("POST", "/api/media-studio/scenes/21/assemble"));
  });

  it("says when the approved takes have changed since the reel was cut", () => {
    render(<SceneReel scene={scene({ shots: [shot({ takes: [approved(51)] })], assembly: assembly({ current: false }) })} act={vi.fn()} />);
    // The player and the cut's own state live in the viewer's Reel mode; what stays here
    // is the reason to cut again, and the button that does it.
    expect(screen.queryByTestId("reel-video-21")).not.toBeInTheDocument();
    expect(screen.getByTestId("reel-state-21")).toHaveTextContent("The approved takes or transitions have changed since this reel was cut.");
    expect(screen.getByRole("button", { name: "Assemble again" })).toBeEnabled();
  });

  it("disables cutting while a cut is under way, and leaves reporting it to the viewer", () => {
    const ready = [shot({ takes: [approved(51)] })];
    const { rerender } = render(<SceneReel scene={scene({ shots: ready, assembly: assembly({ status: "assembling", reelUrl: null }) })} act={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Assembling/ })).toBeDisabled();
    // Progress and failure are said once, in the viewer's Reel mode — see
    // MediaProgramViewer — rather than in both places at once.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    rerender(<SceneReel scene={scene({ shots: ready, assembly: assembly({ status: "failed", reelUrl: null, error: "ffmpeg failed (exit 1): Invalid data found" }) })} act={vi.fn()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assemble reel" })).toBeEnabled();
    expect(screen.queryByTestId("reel-video-21")).not.toBeInTheDocument();
  });
});
