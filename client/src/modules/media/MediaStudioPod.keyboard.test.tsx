import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MediaStudioPod } from "./MediaStudioPod";
import type { MediaShot } from "./types";

const shots: MediaShot[] = [
  { shotNumber: 1, sceneId: "SCENE-02", activeTakeIndex: 0, durationSeconds: 4, takes: [{ takeId: "a1", takeNumber: 1, prompt: "Wide", status: "approved", durationSeconds: 4, videoUrl: "/api/media-studio/assets/1" }] },
  { shotNumber: 2, sceneId: "SCENE-02", activeTakeIndex: 0, durationSeconds: 5, takes: [{ takeId: "b1", takeNumber: 1, prompt: "Close", status: "ready_for_review", durationSeconds: 5, videoUrl: "/api/media-studio/assets/2" }] },
  { shotNumber: 3, sceneId: "SCENE-02", activeTakeIndex: 0, durationSeconds: 5, takes: [] },
];

const inspector = () => within(screen.getByTestId("media-dailies-inspector"));
const press = (key: string, target: Element = document.body) => fireEvent.keyDown(target, { key });

describe("MediaStudioPod from the keyboard", () => {
  it("plays, moves between shots, approves and opens the re-shoot menu, and leaves keys typed into a field alone", () => {
    const onApproveTake = vi.fn();
    render(<MediaStudioPod sceneId="SCENE-02" sceneTitle="Archive" shots={shots} onApproveTake={onApproveTake} onRerollTake={vi.fn()} />);

    press(" ");
    expect(screen.getByTestId("stage-play-pause-btn")).toHaveAttribute("aria-label", "Pause");

    press("ArrowRight");
    expect(inspector().getByText("Shot 2")).toBeInTheDocument();
    press("y");
    expect(onApproveTake).toHaveBeenCalledWith("SCENE-02", 2, "b1");

    press("r");
    expect(screen.getByTestId("dailies-defect-menu")).toBeInTheDocument();
    press("y", screen.getByLabelText("What to change (optional)"));
    expect(onApproveTake).toHaveBeenCalledTimes(1);

    press("ArrowLeft");
    expect(inspector().getByText("Shot 1")).toBeInTheDocument();
    // Shot 1's take is already approved, so there is nothing to approve.
    press("y");
    expect(onApproveTake).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("dailies-approve-take-btn")).toHaveAttribute("title", "Only a take ready for review can be approved.");
  });

  it("steps a frame with Shift and an arrow, and goes full screen with F", () => {
    render(<MediaStudioPod sceneId="SCENE-02" sceneTitle="Archive" shots={shots} />);
    const stage = screen.getByTestId("media-stage-canvas");
    stage.requestFullscreen = vi.fn(async () => undefined);

    press("f");
    expect(stage.requestFullscreen).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: "ArrowRight", shiftKey: true });
    expect(screen.getByTestId("stage-timecode")).toHaveTextContent("00:00.04");
    expect(inspector().getByText("Shot 1")).toBeInTheDocument();
  });

  it("lists its shortcuts, goes to a shot it is told to, and offers the next step when a scene or shot is empty", () => {
    const onAddShot = vi.fn();
    const onOpenStoryboard = vi.fn();
    const onRequestTake = vi.fn();
    const { rerender } = render(<MediaStudioPod sceneId="SCENE-02" sceneTitle="Archive" shots={[]} onAddShot={onAddShot} onOpenStoryboard={onOpenStoryboard} />);
    expect(screen.getByTestId("media-studio-empty")).toHaveTextContent("A shot is one camera setup");
    fireEvent.click(screen.getByRole("button", { name: /Add a shot/ }));
    fireEvent.click(screen.getByRole("button", { name: "Make shots from the storyboard" }));
    expect(onAddShot).toHaveBeenCalledTimes(1);
    expect(onOpenStoryboard).toHaveBeenCalledTimes(1);

    rerender(<MediaStudioPod sceneId="SCENE-02" sceneTitle="Archive" shots={shots} onRequestTake={onRequestTake} focusShotNumber={3} />);
    expect(inspector().getByText("Shot 3")).toBeInTheDocument();
    expect(screen.getByTestId("dailies-no-takes")).toHaveTextContent("A live take waits for your approval");
    fireEvent.click(screen.getByTestId("dailies-request-take-btn"));
    expect(onRequestTake).toHaveBeenCalledWith("SCENE-02", 3);

    fireEvent.click(screen.getByTestId("media-shortcuts-btn"));
    expect(screen.getByTestId("media-shortcuts")).toHaveTextContent("Approve the take on screen");
  });
});
