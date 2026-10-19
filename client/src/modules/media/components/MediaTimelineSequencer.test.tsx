import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MediaTimelineSequencer } from "./MediaTimelineSequencer";
import type { MediaAudioStem, MediaShot } from "../types";

const mockShots: MediaShot[] = [
  {
    shotNumber: 1,
    sceneId: "SCENE-01",
    activeTakeIndex: 0,
    durationSeconds: 4,
    transition: "crossfade",
    transitionDurationSeconds: 1.0,
    takes: [
      { takeId: "t1", takeNumber: 1, prompt: "Establishing wide", status: "approved", durationSeconds: 4 },
      { takeId: "t2", takeNumber: 2, prompt: "Establishing wide v2", status: "ready_for_review", durationSeconds: 4 },
    ],
  },
  {
    shotNumber: 2,
    sceneId: "SCENE-01",
    activeTakeIndex: 0,
    durationSeconds: 6,
    transition: "cut",
    takes: [
      { takeId: "t3", takeNumber: 1, prompt: "Medium close", status: "approved", durationSeconds: 6 },
    ],
  },
];

const mockAudioStems: MediaAudioStem[] = [
  { id: "a1", type: "dialogue", title: "Character Voice", audioUrl: "", volumeDb: -12, durationSeconds: 10, startTimeSeconds: 0 },
  { id: "a2", type: "ambience", title: "Rainy Street", audioUrl: "", volumeDb: -20, durationSeconds: 10, startTimeSeconds: 0 },
  { id: "a3", type: "score", title: "Atmospheric Synth", audioUrl: "", volumeDb: -16, durationSeconds: 10, startTimeSeconds: 0 },
  { id: "a4", type: "sfx", title: "Car Passing", audioUrl: "", volumeDb: -8, durationSeconds: 10, startTimeSeconds: 2 },
];

