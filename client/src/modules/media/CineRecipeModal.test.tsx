import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CineRecipeModal } from "./CineRecipeModal";
import { production, scene, shot } from "./fixtures";

describe("CineRecipeModal", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders catalog dialog with default recipes and categories", () => {
    const onApply = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <CineRecipeModal
        open={true}
        onOpenChange={onOpenChange}
        production={production()}
        scene={scene({ mood: "tender" })}
        shot={shot({ action: "rescuer lifts the cat off a branch" })}
        onApply={onApply}
      />
    );

    expect(screen.getByText("Cinematography Recipe Catalog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All Recipes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Emotional Beats" })).toBeInTheDocument();
    expect(screen.getAllByText("Save the Cat (Emotional Rescue)").length).toBeGreaterThan(0);
  });

  it("filters recipes when searching", () => {
    const onApply = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <CineRecipeModal
        open={true}
        onOpenChange={onOpenChange}
        production={production()}
        scene={scene()}
        shot={shot()}
        onApply={onApply}
      />
    );

    const searchInput = screen.getByPlaceholderText("Search recipes & styles...");
    fireEvent.change(searchInput, { target: { value: "noir" } });

    expect(screen.getAllByText("Neo-Noir Suspense & Unease").length).toBeGreaterThan(0);
    expect(screen.queryByText("Save the Cat (Emotional Rescue)")).not.toBeInTheDocument();
  });

  it("applies selected recipe to the shot with chosen flags", () => {
    const onApply = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <CineRecipeModal
        open={true}
        onOpenChange={onOpenChange}
        production={production()}
        scene={scene({ mood: "hopeful" })}
        shot={shot({ action: "cradles the kitten gently" })}
        onApply={onApply}
      />
    );

    const applyBtn = screen.getByTestId("apply-cine-recipe-btn");
    fireEvent.click(applyBtn);

    expect(onApply).toHaveBeenCalledTimes(1);
    const payload = onApply.mock.calls[0][0];
    expect(payload.recipe.id).toBe("save_the_cat");
    expect(payload.applyFraming).toBe(true);
    expect(payload.applyLens).toBe(true);
    expect(payload.applyMotion).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("allows saving and applying custom user presets", () => {
    const onApply = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <CineRecipeModal
        open={true}
        onOpenChange={onOpenChange}
        production={production()}
        scene={scene({ sceneKey: "SCENE-03", mood: "rainy" })}
        shot={shot({ framing: "Extreme close-up", lens: "85mm", cameraMotion: "Whip pan", action: "detective eyes dart" })}
        onApply={onApply}
      />
    );

    // Switch to Custom Presets tab
    fireEvent.click(screen.getByRole("button", { name: "Custom Presets" }));

    // Type a new preset name and save it
    const input = screen.getByPlaceholderText("e.g. Noir Alley Push");
    fireEvent.change(input, { target: { value: "Detective Macro Whip" } });
    fireEvent.click(screen.getByRole("button", { name: "Save preset" }));

    expect(screen.getAllByText("Detective Macro Whip").length).toBeGreaterThan(0);

    // Apply custom preset
    fireEvent.click(screen.getByTestId("apply-cine-recipe-btn"));
    expect(onApply).toHaveBeenCalledTimes(1);
    const payload = onApply.mock.calls[0][0];
    expect(payload.recipe.name).toBe("Detective Macro Whip");
    expect(payload.recipe.framing).toBe("Extreme close-up");
    expect(payload.recipe.lens).toBe("85mm");
    expect(payload.recipe.cameraMotion).toBe("Whip pan");
  });
});
