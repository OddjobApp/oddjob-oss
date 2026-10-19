import { describe, expect, it } from "vitest";
import type { TakeView } from "@shared/media-studio";
import { isRendering, pollInterval } from "./api";
import { assembly, keyframe, plotPoint, production, scene, shot, take } from "./fixtures";

const withTake = (status: TakeView["status"]) =>
  production({ scenes: [scene({ shots: [shot({ takes: [take({ status })] })] })] });

describe("polling a production", () => {
  it("reads quickly while a keyframe or a take renders, slowly while a take waits for approval, and not otherwise", () => {
    expect(pollInterval(production())).toBe(false);
    expect(pollInterval(undefined)).toBe(false);
    expect(pollInterval(production({ scenes: [scene({ plotPoints: [plotPoint({ keyframes: [keyframe({ status: "rendering" })] })] })] }))).toBe(4000);
    expect(pollInterval(withTake("queued"))).toBe(4000);
    expect(isRendering(withTake("rendering"))).toBe(true);
    expect(pollInterval(withTake("pending_approval"))).toBe(15000);
    expect(pollInterval(production({ scenes: [scene({ plotPoints: [plotPoint({ keyframes: [keyframe({ status: "pending_approval" })] })] })] }))).toBe(15000);
    expect(pollInterval(withTake("ready_for_review"))).toBe(false);
    expect(pollInterval(production({ scenes: [scene({ assembly: assembly({ status: "assembling", reelUrl: null }) })] }))).toBe(4000);
    expect(pollInterval(production({ scenes: [scene({ assembly: assembly() })] }))).toBe(false);
  });
});