describe("MediaTimelineSequencer", () => {
  it("renders multi-track video track (V1) with clips and duration timecode", () => {
    render(
      <MediaTimelineSequencer
        shots={mockShots}
        audioStems={mockAudioStems}
        activeShotIndex={0}
        timelineTime={2}
        totalTime={10}
        onSelectShot={vi.fn()}
        onSeek={vi.fn()}
      />
    );

    expect(screen.getByTestId("media-timeline-sequencer")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-clip-track")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-shot-clip-1")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-shot-clip-2")).toBeInTheDocument();
    expect(screen.getByText("Shot 1")).toBeInTheDocument();
    expect(screen.getByText("Shot 2")).toBeInTheDocument();
  });

  it("cycles transition on transition-node click and supports inspector popover", () => {
    const onChangeTransition = vi.fn();
    render(
      <MediaTimelineSequencer
        shots={mockShots}
        audioStems={mockAudioStems}
        activeShotIndex={0}
        timelineTime={0}
        totalTime={10}
        onSelectShot={vi.fn()}
        onSeek={vi.fn()}
        onChangeTransition={onChangeTransition}
      />
    );

    const transitionNode = screen.getByTestId("transition-node-1");
    expect(transitionNode).toBeInTheDocument();
    // Crossfade -> Dip to Black
    fireEvent.click(transitionNode);
    expect(onChangeTransition).toHaveBeenCalledWith(1, "dip_to_black");

    // Inspector button opens duration & preset configuration
    const inspectorBtn = screen.getByTestId("transition-inspector-btn-1");
    expect(inspectorBtn).toHaveTextContent("1s");
    fireEvent.click(inspectorBtn);

    expect(screen.getByTestId("transition-popover-1")).toBeInTheDocument();
    expect(screen.getByText("Cut after Shot 1")).toBeInTheDocument();
    expect(screen.getByTestId("transition-preset-crossfade")).toBeInTheDocument();
    expect(screen.getByTestId("transition-preset-dip_to_black")).toBeInTheDocument();
    expect(screen.getByTestId("transition-preset-cut")).toBeInTheDocument();
  });

  it("renders all 4 audio stems (A1-A4) with individual Mute and Solo controls", () => {
    render(
      <MediaTimelineSequencer
        shots={mockShots}
        audioStems={mockAudioStems}
        activeShotIndex={0}
        timelineTime={0}
        totalTime={10}
        onSelectShot={vi.fn()}
        onSeek={vi.fn()}
      />
    );

    expect(screen.getByTestId("audio-track-dialogue")).toBeInTheDocument();
    expect(screen.getByTestId("audio-track-ambience")).toBeInTheDocument();
    expect(screen.getByTestId("audio-track-score")).toBeInTheDocument();
    expect(screen.getByTestId("audio-track-sfx")).toBeInTheDocument();

    expect(screen.getByText("Character Voice")).toBeInTheDocument();
    expect(screen.getByText("Rainy Street")).toBeInTheDocument();
    expect(screen.getByText("Atmospheric Synth")).toBeInTheDocument();
    expect(screen.getByText("Car Passing")).toBeInTheDocument();

    const muteVoice = screen.getByRole("button", { name: "Mute Voice track" });
    fireEvent.click(muteVoice);
    expect(screen.getByRole("button", { name: "Mute Voice track" })).toHaveAttribute("title", "Unmute track");

    const soloScore = screen.getByRole("button", { name: "Solo Score track" });
    fireEvent.click(soloScore);
    expect(screen.getByRole("button", { name: "Solo Score track" })).toHaveAttribute("title", "Clear solo");
  });

  it("allows switching takes directly from the timeline clip when multiple takes exist", () => {
    const onSelectTake = vi.fn();
    render(
      <MediaTimelineSequencer
        shots={mockShots}
        audioStems={mockAudioStems}
        activeShotIndex={0}
        timelineTime={0}
        totalTime={10}
        onSelectShot={vi.fn()}
        onSeek={vi.fn()}
        onSelectTake={onSelectTake}
      />
    );

    const takeDropdownBtn = screen.getByTestId("shot-1-take-dropdown-btn");
    expect(takeDropdownBtn).toBeInTheDocument();
    expect(takeDropdownBtn).toHaveTextContent("T1");
  });

  it("supports zooming in and out of the timeline", () => {
    render(
      <MediaTimelineSequencer
        shots={mockShots}
        audioStems={mockAudioStems}
        activeShotIndex={0}
        timelineTime={0}
        totalTime={10}
        onSelectShot={vi.fn()}
        onSeek={vi.fn()}
      />
    );

    const zoomIn = screen.getByRole("button", { name: "Zoom In" });
    const zoomOut = screen.getByRole("button", { name: "Zoom Out" });
    expect(screen.getByText("100%")).toBeInTheDocument();
    fireEvent.click(zoomIn);
    expect(screen.getByText("125%")).toBeInTheDocument();
    fireEvent.click(zoomOut);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("renders interactive left and right trim handles on clips", () => {
    const onTrimShot = vi.fn();
    render(
      <MediaTimelineSequencer
        shots={mockShots}
        audioStems={mockAudioStems}
        activeShotIndex={0}
        timelineTime={0}
        totalTime={10}
        onSelectShot={vi.fn()}
        onSeek={vi.fn()}
        onTrimShot={onTrimShot}
      />
    );

    const leftHandle = screen.getByTestId("trim-handle-left-1");
    const rightHandle = screen.getByTestId("trim-handle-right-1");
    expect(leftHandle).toBeInTheDocument();
    expect(rightHandle).toBeInTheDocument();
    expect(leftHandle).toHaveAttribute("title", expect.stringContaining("Trim In-Point"));
    expect(rightHandle).toHaveAttribute("title", expect.stringContaining("Trim Out-Point"));
  });

  it("calls onSplitShot when Split button is clicked or Ctrl+B is pressed", () => {
    const onSplitShot = vi.fn();
    render(
      <MediaTimelineSequencer
        shots={mockShots}
        audioStems={mockAudioStems}
        activeShotIndex={0}
        timelineTime={2}
        totalTime={10}
        onSelectShot={vi.fn()}
        onSeek={vi.fn()}
        onSplitShot={onSplitShot}
      />
    );

    const splitBtn = screen.getByTestId("timeline-split-btn");
    expect(splitBtn).toBeInTheDocument();
    fireEvent.click(splitBtn);
    expect(onSplitShot).toHaveBeenCalledWith(1, 2);

    // Test keyboard shortcut Ctrl+B
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(onSplitShot).toHaveBeenCalledTimes(2);
  });

  it("renders V2 Overlay / B-Roll track with stacked cutaway shots", () => {
    const shotsWithV2: MediaShot[] = [
      ...mockShots,
      {
        shotNumber: 3,
        sceneId: "SCENE-01",
        activeTakeIndex: 0,
        durationSeconds: 3,
        track: 2,
        startTimeSeconds: 1.5,
        takes: [{ takeId: "t4", takeNumber: 1, prompt: "Cutaway close-up", status: "approved", durationSeconds: 3 }],
      },
    ];

    render(
      <MediaTimelineSequencer
        shots={shotsWithV2}
        audioStems={mockAudioStems}
        activeShotIndex={0}
        timelineTime={0}
        totalTime={10}
        onSelectShot={vi.fn()}
        onSeek={vi.fn()}
      />
    );

    expect(screen.getByTestId("track-v2-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("v2-shot-3")).toBeInTheDocument();
    expect(screen.getByText("Shot 3 (Cutaway)")).toBeInTheDocument();
  });
});
