import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MediaDailiesInspector } from "./MediaDailiesInspector";
import type { MediaShot, MediaShotTake } from "../types";

describe("MediaDailiesInspector", () => {
  const sampleTake1: MediaShotTake = {
    takeId: "take-1",
    takeNumber: 1,
    prompt: "Wide angle establishing shot of neon alley",
    status: "ready_for_review",
    thumbnailUrl: "https://example.com/thumb1.jpg",
    videoUrl: "https://example.com/video1.mp4",
    durationSeconds: 4,
    cameraMotion: "Truck Right",
    seed: 1234,
    costUsd: 0.05,
  };

  const sampleTake2: MediaShotTake = {
    takeId: "take-2",
    takeNumber: 2,
    prompt: "Tight close up on character face in rain",
    status: "ready_for_review",
    thumbnailUrl: "https://example.com/thumb2.jpg",
    videoUrl: "https://example.com/video2.mp4",
    durationSeconds: 4,
    cameraMotion: "Static",
    seed: 5678,
    costUsd: 0.05,
  };

  const sampleShot: MediaShot = {
    shotNumber: 1,
    sceneId: "SCENE-01",
    activeTakeIndex: 1,
    durationSeconds: 4,
    actionDescription: "Alleyway confrontation",
    storyboardUrl: "https://example.com/storyboard.jpg",
    takes: [sampleTake1, sampleTake2],
  };

  it("renders direction details, take tabs, and actions", () => {
    const onSelectTake = vi.fn();
    const onApproveTake = vi.fn();
    const onRerollTake = vi.fn();

    render(
      <MediaDailiesInspector
        activeShot={sampleShot}
        activeTake={sampleTake2}
        activeTakeIndex={1}
        onSelectTake={onSelectTake}
        onApproveTake={onApproveTake}
        onRerollTake={onRerollTake}
      />
    );

    expect(screen.getByTestId("media-dailies-inspector")).toBeInTheDocument();
    expect(screen.getByText("Shot 1")).toBeInTheDocument();
    expect(screen.getByText("SCENE-01")).toBeInTheDocument();
    expect(screen.getByTestId("take-selector-tab-1")).toBeInTheDocument();
    expect(screen.getByTestId("take-selector-tab-2")).toBeInTheDocument();

    // Select take 1
    fireEvent.click(screen.getByTestId("take-selector-tab-1"));
    expect(onSelectTake).toHaveBeenCalledWith(0);
  });

  it("toggles the A/B Continuity Split-Wipe comparison view", () => {
    render(
      <MediaDailiesInspector
        activeShot={sampleShot}
        activeTake={sampleTake2}
        activeTakeIndex={1}
        onSelectTake={vi.fn()}
      />
    );

    const wipeToggle = screen.getByTestId("dailies-continuity-wipe-toggle");
    expect(wipeToggle).toBeInTheDocument();
    expect(screen.queryByTestId("dailies-continuity-wipe-container")).not.toBeInTheDocument();

    // Open wipe
    fireEvent.click(wipeToggle);
    expect(screen.getByTestId("dailies-continuity-wipe-container")).toBeInTheDocument();
    expect(screen.getByText("Take 1")).toBeInTheDocument();
    expect(screen.getByText("Take 2")).toBeInTheDocument();

    // Close wipe
    fireEvent.click(wipeToggle);
    expect(screen.queryByTestId("dailies-continuity-wipe-container")).not.toBeInTheDocument();
  });
});
