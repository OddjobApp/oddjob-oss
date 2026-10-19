import { describe, expect, it } from "vitest";
import {
  STUDIOS,
  STUDIO_KINDS,
  STUDIO_NAMES,
  SCOPED_STUDIO_NAMES,
  isToolMounted,
  type Studio,
} from "./studio-registry";

const entries = Object.entries(STUDIOS) as [string, Studio][];

describe("the studio registry holds together", () => {
  it("names every studio once", () => {
    const names = entries.map(([, studio]) => studio.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives each tool-mounted studio its own payload type and mount tool", () => {
    const podTypes: string[] = [];
    const mountTools: string[] = [];
    for (const [, studio] of entries) {
      if (!isToolMounted(studio)) continue;
      podTypes.push(studio.podType);
      mountTools.push(studio.mountTool);
    }
    // Two studios sharing either would make a mount ambiguous.
    expect(new Set(podTypes).size).toBe(podTypes.length);
    expect(new Set(mountTools).size).toBe(mountTools.length);
  });

  it("never reuses a proposal type across studios", () => {
    const all = entries.flatMap(([, studio]) => studio.proposalTypes ?? []);
    expect(new Set(all).size).toBe(all.length);
  });

  it("keeps a builder-pod studio free of a mount tool and payload type", () => {
    // The shape is the record that these three mount differently. A podType or
    // mountTool appearing here would be a claim the server does not honour.
    for (const [kind, studio] of entries) {
      if (isToolMounted(studio)) continue;
      expect(studio.podComponent, `${kind} needs a podComponent to be found`).toBeTruthy();
      expect("podType" in studio, `${kind} must not claim a payload type`).toBe(false);
      expect("mountTool" in studio, `${kind} must not claim a mount tool`).toBe(false);
    }
  });

  it("derives the order, the names and the scoped set from one place", () => {
    expect(STUDIO_KINDS.length).toBe(entries.length);
    expect(Object.keys(STUDIO_NAMES).length).toBe(entries.length);
    // Media, Form and App are the three that can scope a message today.
    expect(SCOPED_STUDIO_NAMES).toEqual(["Media Studio", "Form Studio", "App Studio"]);
  });

  it("puts media and form first, because a scoped message belongs to them", () => {
    expect(STUDIO_KINDS[0]).toBe("media");
    expect(STUDIO_KINDS[1]).toBe("form");
  });
});
