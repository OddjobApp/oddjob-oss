import React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { MediaStudioPod } from "./MediaStudioPod";
import type { MediaShot } from "./types";

afterEach(() => {
  vi.useRealTimers();
});

// A scene with video: shot 2 is a simulation, shot 3 has an approved take and a later one under review.
const filmed: MediaShot[] = [
  { shotNumber: 1, sceneId: "SCENE-02", activeTakeIndex: 0, durationSeconds: 4, takes: [{ takeId: "a1", takeNumber: 1, prompt: "Wide", status: "approved", durationSeconds: 4, videoUrl: "/api/media-studio/assets/1" }] },
  { shotNumber: 2, sceneId: "SCENE-02", activeTakeIndex: 0, durationSeconds: 3, takes: [{ takeId: "b1", takeNumber: 1, prompt: "Close on the cylinder", status: "simulated", durationSeconds: 3 }] },
  {
    shotNumber: 3, sceneId: "SCENE-02", activeTakeIndex: 0, durationSeconds: 5,
    takes: [
      { takeId: "c1", takeNumber: 1, prompt: "Glyphs light up", status: "approved", durationSeconds: 5, videoUrl: "/api/media-studio/assets/3" },
      { takeId: "c2", takeNumber: 2, prompt: "Glyphs light up, slower", status: "ready_for_review", durationSeconds: 5, videoUrl: "/api/media-studio/assets/4" },
    ],
  },
];

const shots: MediaShot[] = [
  {
    shotNumber: 1, sceneId: "SCENE-02", activeTakeIndex: 0, durationSeconds: 4, transition: "crossfade",
    takes: [{ takeId: "t1", takeNumber: 1, prompt: "Wide shot of the archive", status: "approved", durationSeconds: 4 }],
  },
  {
    shotNumber: 2, sceneId: "SCENE-02", activeTakeIndex: 1, durationSeconds: 5,
    takes: [
      { takeId: "t2a", takeNumber: 1, prompt: "Close on the cylinder", status: "rejected", durationSeconds: 5, defectClass: "wrong_framing", notes: "too loose" },
      { takeId: "t2b", takeNumber: 2, prompt: "Close on the cylinder, tighter", status: "ready_for_review", durationSeconds: 5 },
    ],
  },
  {
    shotNumber: 3, sceneId: "SCENE-02", activeTakeIndex: 0, durationSeconds: 3,
    takes: [{ takeId: "t3", takeNumber: 1, prompt: "Glyphs light up", status: "simulated", durationSeconds: 3 }],
  },
];

const inspector = () => within(screen.getByTestId("media-dailies-inspector"));

