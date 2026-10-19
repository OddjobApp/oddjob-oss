import { describe, expect, it } from "vitest";
import { assembly, keyframe, plotPoint, production, scene, shot, take } from "./fixtures";
import { productionWorkflow, type WorkflowStage } from "./workflow";

const stateOf = (p: ReturnType<typeof production>, stage: WorkflowStage) =>
  productionWorkflow(p).stages.find((s) => s.stage === stage)!.state;

const approvedWithVideo = () => take({ status: "approved", videoUrl: "/api/media-studio/assets/5" });

describe("productionWorkflow", () => {
  it("starts with nothing done and asks for the story", () => {
    const flow = productionWorkflow(production());
    expect(flow.completed).toBe(0);
    expect(flow.stages.every((s) => s.state === "not_started")).toBe(true);
    expect(flow.next).toMatchObject({ stage: "story", title: "Outline the story" });
  });

  it("flags a scene whose manuscript changed since it was derived", () => {
    const p = production({ scenes: [scene({ station: { title: "Arrival", excerpt: "", changed: true } })] });
    expect(stateOf(p, "story")).toBe("needs_attention");
  });

  it("counts a storyboard done only when every plot point has a keyframe with an image", () => {
    const half = production({ scenes: [scene({ plotPoints: [plotPoint({ keyframes: [keyframe()] }), plotPoint({ id: 12 })] })] });
    expect(stateOf(half, "storyboard")).toBe("in_progress");
    expect(productionWorkflow(half).stages[1].summary).toBe("1 of 2");

    const noImage = production({ scenes: [scene({ plotPoints: [plotPoint({ keyframes: [keyframe({ imageUrl: null })] })] })] });
    expect(stateOf(noImage, "storyboard")).not.toBe("done");
  });

  it("puts takes waiting for review ahead of new work", () => {
    const p = production({
      scenes: [scene({ plotPoints: [plotPoint()], shots: [shot({ takes: [take({ status: "ready_for_review" })] })] })],
    });
    expect(stateOf(p, "shots")).toBe("needs_attention");
    expect(productionWorkflow(p).next).toMatchObject({ stage: "shots", title: "Review takes" });
  });

  it("does not count an approved take with no video as a finished shot", () => {
    const p = production({ scenes: [scene({ shots: [shot({ takes: [take({ status: "approved", videoUrl: null })] })] })] });
    expect(stateOf(p, "shots")).not.toBe("done");
  });

  it("recommends assembling once every shot is approved, then nothing once the reel is current", () => {
    const ready = scene({ plotPoints: [plotPoint({ keyframes: [keyframe()] })], shots: [shot({ takes: [approvedWithVideo()] })] });
    expect(productionWorkflow(production({ scenes: [ready] })).next).toMatchObject({ stage: "film", title: "Assemble SCENE-01" });

    const cut = production({ scenes: [{ ...ready, assembly: assembly() }] });
    const flow = productionWorkflow(cut);
    expect(flow.completed).toBe(4);
    expect(flow.next).toBeNull();
  });

  it("flags a reel that no longer matches the approved takes", () => {
    const p = production({ scenes: [scene({ shots: [shot({ takes: [approvedWithVideo()] })], assembly: assembly({ current: false }) })] });
    expect(stateOf(p, "film")).toBe("needs_attention");
    expect(productionWorkflow(p).next).toMatchObject({ stage: "film", title: "Re-cut the reel" });
  });
});
