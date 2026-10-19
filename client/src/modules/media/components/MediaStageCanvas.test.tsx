import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MediaStageCanvas } from "./MediaStageCanvas";
import type { MediaShot, MediaShotTake } from "../types";

describe("MediaStageCanvas", () => {
  const sampleTake: MediaShotTake = {
    takeId: "take-1",
    takeNumber: 1,
    prompt: "Cyberpunk alley tracking shot",
    status: "rendering",
    durationSeconds: 5,
    cameraMotion: "Track Forward",
    seed: 9999,
    streaming: {
      currentStep: 18,
      totalSteps: 30,
      activeNodeId: "sampler_node",
      activeNodeTitle: "KSampler (euler)",
    },
  };

  const sampleShot: MediaShot = {
    shotNumber: 1,
    sceneId: "SCENE-01",
    activeTakeIndex: 0,
    durationSeconds: 5,
    actionDescription: "Alleyway tracking",
    takes: [sampleTake],
  };

  it("renders stage canvas and toggles pipeline stages timeline", () => {
    const onTogglePlay = vi.fn();
    const onSeek = vi.fn();

    render(
      <MediaStageCanvas
        activeShot={sampleShot}
        activeTake={sampleTake}
        compareTake={null}
        aspectRatio="16:9"
        isPlaying={false}
        currentTime={2.5}
        onTogglePlay={onTogglePlay}
        onSeek={onSeek}
      />
    );

    expect(screen.getByTestId("media-stage-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("stage-rendering-progress")).toBeInTheDocument();
    expect(screen.getByText(/Rendering Take via ComfyUI DAG/i)).toBeInTheDocument();

    // Toggle Pipeline Stages timeline
    const stagesBtn = screen.getByTestId("stage-pipeline-stages-btn");
    expect(stagesBtn).toBeInTheDocument();
    expect(screen.queryByTestId("stage-pipeline-timeline-container")).not.toBeInTheDocument();

    fireEvent.click(stagesBtn);
    expect(screen.getByTestId("stage-pipeline-timeline-container")).toBeInTheDocument();
    expect(screen.getByText("Oddjob Cinematic Pipeline (5-Layer)")).toBeInTheDocument();
    expect(screen.getByText("Scribe Scene Narrative")).toBeInTheDocument();
    expect(screen.getByText("Character Continuity Anchor")).toBeInTheDocument();
    expect(screen.getByText("ComfyUI Diffusion Engine")).toBeInTheDocument();
    expect(screen.getByText("Oddjob HIL Governance Gate")).toBeInTheDocument();
    expect(screen.getByText("Knowledge Garden Dataset Sink")).toBeInTheDocument();
  });

  it("renders live step progress, ETC, and remaining time", () => {
    const streamingTake: MediaShotTake = {
      ...sampleTake,
      streaming: {
        currentStep: 6,
        totalSteps: 20,
        activeNodeTitle: "KSampler (Wan2.1)",
        etc: "11:15 PM",
        etaSeconds: 840,
        percent: 30,
      },
    };
    render(
      <MediaStageCanvas
        activeShot={sampleShot}
        activeTake={streamingTake}
        compareTake={null}
        aspectRatio="16:9"
        isPlaying={false}
        currentTime={0}
        onTogglePlay={vi.fn()}
        onSeek={vi.fn()}
      />
    );
    expect(screen.getByText(/Step 6 of 20/i)).toBeInTheDocument();
    expect(screen.getByText(/ETC: 11:15 PM/i)).toBeInTheDocument();
    expect(screen.getByText(/~14m remaining/i)).toBeInTheDocument();
  });
});