describe("MediaStudioPod", () => {
  it("shows an empty scene as empty, and invents nothing to fill it", () => {
    render(<MediaStudioPod sceneId="SCENE-02" sceneTitle="The Neon Archive" aspectRatio="2.39:1" />);

    expect(screen.getByText("The Neon Archive")).toBeInTheDocument();
    expect(screen.getByTestId("media-aspect-ratio")).toHaveTextContent("2.39:1");
    expect(screen.getByTestId("media-studio-empty")).toHaveTextContent("No shots in this scene yet");
    expect(screen.queryByTestId("media-timeline-sequencer")).not.toBeInTheDocument();
    expect(screen.queryByText(/neon alleyway|Elena|CPM Wave|active renders|Score Bed|Ambience Bed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("mode-deck-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("assemble-master-reel-btn")).not.toBeInTheDocument();
  });

  it("shows the scene's shots, with the scene's take for each", () => {
    render(<MediaStudioPod sceneId="SCENE-02" sceneTitle="Archive" shots={shots} />);

    expect(inspector().getByText("Shot 1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("timeline-shot-clip-2"));
    expect(inspector().getByText("Shot 2")).toBeInTheDocument();
    expect(screen.getByTestId("take-selector-tab-2")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("stage-take-status")).toHaveTextContent("Ready for review · Take 2");

    fireEvent.click(screen.getByTestId("take-selector-tab-1"));
    expect(screen.getByTestId("stage-take-status")).toHaveTextContent("Rejected · Take 1");
    expect(inspector().getByText(/Wrong framing or lens/)).toBeInTheDocument();
  });

  it("says a simulated take has no video, and offers nothing to play", () => {
    render(<MediaStudioPod sceneId="SCENE-02" sceneTitle="Archive" shots={shots} />);
    fireEvent.click(screen.getByTestId("timeline-shot-clip-3"));
    expect(screen.getByTestId("stage-no-video")).toHaveTextContent("Simulated take: no video was generated.");
    expect(screen.getByTestId("stage-play-pause-btn")).toBeDisabled();
  });

  it("plays through the scene on one clock: a finished take hands on to the next shot, and a shot with no video keeps its length", () => {
    vi.useFakeTimers();
    render(<MediaStudioPod sceneId="SCENE-02" sceneTitle="Archive" shots={filmed} />);
    const play = screen.getByTestId("stage-play-pause-btn");
    fireEvent.click(play);
    expect(play).toHaveAttribute("aria-label", "Pause");

    fireEvent.ended(screen.getByTestId("stage-video"));
    expect(inspector().getByText("Shot 2")).toBeInTheDocument();
    expect(screen.getByTestId("stage-no-video")).toHaveTextContent("Simulated take: no video was generated.");
    expect(screen.getByTestId("stage-play-pause-btn")).toHaveAttribute("aria-label", "Pause");

    act(() => { vi.advanceTimersByTime(1500); });
    expect(inspector().getByText("Shot 2")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1700); });
    expect(inspector().getByText("Shot 3")).toBeInTheDocument();
    expect(screen.getByTestId("stage-video")).toHaveAttribute("src", "/api/media-studio/assets/3");

    fireEvent.ended(screen.getByTestId("stage-video"));
    expect(inspector().getByText("Shot 3")).toBeInTheDocument();
    expect(screen.getByTestId("stage-play-pause-btn")).toHaveAttribute("aria-label", "Play");
  });

  it("compares a take with another take of the shot, preferring the approved one", () => {
    render(<MediaStudioPod sceneId="SCENE-02" sceneTitle="Archive" shots={filmed} />);
    expect(screen.queryByTestId("stage-ab-compare-btn")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("timeline-shot-clip-3"));
    expect(screen.getByTestId("stage-ab-compare-btn")).toHaveTextContent("Compare with take 2");
    fireEvent.click(screen.getByTestId("take-selector-tab-2"));
    fireEvent.click(screen.getByTestId("stage-ab-compare-btn"));
    expect(screen.getByTestId("stage-ab-compare-btn")).toHaveTextContent("Compare with take 1");
    expect(screen.getByTestId("stage-compare-video")).toHaveAttribute("src", "/api/media-studio/assets/3");
    expect(screen.getByTestId("stage-video")).toHaveAttribute("src", "/api/media-studio/assets/4");
  });

  it("sends the take on screen to the chat through its handler", () => {
    const onDiscussTake = vi.fn();
    const { rerender } = render(<MediaStudioPod sceneId="SCENE-02" sceneTitle="Archive" shots={filmed} />);
    expect(screen.queryByTestId("dailies-discuss-take-btn")).not.toBeInTheDocument();

    rerender(<MediaStudioPod sceneId="SCENE-02" sceneTitle="Archive" shots={filmed} onDiscussTake={onDiscussTake} />);
    fireEvent.click(screen.getByTestId("timeline-shot-clip-3"));
    fireEvent.click(screen.getByRole("button", { name: "Discuss take 1 in chat" }));
    expect(onDiscussTake).toHaveBeenCalledWith("SCENE-02", 3, "c1");
  });

  it("offers no review actions when nothing handles them", () => {
    render(<MediaStudioPod sceneId="SCENE-02" sceneTitle="Archive" shots={shots} />);
    fireEvent.click(screen.getByTestId("timeline-shot-clip-2"));
    expect(screen.queryByTestId("dailies-approve-take-btn")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dailies-reroll-btn")).not.toBeInTheDocument();
  });

  it("sends an approval to its handler and does not mark the take approved on its own", () => {
    const onApproveTake = vi.fn();
    render(<MediaStudioPod sceneId="SCENE-02" sceneTitle="Archive" shots={shots} onApproveTake={onApproveTake} />);

    // Shot 1's take is already approved; only a take ready for review can be.
    expect(screen.getByTestId("dailies-approve-take-btn")).toBeDisabled();

    fireEvent.click(screen.getByTestId("timeline-shot-clip-2"));
    fireEvent.click(screen.getByTestId("dailies-approve-take-btn"));
    expect(onApproveTake).toHaveBeenCalledWith("SCENE-02", 2, "t2b");
    expect(screen.getByTestId("stage-take-status")).toHaveTextContent("Ready for review · Take 2");
  });

  it("asks for a re-shoot with what was wrong and what to change", () => {
    const onRerollTake = vi.fn();
    render(<MediaStudioPod sceneId="SCENE-02" sceneTitle="Archive" shots={shots} onRerollTake={onRerollTake} />);

    fireEvent.click(screen.getByTestId("timeline-shot-clip-2"));
    fireEvent.click(screen.getByTestId("dailies-reroll-btn"));
    fireEvent.change(screen.getByLabelText("What to change (optional)"), { target: { value: " tighter crop " } });
    fireEvent.click(screen.getByTestId("defect-option-wrong_framing"));

    expect(onRerollTake).toHaveBeenCalledWith("SCENE-02", 2, "t2b", "wrong_framing", "tighter crop");
    expect(screen.getByTestId("timeline-shot-clip-2")).toHaveAttribute("aria-label", "Shot 2, 5 seconds, Ready for review");
  });

  it("changes a transition only through its handler", () => {
    const { rerender } = render(<MediaStudioPod sceneId="SCENE-02" sceneTitle="Archive" shots={shots} />);
    expect(screen.queryByTestId("transition-node-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("transition-marker-1")).toHaveAttribute("aria-label", "Transition after shot 1: Crossfade");

    const onChangeTransition = vi.fn();
    rerender(<MediaStudioPod sceneId="SCENE-02" sceneTitle="Archive" shots={shots} onChangeTransition={onChangeTransition} />);
    fireEvent.click(screen.getByTestId("transition-node-1"));
    expect(onChangeTransition).toHaveBeenCalledWith(1, "dip_to_black");
  });

  it("shows audio tracks only for stems that exist", () => {
    render(
      <MediaStudioPod
        sceneId="SCENE-02"
        sceneTitle="Archive"
        shots={shots}
        audioStems={[{ id: "s1", type: "score", title: "Theme", audioUrl: "/a.mp3", volumeDb: -18, durationSeconds: 12, startTimeSeconds: 0 }]}
      />,
    );
    expect(screen.getByTestId("audio-track-score")).toHaveTextContent("Theme");
    expect(screen.queryByTestId("audio-track-dialogue")).not.toBeInTheDocument();
    expect(screen.queryByTestId("audio-track-ambience")).not.toBeInTheDocument();
  });

  it("hides the chat and closes through its handlers", () => {
    const onToggleFocusMode = vi.fn();
    const onClose = vi.fn();
    render(<MediaStudioPod sceneId="SCENE-01" sceneTitle="Opening" onToggleFocusMode={onToggleFocusMode} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Hide the chat" }));
    expect(onToggleFocusMode).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close Media Studio" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("toggles between Director Deck and Pipeline Graph views", () => {
    render(<MediaStudioPod sceneId="SCENE-02" sceneTitle="Archive" shots={shots} />);

    // Default is Director Deck
    expect(screen.getByTestId("media-stage-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("media-dailies-inspector")).toBeInTheDocument();
    expect(screen.queryByTestId("media-graph-viewer")).not.toBeInTheDocument();

    // Switch to Pipeline Graph
    fireEvent.click(screen.getByTestId("view-mode-graph-btn"));
    expect(screen.getByTestId("media-graph-viewer")).toBeInTheDocument();
    expect(screen.queryByTestId("media-stage-canvas")).not.toBeInTheDocument();
    expect(screen.queryByTestId("media-dailies-inspector")).not.toBeInTheDocument();
    // Timeline remains accessible
    expect(screen.getByTestId("media-timeline-sequencer")).toBeInTheDocument();

    // Switch back to Director Deck
    fireEvent.click(screen.getByTestId("view-mode-director-btn"));
    expect(screen.getByTestId("media-stage-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("media-dailies-inspector")).toBeInTheDocument();
    expect(screen.queryByTestId("media-graph-viewer")).not.toBeInTheDocument();
  });

  it("displays live streaming latent preview when rendering a take with streaming frames", () => {
    const streamingShot: MediaShot = {
      shotNumber: 1,
      sceneId: "SCENE-02",
      activeTakeIndex: 0,
      durationSeconds: 4,
      takes: [
        {
          takeId: "t-stream",
          takeNumber: 1,
          prompt: "Futuristic neon alleyway rain reflections",
          status: "rendering",
          durationSeconds: 4,
          streaming: {
            currentStep: 18,
            totalSteps: 30,
            previewUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            activeNodeTitle: "KSampler (euler)",
          },
        },
      ],
    };

    render(<MediaStudioPod sceneId="SCENE-02" sceneTitle="Archive" shots={[streamingShot]} />);

    expect(screen.getByTestId("stage-streaming-preview")).toBeInTheDocument();
    expect(screen.getByText(/Streaming Latents · Step 18 of 30/)).toBeInTheDocument();
    expect(screen.getByText("KSampler (euler)")).toBeInTheDocument();
  });
  it("switches the viewer between the take under the playhead and the assembled reel", () => {
    render(
      <MediaStudioPod
        sceneId="SCENE-02"
        sceneTitle="Archive"
        shots={filmed}
        program={{
          label: "Archive",
          assembly: {
            id: 7, status: "ready", reelUrl: "/api/media-studio/assets/9", durationSeconds: 11.3,
            error: null, current: false, createdAt: "2026-09-17T00:00:00.000Z",
          },
        }}
      />,
    );

    // Source first: the take, not the cut.
    expect(screen.queryByTestId("program-reel-video")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("viewer-mode-program-btn"));
    expect(screen.getByTestId("program-reel-video")).toHaveAttribute("src", "/api/media-studio/assets/9");
    // A reel cut before the latest approvals says so where it is watched.
    expect(screen.getByTestId("program-reel-state")).toHaveTextContent("have changed since this reel was cut");

    fireEvent.click(screen.getByTestId("viewer-mode-source-btn"));
    expect(screen.queryByTestId("program-reel-video")).not.toBeInTheDocument();
  });

  it("offers no reel mode when the pod is given no cut, as an embedded card is not", () => {
    render(<MediaStudioPod sceneId="SCENE-02" sceneTitle="Archive" shots={filmed} />);
    expect(screen.queryByTestId("viewer-mode-program-btn")).not.toBeInTheDocument();
  });
});
