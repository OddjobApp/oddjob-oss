/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { renderNotificationText, type RenderFinished } from "../core/render-notifications.js";

const finished = (over: Partial<RenderFinished> = {}): RenderFinished => ({
    organizationId: 1,
    productionId: 9,
    productionTitle: "Pajamas and Coffee",
    crewSessionId: 419,
    takeId: 44,
    takeNumber: 2,
    sceneTitle: "SCENE-01 Kitchen",
    shotPosition: 3,
    outcome: "ready",
    ...over,
});

describe("what the inbox says about a finished render", () => {
    it("names the take, the production and where in it", () => {
        expect(renderNotificationText(finished())).toEqual({
            title: "Take 2 is ready to review",
            description: "Pajamas and Coffee — SCENE-01 Kitchen, shot 3 finished rendering and is waiting for a decision.",
        });
    });

    it("says why when the render failed", () => {
        const text = renderNotificationText(finished({ outcome: "failed", detail: "ComfyUI ran out of memory" }));
        expect(text.title).toBe("Take 2 could not be rendered");
        expect(text.description).toContain("failed: ComfyUI ran out of memory");
    });

    it("still says something when the provider gave no reason", () => {
        // A failure notification that reads "failed: undefined" is worse than none.
        expect(renderNotificationText(finished({ outcome: "failed", detail: null })).description)
            .toContain("failed: no reason was given");
    });

    it("keeps a runaway provider message out of the inbox", () => {
        const text = renderNotificationText(finished({ outcome: "failed", detail: "x".repeat(5000) }));
        expect(text.description.length).toBeLessThan(300);
    });

    it("drops the dash when there is no scene or shot to name", () => {
        // An em dash with nothing after it is how a half-filled template looks.
        const text = renderNotificationText(finished({ sceneTitle: null, shotPosition: null }));
        expect(text.description).toBe("Pajamas and Coffee finished rendering and is waiting for a decision.");
        expect(text.description).not.toContain("—");
    });

    it("names the scene alone when the shot has no position", () => {
        expect(renderNotificationText(finished({ shotPosition: null })).description)
            .toBe("Pajamas and Coffee — SCENE-01 Kitchen finished rendering and is waiting for a decision.");
    });
});
