import { beforeEach, describe, expect, it, vi } from "vitest";
import { PREFERENCES_KEY, readStudioPreferences, writeStudioPreferences } from "./preferences";

describe("remembered studio views", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("remembers each production's tab, scene and view, and ignores what it cannot use", () => {
    writeStudioPreferences(7, { tab: "film" });
    writeStudioPreferences(7, { sceneId: 21, viewMode: "graph" });
    writeStudioPreferences(8, { tab: "shots" });
    expect(readStudioPreferences(7)).toEqual({ tab: "film", sceneId: 21, viewMode: "graph" });
    expect(readStudioPreferences(8)).toEqual({ tab: "shots" });
    expect(readStudioPreferences(9)).toEqual({});
    expect(readStudioPreferences(null)).toEqual({});

    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ p7: { tab: "settings", sceneId: "21", viewMode: "3d" } }));
    expect(readStudioPreferences(7)).toEqual({});
    localStorage.setItem(PREFERENCES_KEY, "not json");
    expect(readStudioPreferences(7)).toEqual({});
  });

  it("keeps the fifty most recently used productions", () => {
    for (let id = 1; id <= 51; id++) writeStudioPreferences(id, { tab: "film" });
    writeStudioPreferences(2, { tab: "story" });
    writeStudioPreferences(52, { tab: "film" });
    expect(readStudioPreferences(1)).toEqual({});
    expect(readStudioPreferences(3)).toEqual({});
    expect(readStudioPreferences(2)).toEqual({ tab: "story" });
    expect(readStudioPreferences(52)).toEqual({ tab: "film" });
  });

  it("opens as always when the browser refuses to store anything", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeStudioPreferences(7, { tab: "film" })).not.toThrow();
    expect(readStudioPreferences(7)).toEqual({});
    setItem.mockRestore();
  });
});
