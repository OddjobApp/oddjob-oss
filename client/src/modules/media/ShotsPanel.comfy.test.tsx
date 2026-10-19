import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ShotsPanel } from "./ShotsPanel";
import { production, scene, shot, take } from "./fixtures";
import type { ProductionView } from "@shared/media-studio";

const comfy = (overrides: Partial<ProductionView["video"]> = {}): ProductionView["video"] => ({
  engine: "comfyui", label: "ComfyUI", configured: true, resolution: "720p", centsPerSecond: 0, available: { fal: true, comfyui: true },
  workflow: {
    name: "Wan i2v", nodeCount: 11, nodeTypes: [], fps: 16,
    mapping: { prompt: { nodeId: "6", input: "text" }, negativePrompt: null, seeds: [], startImage: { nodeId: "52", input: "image" }, endImage: null, frames: null },
  },
  ...overrides,
});

describe("takes on ComfyUI in Shots", () => {
  it("describes the render, names where a take is running, and asks for the keyframe an image workflow starts from", () => {
    const view = production({
      video: comfy(),
      scenes: [scene({ shots: [shot({ id: 31, durationSeconds: 20, referenceKeyframeId: null, takes: [take({ id: 51, status: "queued", provider: "comfyui" })] })] })],
    });
    render(<ShotsPanel production={view} act={vi.fn()} />);
    const controls = within(screen.getByTestId("take-controls-31"));
    expect(screen.getByTestId("take-estimate-31")).toHaveTextContent('Renders on ComfyUI with "Wan i2v", with no provider charge. Nothing renders until the take is approved.');
    expect(controls.getByText('The workflow "Wan i2v" starts from an image: approve this shot\'s keyframe first.')).toBeInTheDocument();
    expect(controls.getByRole("button", { name: /^Ask for a take/ })).toBeDisabled();
    expect(screen.getByTestId("take-list-31")).toHaveTextContent("Queued on ComfyUI");
  });

  it("asks for a workflow first, and says when ComfyUI is not set up", () => {
    render(<ShotsPanel production={production({ video: comfy({ configured: false, workflow: null }), scenes: [scene({ shots: [shot({ id: 31 })] })] })} act={vi.fn()} />);
    expect(screen.getByTestId("take-estimate-31")).toHaveTextContent("ComfyUI is not set up here, so a take is recorded as a simulation: no video and no charge.");
    expect(within(screen.getByTestId("take-controls-31")).getByText("Import a ComfyUI workflow in Story first.")).toBeInTheDocument();
  });
});
