import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MediaGraphViewer } from "./MediaGraphViewer";
import type { MediaShot, MediaShotTake } from "../types";

describe("MediaGraphViewer", () => {
  const sampleShot: MediaShot = {
    shotNumber: 1,
    sceneId: "SCENE-01",
    activeTakeIndex: 0,
    durationSeconds: 5,
    actionDescription: "Close on cybernetic eye scanning the neon crowd",
    takes: [],
  };

  const sampleTake: MediaShotTake = {
    takeId: "take-1",
    takeNumber: 1,
    prompt: "Close up cinematic lighting cybernetic iris lens reflections",
    status: 'rendering' as const,
    seed: 4242,
    durationSeconds: 5,
    cameraMotion: 'Orbit Left',
    characterAnchorId: "char_elena",
    streaming: {
      currentStep: 14,
      totalSteps: 30,
      activeNodeId: "sampler_node",
      activeNodeTitle: "KSampler (euler)",
    },
    workflowSnapshot: {
      templateId: "recipe_cinematic_hero_v1",
      recipeId: "recipe_cinematic_hero_v1",
      recipeName: "Cinematic Hero Take",
      compiledAt: new Date().toISOString(),
      engine: "comfyui",
      resolvedGraphJson: {},
      cachedNodes: ["model_loader"],
      nodeHashes: {
        "1": "hash_model_abc",
        "2": "hash_clip_def",
      },
      cachedNodeIds: ["model_loader"],
      executedNodeIds: ["positive_clip", "empty_latent"],
      totalSteps: 30,
      completedSteps: 14,
    },
  };

  it("renders the DAG workflow header and cache indicator", () => {
    render(<MediaGraphViewer activeShot={sampleShot} activeTake={sampleTake} />);

    expect(screen.getByTestId("media-graph-viewer")).toBeInTheDocument();
    expect(screen.getByText("Cinematic Hero Take (FLUX + Wan2.1 + IP-Adapter)")).toBeInTheDocument();
    expect(screen.getAllByText(/Cached/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Step 14 of 30/i)).toBeInTheDocument();
  });

  it("renders graph nodes with appropriate cache and execution status badges", () => {
    render(<MediaGraphViewer activeShot={sampleShot} activeTake={sampleTake} />);

    // Model loader is cached
    expect(screen.getByTestId("graph-node-model_loader")).toBeInTheDocument();
    const modelNode = screen.getByTestId("graph-node-model_loader");
    expect(modelNode).toHaveTextContent("CACHED");

    // Sampler is currently executing
    const samplerNode = screen.getByTestId("graph-node-sampler_node");
    expect(samplerNode).toHaveTextContent("EXECUTING");
  });

  it("allows selecting a node to inspect its tensor inputs and deterministic hash", () => {
    const onNodeSelect = vi.fn();
    render(<MediaGraphViewer activeShot={sampleShot} activeTake={sampleTake} onNodeSelect={onNodeSelect} />);

    const cameraNode = screen.getByTestId("graph-node-camera_ctrl");
    fireEvent.click(cameraNode);

    expect(onNodeSelect).toHaveBeenCalledWith("camera_ctrl");
    expect(screen.getAllByText("CameraCtrl (Motion Trajectory)").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Node ID: camera_ctrl")).toBeInTheDocument();
    expect(screen.getByText("motionPreset")).toBeInTheDocument();
  });

  it("leverages Form Studio parameters for tuning ComfyUI recipes", () => {
    const onApplyParameters = vi.fn();
    const onOpenFormStudio = vi.fn();

    render(
      <MediaGraphViewer
        activeShot={sampleShot}
        activeTake={sampleTake}
        onApplyParameters={onApplyParameters}
        onOpenFormStudio={onOpenFormStudio}
      />,
    );

    // Switch to Form Studio Params subview
    fireEvent.click(screen.getByTestId("subview-form-studio-btn"));

    expect(screen.getByTestId("comfy-form-studio-view")).toBeInTheDocument();
    expect(screen.getByText("ComfyUI Video Recipe Tuning")).toBeInTheDocument();
    expect(screen.getByText("Form Studio V2 Schema")).toBeInTheDocument();
    expect(screen.getByTestId("form-field-sampling_steps")).toBeInTheDocument();
    expect(screen.getByTestId("form-field-cfg_scale")).toBeInTheDocument();

    // Adjust parameter
    fireEvent.change(screen.getByTestId("form-field-cfg_scale"), { target: { value: "8.5" } });
    fireEvent.click(screen.getByTestId("apply-form-params-btn"));

    expect(onApplyParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        cfg_scale: 8.5,
      }),
    );

    // Mount in Form Studio Rail
    fireEvent.click(screen.getByTestId("mount-full-form-studio-btn"));
    expect(onOpenFormStudio).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "ComfyUI Video Recipe Tuning",
      }),
    );
  });

  it("renders the Mermaid diagram and X-Ray 5-layer lineage subview", () => {
    render(<MediaGraphViewer activeShot={sampleShot} activeTake={sampleTake} />);

    // Switch to Mermaid subview
    const mermaidBtn = screen.getByTestId("subview-mermaid-btn");
    expect(mermaidBtn).toBeInTheDocument();
    fireEvent.click(mermaidBtn);

    expect(screen.getByTestId("media-graph-mermaid-view")).toBeInTheDocument();
    expect(screen.getByText(/Oddjob 5-Layer ComfyUI Architecture/i)).toBeInTheDocument();
    expect(screen.getByText("1. Oddjob_ScribeSceneAdapter")).toBeInTheDocument();
    expect(screen.getByText("2. Oddjob_CharacterAdapter")).toBeInTheDocument();
    expect(screen.getByText("3. Oddjob_CameraMotionAdapter")).toBeInTheDocument();
    expect(screen.getByText("4. Oddjob_HILGateAdapter")).toBeInTheDocument();
    expect(screen.getByText("5. Oddjob_DatasetSinkAdapter")).toBeInTheDocument();
    expect(screen.getByTestId("mermaid-inspect-xray-btn")).toHaveAttribute(
      "href",
      "/admin/xray?scope=media-studio"
    );
  });
  it("selects a node from the keyboard, not only with a mouse", () => {
    // Selecting a node is the only way to inspect it, so a pointer-only control
    // puts the graph out of reach entirely rather than merely making it awkward.
    render(<MediaGraphViewer activeShot={sampleShot} activeTake={sampleTake} />);
    const node = screen.getByTestId("graph-node-sampler_node");
    expect(node).toHaveAttribute("role", "button");
    expect(node).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(node, { key: "Enter" });
    expect(screen.getByTestId("graph-node-sampler_node")).toHaveAttribute("aria-pressed", "true");
  });
});
