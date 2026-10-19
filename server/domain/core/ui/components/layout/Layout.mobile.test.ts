import { describe, expect, it } from "vitest";
import { shouldShowMobileAssistantFab } from "./Layout";

describe("mobile Copilot entry point", () => {
  it("keeps an Assistant trigger on immersive graph screens", () => {
    expect(shouldShowMobileAssistantFab("/knowledge/graph", false, false)).toBe(true);
    expect(shouldShowMobileAssistantFab("/platform-maintenance/system-graph", false, false)).toBe(true);
  });

  it("hides the fallback trigger while chat or search is open", () => {
    expect(shouldShowMobileAssistantFab("/knowledge/graph", true, false)).toBe(false);
    expect(shouldShowMobileAssistantFab("/knowledge/graph", false, true)).toBe(false);
  });

  it("does not duplicate the normal mobile utility tray", () => {
    expect(shouldShowMobileAssistantFab("/dashboard", false, false)).toBe(false);
  });
});
