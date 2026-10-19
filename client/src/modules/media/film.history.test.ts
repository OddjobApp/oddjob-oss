import { describe, expect, it } from "vitest";
import { promptHistory } from "./film";
import type { MediaShot } from "./types";

describe("a shot's prompt history", () => {
  it("lists the takes in order, with whether each prompt changed and why the take before was re-shot", () => {
    const shot: Pick<MediaShot, "takes"> = {
      takes: [
        { takeId: "c", takeNumber: 3, prompt: "Tighter on Elena", status: "ready_for_review", durationSeconds: 5 },
        { takeId: "a", takeNumber: 1, prompt: "Elena crouches", status: "rejected", durationSeconds: 5, defectClass: "wrong_framing", notes: "tighter" },
        { takeId: "b", takeNumber: 2, prompt: "Elena crouches ", status: "rejected", durationSeconds: 5, notes: "The render was not approved." },
      ],
    };
    expect(promptHistory(shot)).toEqual([
      { takeId: "a", takeNumber: 1, prompt: "Elena crouches", status: "rejected", changed: false },
      { takeId: "b", takeNumber: 2, prompt: "Elena crouches ", status: "rejected", changed: false, after: { takeNumber: 1, defectClass: "wrong_framing", notes: "tighter" } },
      { takeId: "c", takeNumber: 3, prompt: "Tighter on Elena", status: "ready_for_review", changed: true },
    ]);
  });
});
