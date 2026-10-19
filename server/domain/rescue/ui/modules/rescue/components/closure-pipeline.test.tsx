/**
 * The Resolve button executed `for (const pipelineId of [23, 24])`.
 *
 * Those ids are "Agent Performance & Training — Failure Analysis" and
 * "— Training Direction Sign-off", both in org 291 — nothing to do with rescue
 * dispatch. /api/pipelines is org-scoped, so for any other organization the lookup
 * simply failed and the operator got "Pipeline not found".
 *
 * Hardcoding a different id would only relocate the bug: the closure pipeline exists
 * per organization (35 in org 291, 165 in org 342) and some orgs have none. So the
 * pipeline is resolved by name against the caller's own org.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveClosurePipelineIds, CLOSURE_PIPELINE_NAME } from "./TacticalDispatchDashboard";

const realFetch = globalThis.fetch;
const mockFetch = (impl: any) => { globalThis.fetch = impl as any; };

afterEach(() => { globalThis.fetch = realFetch; });

const ok = (body: any) => async () => ({ ok: true, status: 200, json: async () => body });

describe("resolveClosurePipelineIds", () => {
    it("finds the closure pipeline for the caller's org", async () => {
        mockFetch(ok([
            { id: 10, name: "Service Dispatch Pipeline — Process Incident Intake" },
            { id: 165, name: CLOSURE_PIPELINE_NAME },
        ]));
        await expect(resolveClosurePipelineIds()).resolves.toEqual([165]);
    });

    it("accepts the { pipelines: [...] } envelope too", async () => {
        mockFetch(ok({ pipelines: [{ id: 35, name: CLOSURE_PIPELINE_NAME }] }));
        await expect(resolveClosurePipelineIds()).resolves.toEqual([35]);
    });

    it("never returns the old hardcoded training pipelines", async () => {
        mockFetch(ok([
            { id: 23, name: "Agent Performance & Training — Failure Analysis" },
            { id: 24, name: "Agent Performance & Training — Training Direction Sign-off" },
            { id: 165, name: CLOSURE_PIPELINE_NAME },
        ]));
        const ids = await resolveClosurePipelineIds();
        expect(ids).not.toContain(23);
        expect(ids).not.toContain(24);
        expect(ids).toEqual([165]);
    });

    it("names the missing pipeline when the org has none", async () => {
        mockFetch(ok([{ id: 10, name: "Something Else" }]));
        await expect(resolveClosurePipelineIds()).rejects.toThrow(/has no "Service Dispatch Pipeline/);
    });

    it("reports a failed pipeline listing rather than pretending there are none", async () => {
        mockFetch(async () => ({ ok: false, status: 403, json: async () => ({}) }));
        await expect(resolveClosurePipelineIds()).rejects.toThrow(/Could not load pipelines.*403/);
    });

    it("ignores rows with a missing or non-integer id", async () => {
        mockFetch(ok([
            { id: null, name: CLOSURE_PIPELINE_NAME },
            { id: 165, name: CLOSURE_PIPELINE_NAME },
        ]));
        await expect(resolveClosurePipelineIds()).resolves.toEqual([165]);
    });
});
