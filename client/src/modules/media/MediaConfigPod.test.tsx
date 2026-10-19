import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import MediaConfigPod from "@domain-ui/core/ui/components/packaged/MediaConfigPod";

describe("MediaConfigPod", () => {
  it("renders with default configurations and displays recipes", () => {
    render(
      <MediaConfigPod
        sceneTitle="Rooftop Infiltration"
        shotNumber={2}
      />
    );

    expect(screen.getByText("Rooftop Infiltration Configuration")).toBeInTheDocument();
    expect(screen.getByText("Shot #2")).toBeInTheDocument();
    expect(screen.getByTestId("recipe-select-recipe_cinematic_hero_v1")).toBeInTheDocument();
    expect(screen.getByTestId("recipe-select-recipe_previz_animatic_v1")).toBeInTheDocument();
  });

  it("handles recipe selection and updates parameter state", () => {
    const onComplete = vi.fn();
    render(
      <MediaConfigPod
        sceneTitle="Hangar Escape"
        shotNumber={1}
        onComplete={onComplete}
      />
    );

    // Select previz recipe
    const previzBtn = screen.getByTestId("recipe-select-recipe_previz_animatic_v1");
    fireEvent.click(previzBtn);

    // Change camera motion
    const cameraSelect = screen.getByLabelText(/Camera Motion/i);
    fireEvent.change(cameraSelect, { target: { value: "Crane Up" } });

    // Change steps
    const stepsSlider = screen.getByLabelText(/Sampling Steps/i);
    fireEvent.change(stepsSlider, { target: { value: "25" } });

    // Submit
    const applyBtn = screen.getByTestId("apply-media-config-btn");
    fireEvent.click(applyBtn);

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        sceneTitle: "Hangar Escape",
        shotNumber: 1,
        recipeId: "recipe_previz_animatic_v1",
        cameraMotion: "Crane Up",
        steps: 25,
      })
    );
  });

  it("triggers onMountRail when clicking Mount in Assembler", () => {
    const onMountRail = vi.fn();
    render(
      <MediaConfigPod
        initialConfig={{ sceneId: "scene_01" }}
        onMountRail={onMountRail}
      />
    );

    const railBtn = screen.getByTestId("mount-media-rail-btn");
    fireEvent.click(railBtn);

    expect(onMountRail).toHaveBeenCalledWith("scene_01");
  });

  it("triggers onOpenFormStudio when clicking Tune in Form Studio", () => {
    const onOpenFormStudio = vi.fn();
    render(
      <MediaConfigPod
        onOpenFormStudio={onOpenFormStudio}
      />
    );

    const formStudioBtn = screen.getByTestId("open-form-studio-btn");
    fireEvent.click(formStudioBtn);

    expect(onOpenFormStudio).toHaveBeenCalledWith("form_comfyui_shot_config");
  });
});
