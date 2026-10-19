import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FRAME_SECONDS, MediaStageCanvas } from "./MediaStageCanvas";
import type { MediaShot, MediaShotTake } from "../types";

const shot: MediaShot = { shotNumber: 1, sceneId: "SCENE-01", activeTakeIndex: 0, durationSeconds: 5, takes: [] };
const take: MediaShotTake = { takeId: "1", takeNumber: 1, prompt: "Wide", status: "ready_for_review", durationSeconds: 5, videoUrl: "/api/media-studio/assets/1" };

describe("the stage, frame by frame and full screen", () => {
  afterEach(() => {
    delete (document as { fullscreenElement?: unknown }).fullscreenElement;
    delete (document as { exitFullscreen?: unknown }).exitFullscreen;
  });

  it("pauses and steps one frame either way, from the buttons or a shortcut's request", () => {
    const onSeek = vi.fn();
    const onTogglePlay = vi.fn();
    const stage = (props: Partial<React.ComponentProps<typeof MediaStageCanvas>>) => (
      <MediaStageCanvas activeShot={shot} activeTake={take} compareTake={null} aspectRatio="16:9" isPlaying currentTime={2} onTogglePlay={onTogglePlay} onSeek={onSeek} {...props} />
    );
    const { rerender } = render(stage({}));
    let position = 2;
    Object.defineProperty(screen.getByTestId("stage-video"), "currentTime", { configurable: true, get: () => position, set: (value: number) => { position = value; } });

    fireEvent.click(screen.getByRole("button", { name: "Forward one frame" }));
    expect(onTogglePlay).toHaveBeenCalledTimes(1);
    expect(onSeek.mock.calls.at(-1)?.[0]).toBeCloseTo(2 + FRAME_SECONDS, 6);

    rerender(stage({ isPlaying: false, currentTime: position, frameStepRequest: { direction: -1, id: 1 } }));
    expect(onSeek.mock.calls.at(-1)?.[0]).toBeCloseTo(2, 6);
    expect(onTogglePlay).toHaveBeenCalledTimes(1);
  });

  it("takes the stage full screen and back, from the button or a shortcut's request", () => {
    const stage = (props: Partial<React.ComponentProps<typeof MediaStageCanvas>>) => (
      <MediaStageCanvas activeShot={shot} activeTake={take} compareTake={null} aspectRatio="16:9" isPlaying={false} currentTime={0} onTogglePlay={vi.fn()} onSeek={vi.fn()} {...props} />
    );
    const { rerender } = render(stage({}));
    const root = screen.getByTestId("media-stage-canvas");
    let fullscreen: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreen });
    root.requestFullscreen = vi.fn(async () => {
      fullscreen = root;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    document.exitFullscreen = vi.fn(async () => {
      fullscreen = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });

    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(root.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Exit full screen" })).toHaveAttribute("aria-pressed", "true");

    rerender(stage({ fullscreenRequest: 1 }));
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Full screen" })).toHaveAttribute("aria-pressed", "false");
  });
});
