import { describe, expect, it, vi } from "vitest";
import { approvalAction, newestTakeOf, reshootAction } from "./take-actions";
import { production, scene, shot, take } from "./fixtures";

const film = scene({
  sceneKey: "SCENE-01",
  shots: [
    shot({ id: 31, takes: [take({ id: 51, takeNumber: 1, status: "approved" }), take({ id: 52, takeNumber: 2, status: "ready_for_review" })] }),
    shot({ id: 32, takes: [take({ id: 61, takeNumber: 1, status: "ready_for_review" })] }),
  ],
});

describe("take actions that can be undone", () => {
  it("undoes an approval by bringing back the take approved before, or sending the take back to review", async () => {
    const calls: string[] = [];
    const send = vi.fn(async (_method: "POST", url: string) => { calls.push(url); return production(); });
    const action = approvalAction(film, [52, 61], send);
    expect(action.label).toBe("Approved 2 takes in SCENE-01");
    expect(approvalAction(film, [52], send).label).toBe("Approved take 2 of SCENE-01 shot 1");

    await action.undo();
    expect(calls).toEqual(["/api/media-studio/takes/61/unapprove", "/api/media-studio/takes/51/approve"]);
    calls.length = 0;
    await action.redo();
    expect(calls).toEqual(["/api/media-studio/takes/52/approve", "/api/media-studio/takes/61/approve"]);
  });

  it("undoes a re-shoot by withdrawing its new take and restoring the take it replaced, and redoes it as a new request", async () => {
    const calls: Array<[string, unknown]> = [];
    const afterRedo = production({ scenes: [scene({ shots: [shot({ id: 31, takes: [take({ id: 51, takeNumber: 1 }), take({ id: 52, takeNumber: 2 }), take({ id: 99, takeNumber: 3 })] })] })] });
    const send = vi.fn(async (_method: "POST", url: string, body?: unknown) => { calls.push([url, body]); return afterRedo; });
    const action = reshootAction(film, [{ takeId: 51, newTakeId: 70, defectClass: "wrong_framing", notes: "tighter" }], send);
    expect(action.label).toBe("Asked to re-shoot SCENE-01 shot 1");

    await action.undo();
    expect(calls.map(([url]) => url)).toEqual([
      "/api/media-studio/takes/70/withdraw",
      "/api/media-studio/takes/51/reopen",
      "/api/media-studio/takes/51/approve",
    ]);

    calls.length = 0;
    await action.redo();
    expect(calls).toEqual([["/api/media-studio/takes/51/reshoot", { defectClass: "wrong_framing", notes: "tighter" }]]);

    // Undoing the redo withdraws the take the redo asked for, not the first one.
    calls.length = 0;
    await action.undo();
    expect(calls[0][0]).toBe("/api/media-studio/takes/99/withdraw");
  });

  it("finds the take a re-shoot added", () => {
    const after = production({ scenes: [scene({ shots: [shot({ takes: [take({ id: 51, takeNumber: 1 }), take({ id: 80, takeNumber: 2 })] })] })] });
    expect(newestTakeOf(after, 51)).toBe(80);
    expect(newestTakeOf(after, 80)).toBeNull();
    expect(newestTakeOf(after, 12345)).toBeNull();
  });
});
