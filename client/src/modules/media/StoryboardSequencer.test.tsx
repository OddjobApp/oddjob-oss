import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StoryboardSequencer } from "./StoryboardSequencer";
import { keyframe, plotPoint, production, scene, shot } from "./fixtures";

const board = production({
  spendCents: 8,
  scenes: [scene({
    id: 21,
    plotPoints: [
      plotPoint({ id: 11, title: "She sees the drone", keyframes: [keyframe({ id: 41, status: "ready", isSelected: true }), keyframe({ id: 42, status: "ready", isSelected: false, imageUrl: "/api/media-studio/assets/2" })] }),
      plotPoint({ id: 12, title: "She runs", beat: "", keyframes: [keyframe({ id: 43, status: "rendering", imageUrl: null, isSelected: false })] }),
      plotPoint({ id: 13, title: "The door", beat: "", keyframes: [keyframe({ id: 44, status: "failed", imageUrl: null, isSelected: false, error: "Gemini returned 429: quota" })] }),
    ],
    shots: [shot({ plotPointId: 13 })],
  })],
});

const renderBoard = (act = vi.fn(async () => board), onExport = vi.fn(async () => {})) => {
  render(<StoryboardSequencer production={board} act={act} onExport={onExport} />);
  return { act, onExport };
};

describe("StoryboardSequencer", () => {
  it("shows each plot point with the keyframe it shows, what is rendering, and why a render failed", () => {
    renderBoard();
    expect(screen.getByTestId("storyboard-spend")).toHaveTextContent("Spent $0.08 of $25.00");
    expect(screen.getByRole("img", { name: "Keyframe for She sees the drone" })).toHaveAttribute("src", "/api/media-studio/assets/1");
    expect(screen.getByTestId("slide-frame-note-12")).toHaveTextContent("Rendering keyframe…");
    expect(within(screen.getByTestId("plot-point-slide-12")).getByRole("button", { name: /Render keyframe/ })).toBeDisabled();
    expect(screen.getByTestId("slide-failure-13")).toHaveTextContent("Last render failed: Gemini returned 429: quota");
    expect(within(screen.getByTestId("plot-point-slide-13")).getByRole("button", { name: /Shot made/ })).toBeDisabled();
  });

  it("renders a keyframe with the author's prompt, or with none", async () => {
    const { act } = renderBoard();
    const slide = within(screen.getByTestId("plot-point-slide-11"));
    fireEvent.change(slide.getByLabelText("Keyframe prompt (optional)"), { target: { value: " Wide on the parapet " } });
    fireEvent.click(slide.getByRole("button", { name: /Render keyframe/ }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("POST", "/api/media-studio/plot-points/11/keyframes", { prompt: "Wide on the parapet" }));

    fireEvent.click(within(screen.getByTestId("plot-point-slide-13")).getByRole("button", { name: /Render keyframe/ }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("POST", "/api/media-studio/plot-points/13/keyframes", {}));
  });

  it("shows another keyframe, approves or rejects the one shown, and makes a shot", async () => {
    const { act } = renderBoard();
    const slide = within(screen.getByTestId("plot-point-slide-11"));
    fireEvent.click(slide.getByRole("button", { name: "Show keyframe 2" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("POST", "/api/media-studio/keyframes/42/select"));
    fireEvent.click(slide.getByRole("button", { name: /Approve/ }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("POST", "/api/media-studio/keyframes/41/approve"));
    fireEvent.click(slide.getByRole("button", { name: /Reject/ }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("POST", "/api/media-studio/keyframes/41/reject"));
    fireEvent.click(slide.getByRole("button", { name: /Make shot/ }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("POST", "/api/media-studio/plot-points/11/shot"));
  });

  it("reorders plot points, edits one, and adds one", async () => {
    const { act } = renderBoard();
    expect(screen.getByRole("button", { name: 'Move "She sees the drone" earlier' })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: 'Move "She sees the drone" later' }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("PUT", "/api/media-studio/scenes/21/plot-points/order", { ids: [12, 11, 13] }));

    fireEvent.click(screen.getByRole("button", { name: 'Edit "She runs"' }));
    fireEvent.change(screen.getByLabelText("Beat"), { target: { value: "Elena sprints for the stairwell." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("PATCH", "/api/media-studio/plot-points/12", { title: "She runs", beat: "Elena sprints for the stairwell." }));

    fireEvent.change(screen.getByLabelText("New plot point in SCENE-01"), { target: { value: "The door gives" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("POST", "/api/media-studio/scenes/21/plot-points", { title: "The door gives" }));
  });

  it("says what went wrong when a change is refused, and exports the deck", async () => {
    const act = vi.fn(async () => { throw new Error("This keyframe would take Rooftop chase past its budget."); });
    const { onExport } = renderBoard(act);
    fireEvent.click(within(screen.getByTestId("plot-point-slide-11")).getByRole("button", { name: /Render keyframe/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This keyframe would take Rooftop chase past its budget.");

    fireEvent.click(screen.getByRole("button", { name: /Export to PowerPoint/ }));
    await waitFor(() => expect(onExport).toHaveBeenCalled());
  });
});
