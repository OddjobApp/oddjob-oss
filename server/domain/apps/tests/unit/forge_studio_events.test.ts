import { describe, expect, it } from "vitest";
import {
    initialForgeStudioState,
    reduceForgeStudio,
    reduceForgeStudioAll,
    toStudioEvents,
    type ForgeStudioEvent,
} from "@shared/forge-studio-events.js";

const S = initialForgeStudioState;

const step = (n: number, label = "Assembly"): ForgeStudioEvent => ({
    type: "step.started", step: n, total: 7, label,
});

/**
 * Reconnection is the whole reason this reducer exists: the spec requires that
 * reconnecting neither duplicates nor loses progress, and the forge streams
 * whole snapshots which are commonly redelivered.
 */
describe("reduceForgeStudio — surviving a reconnect", () => {
    it("does not walk the progress row backwards when earlier frames are replayed", () => {
        let s = reduceForgeStudioAll(S(), [step(0), step(3), step(5)]);
        expect(s.stage).toBe(5);

        s = reduceForgeStudioAll(s, [step(0), step(1), step(3)]);
        expect(s.stage).toBe(5);
    });

    it("is idempotent — the same event twice changes nothing", () => {
        const once = reduceForgeStudio(S(), step(2));
        const twice = reduceForgeStudio(once, step(2));
        expect(twice).toBe(once);
    });

    it("does not revive a finished run when mid-run frames arrive late", () => {
        let s = reduceForgeStudio(S(), { type: "build.completed", appId: 42 });
        s = reduceForgeStudioAll(s, [step(3), { type: "status", message: "Assembling…" }]);

        expect(s.phase).toBe("completed");
        expect(s.appId).toBe(42);
        expect(s.stage).toBeNull();
    });

    it("does not un-write a file that was already written", () => {
        let s = reduceForgeStudio(S(), { type: "file.completed", path: "app/page.tsx" });
        s = reduceForgeStudio(s, { type: "file.started", path: "app/page.tsx" });
        expect(s.files).toEqual([{ path: "app/page.tsx", status: "written" }]);
    });

    it("keeps one entry per component as its status advances", () => {
        const component = { module: "MetricGrid", componentName: "MetricGrid", category: "data", status: "selected" as const };
        let s = reduceForgeStudio(S(), { type: "component.selected", component });
        s = reduceForgeStudio(s, { type: "component.selected", component });
        s = reduceForgeStudio(s, { type: "component.generated", component });

        expect(s.components).toHaveLength(1);
        expect(s.components[0].status).toBe("mounted");
    });

    it("returns the same object when nothing changed, so a replay is cheap", () => {
        const s = reduceForgeStudio(S(), { type: "status", message: "Working" });
        expect(reduceForgeStudio(s, { type: "status", message: "Working" })).toBe(s);
    });
});

describe("reduceForgeStudio — states the spec requires to be visible", () => {
    it("surfaces an approval as its own phase rather than a log line", () => {
        const s = reduceForgeStudio(S(), {
            type: "approval.required",
            approval: { kind: "awaiting_strategy_approval", message: "Review the plan" },
        });
        expect(s.phase).toBe("awaiting_approval");
        expect(s.approval?.kind).toBe("awaiting_strategy_approval");
    });

    it("surfaces a failure with its message", () => {
        const s = reduceForgeStudio(S(), { type: "build.failed", error: { message: "tsc exited 1", stage: 4 } });
        expect(s.phase).toBe("failed");
        expect(s.status).toBe("tsc exited 1");
        expect(s.statusLevel).toBe("error");
    });

    it("marks every declared file written once the build completes", () => {
        let s = reduceForgeStudioAll(S(), [
            { type: "file.started", path: "a.tsx" },
            { type: "file.completed", path: "b.tsx" },
        ]);
        s = reduceForgeStudio(s, { type: "build.completed", appId: 7, slug: "ops" });

        expect(s.files.every((f) => f.status === "written")).toBe(true);
        expect(s.progress).toBe(100);
        expect(s.slug).toBe("ops");
    });

    it("clears a pending approval when the build finishes", () => {
        let s = reduceForgeStudio(S(), {
            type: "approval.required",
            approval: { kind: "awaiting_wave_approval", message: "Wave 1 done" },
        });
        s = reduceForgeStudio(s, { type: "build.completed", appId: 1 });
        expect(s.approval).toBeNull();
    });
});

describe("toStudioEvents — reading the frames the forge already sends", () => {
    it("turns a stage frame into a step and a status", () => {
        const events = toStudioEvents({ stage: 3, message: "UI Assembly: mounting", level: "info", progress: 40 });
        expect(events).toEqual([
            { type: "step.started", step: 3, total: 7, label: "Assembly" },
            { type: "status", message: "UI Assembly: mounting", progress: 40, level: "info" },
        ]);
    });

    it("ignores a stage index the shared list does not hold", () => {
        const events = toStudioEvents({ stage: 99, message: "hm" });
        expect(events.some((e) => e.type === "step.started")).toBe(false);
    });

    it("reads gallery blocks, files and the API contract out of a live assembly", () => {
        const events = toStudioEvents({
            liveAssembly: {
                blocks: [
                    { module: "MetricGrid", componentName: "MetricGrid", category: "data", status: "mounted" },
                    { module: "StatusTimeline", componentName: "StatusTimeline", category: "feedback", status: "selected" },
                ],
                files: ["app/page.tsx"],
                api: { openapi: "3.1.0", basePath: "/api" },
                updatedAt: "2026-09-03T10:00:00.000Z",
            },
        });

        expect(events).toContainEqual(expect.objectContaining({ type: "component.generated" }));
        expect(events).toContainEqual(expect.objectContaining({ type: "component.selected" }));
        expect(events).toContainEqual({ type: "file.completed", path: "app/page.tsx" });
        expect(events).toContainEqual(expect.objectContaining({ type: "api.spec.updated" }));
        expect(events).toContainEqual({ type: "preview.updated", revision: "2026-09-03T10:00:00.000Z" });
    });

    it("recognises an approval gate from the run's own status vocabulary", () => {
        const events = toStudioEvents({ status: "awaiting_architecture_approval", message: "Review the architecture" });
        expect(events).toContainEqual({
            type: "approval.required",
            approval: { kind: "awaiting_architecture_approval", message: "Review the architecture" },
        });
    });

    it("reads a completion only when it carries the app it produced", () => {
        expect(toStudioEvents({ status: "completed" }).some((e) => e.type === "build.completed")).toBe(false);
        expect(toStudioEvents({ status: "completed", appId: 42 })).toContainEqual({
            type: "build.completed", appId: 42, slug: undefined,
        });
    });

    it("survives a malformed frame", () => {
        expect(toStudioEvents(null as any)).toEqual([]);
        expect(toStudioEvents({})).toEqual([]);
        expect(toStudioEvents({ liveAssembly: { blocks: "nope", files: 3 } })).toEqual([]);
    });

    /*
     * The end-to-end property: a frame replayed after reconnect must leave the
     * studio exactly where it already was.
     */
    it("folds a redelivered frame to the same state", () => {
        const frame = { stage: 3, message: "UI Assembly: mounting", liveAssembly: { blocks: [], files: ["a.tsx"] } };
        const once = reduceForgeStudioAll(S(), toStudioEvents(frame));
        const twice = reduceForgeStudioAll(once, toStudioEvents(frame));
        expect(twice).toEqual(once);
    });
});
