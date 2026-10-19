import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StoryboardSequencer } from "./StoryboardSequencer";
import { keyframe, plotPoint, production, scene } from "./fixtures";

describe("a keyframe's references on the storyboard", () => {
  it("says which characters, frame and place the keyframe on show was rendered with", () => {
    const view = production({
      scenes: [scene({
        plotPoints: [plotPoint({
          keyframes: [keyframe({
            references: [
              { kind: "character", label: "Elena", assetId: 3 },
              { kind: "previous_keyframe", label: "SCENE-01 plot point 1: Arrival", assetId: 5 },
              { kind: "location", label: "Archive rooftop", assetId: 6 },
            ],
          })],
        })],
      })],
    });
    render(<StoryboardSequencer production={view} act={vi.fn()} onExport={vi.fn()} />);
    expect(screen.getByTestId("slide-references-11")).toHaveTextContent("Consistent with Elena, the previous frame, Archive rooftop");
  });

  it("says nothing for a keyframe rendered without references", () => {
    render(<StoryboardSequencer production={production({ scenes: [scene({ plotPoints: [plotPoint({ keyframes: [keyframe()] })] })] })} act={vi.fn()} onExport={vi.fn()} />);
    expect(screen.queryByTestId("slide-references-11")).not.toBeInTheDocument();
  });
});
