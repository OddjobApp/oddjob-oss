import { describe, expect, it } from "vitest";
import { GLOBAL_NAVIGATION_SHORTCUTS } from "../use-keyboard-shortcuts";

describe("GLOBAL_NAVIGATION_SHORTCUTS", () => {
  it("matches the current sidebar and command palette destinations", () => {
    expect(
      Object.fromEntries(
        GLOBAL_NAVIGATION_SHORTCUTS.map((shortcut) => [shortcut.key, shortcut.path]),
      ),
    ).toEqual({
      h: "/dashboard",
      j: "/operations",
      p: "/operations/workstreams",
      s: "/operations/schedules",
      k: "/knowledge",
      a: "/assistant/workbench",
    });
  });
});
