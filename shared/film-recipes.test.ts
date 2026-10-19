import { describe, it, expect } from "vitest";
import { CINEMATIC_RECIPES, matchCineRecipes } from "./film-recipes";

describe("film-recipes", () => {
  it("provides standard cinematography recipes across key categories", () => {
    expect(CINEMATIC_RECIPES.length).toBeGreaterThanOrEqual(5);
    const saveTheCat = CINEMATIC_RECIPES.find((r) => r.id === "save_the_cat");
    expect(saveTheCat).toBeDefined();
    expect(saveTheCat?.framing).toBe("Medium shot");
    expect(saveTheCat?.lens).toBe("35mm");
    expect(saveTheCat?.cameraMotion).toBe("Slow gentle push-in");
  });

  it("matches Save the Cat beat when action involves rescuing an animal gently", () => {
    const action = "A kind adult rescuer gently lifts the orange tabby cat off a low tree branch and cradles it safely";
    const matches = matchCineRecipes(action, "Tender, hopeful");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].id).toBe("save_the_cat");
  });

  it("matches Action Tracking when action involves sprinting or escaping", () => {
    const action = "She sprints through the alleyway, fleeing from pursuit";
    const matches = matchCineRecipes(action, "Urgent");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].id).toBe("kinetic_chase");
  });

  it("returns default top recipes when corpus is empty", () => {
    const matches = matchCineRecipes(null, null);
    expect(matches.length).toBe(3);
  });
});
