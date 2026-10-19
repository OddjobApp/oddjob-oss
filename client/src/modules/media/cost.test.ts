import { describe, expect, it } from "vitest";
import { costBreakdown } from "./cost";
import { keyframe, plotPoint, production, scene, shot, take } from "./fixtures";

describe("spend by scene and shot", () => {
  it("counts what was sent, shows what waits for approval apart, and leaves out simulations and declined takes", () => {
    const view = production({
      scenes: [
        scene({
          id: 21, sceneKey: "SCENE-01",
          plotPoints: [plotPoint({ keyframes: [keyframe({ costCents: 4 })] })],
          shots: [
            shot({ id: 31, takes: [take({ id: 51, status: "approved", costCents: 152 }), take({ id: 52, takeNumber: 2, status: "pending_approval", costCents: 152 })] }),
            shot({ id: 32, takes: [take({ id: 53, status: "rejected", costCents: 0 }), take({ id: 54, takeNumber: 2, status: "simulated", mode: "simulation", costCents: 0 })] }),
          ],
        }),
        scene({ id: 22, sceneKey: "SCENE-02", title: "The chase", shots: [shot({ id: 33, takes: [take({ id: 55, status: "failed", costCents: 91 })] })] }),
      ],
    });

    const cost = costBreakdown(view);
    expect(cost.spentCents).toBe(4 + 152 + 91);
    expect(cost.waitingCents).toBe(152);
    expect(cost.scenes.map((s) => [s.sceneKey, s.spentCents, s.waitingCents, s.keyframeCents])).toEqual([["SCENE-01", 156, 152, 4], ["SCENE-02", 91, 0, 0]]);
    expect(cost.scenes[0].shots).toEqual([
      { shotId: 31, shotNumber: 1, spentCents: 152, waitingCents: 152 },
      { shotId: 32, shotNumber: 2, spentCents: 0, waitingCents: 0 },
    ]);
  });
});
