import { describe, expect, it } from "vitest";
import { toFilmShots } from "./film";
import { scene, shot, take } from "./fixtures";

describe("a saved scene in the Film view", () => {
  it("numbers shots in order and uses each shot's approved take, else its latest", () => {
    const shots = toFilmShots(scene({
      sceneKey: "SCENE-02",
      shots: [
        shot({ id: 1, durationSeconds: 4, transition: "crossfade", takes: [take({ id: 10, takeNumber: 1, status: "approved", costCents: 150 }), take({ id: 11, takeNumber: 2, status: "ready_for_review" })] }),
        shot({ id: 2, takes: [take({ id: 20, takeNumber: 1, status: "rejected" }), take({ id: 21, takeNumber: 2, status: "simulated", videoUrl: null })] }),
        shot({ id: 3, takes: [] }),
      ],
    }));

    expect(shots.map((s) => [s.shotNumber, s.sceneId, s.activeTakeIndex, s.takes.length])).toEqual([[1, "SCENE-02", 0, 2], [2, "SCENE-02", 1, 2], [3, "SCENE-02", 0, 0]]);
    expect(shots[0]).toMatchObject({ durationSeconds: 4, transition: "crossfade" });
    expect(shots[0].takes[0]).toMatchObject({ takeId: "10", status: "approved", costUsd: 1.5 });
    expect(shots[1].takes[1].videoUrl).toBeUndefined();
  });

  it("shows a take's cost only once its render was sent", () => {
    const [filmed] = toFilmShots(scene({
      shots: [shot({ takes: [
        take({ id: 1, status: "pending_approval", costCents: 152 }),
        take({ id: 2, status: "simulated", mode: "simulation", costCents: 0 }),
        take({ id: 3, status: "rejected", costCents: 0 }),
        take({ id: 4, status: "failed", costCents: 152 }),
      ] })],
    }));
    expect(filmed.takes.map((t) => t.costUsd)).toEqual([undefined, undefined, undefined, 1.52]);
  });
});
