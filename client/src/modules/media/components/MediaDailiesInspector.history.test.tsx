import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MediaDailiesInspector } from "./MediaDailiesInspector";
import type { MediaShot } from "../types";

describe("a shot's prompt history in the dailies", () => {
  it("shows how the prompt changed across takes and why, and opens a take from the list", () => {
    const shot: MediaShot = {
      shotNumber: 2, sceneId: "SCENE-01", activeTakeIndex: 1, durationSeconds: 5,
      takes: [
        { takeId: "a", takeNumber: 1, prompt: "Elena crouches", status: "rejected", durationSeconds: 5, defectClass: "wrong_framing", notes: "tighter" },
        { takeId: "b", takeNumber: 2, prompt: "Tighter on Elena", status: "ready_for_review", durationSeconds: 5 },
      ],
    };
    const onSelectTake = vi.fn();
    render(<MediaDailiesInspector activeShot={shot} activeTake={shot.takes[1]} activeTakeIndex={1} onSelectTake={onSelectTake} />);

    expect(screen.getByRole("button", { name: "Take 1, Rejected" }).querySelector('[data-status-icon="rejected"]')).not.toBeNull();

    fireEvent.click(screen.getByTestId("dailies-prompt-history-toggle"));
    const second = screen.getByTestId("prompt-history-take-2");
    expect(second).toHaveAttribute("aria-current", "true");
    expect(second).toHaveTextContent("Prompt changed");
    expect(second).toHaveTextContent('Re-shot from take 1: Wrong framing or lens, "tighter"');
    expect(screen.getByTestId("prompt-history-take-1")).toHaveTextContent("First take");

    fireEvent.click(screen.getByTestId("prompt-history-take-1"));
    expect(onSelectTake).toHaveBeenCalledWith(0);
  });
});
