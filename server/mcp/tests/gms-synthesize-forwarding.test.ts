/**
 * gms_synthesize_missions parameter forwarding.
 *
 * The tool advertises topK, but it used to be spread into
 * SynthesizeRequest.options — which had no topK field — and dropped. This pins
 * the whole hop: schema -> handler -> orchestrator request.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
    synthesizeMissions: vi.fn().mockResolvedValue({ candidates: [] }),
}));

vi.mock("@server/core/gms/api/gms-orchestrator.js", () => ({
    getGMSOrchestrator: vi.fn(async () => ({ synthesizeMissions: h.synthesizeMissions })),
}));

import { handleGMSSynthesizeMissions } from "../handlers/gms.js";

beforeEach(() => vi.clearAllMocks());

const optionsOf = () => h.synthesizeMissions.mock.calls[0][0].options;

describe("gms_synthesize_missions forwarding", () => {
    it("passes an explicit topK through to the orchestrator", async () => {
        await handleGMSSynthesizeMissions({ request: "triage inbound tickets", topK: 12 });
        expect(h.synthesizeMissions).toHaveBeenCalledTimes(1);
        expect(optionsOf()).toMatchObject({ topK: 12 });
    });

    it("applies the schema default when topK is omitted", async () => {
        await handleGMSSynthesizeMissions({ request: "triage inbound tickets" });
        expect(optionsOf()).toMatchObject({ topK: 5 });
    });

    it("forwards the request text and nCandidates alongside it", async () => {
        await handleGMSSynthesizeMissions({ request: "a request", topK: 7, nCandidates: 30 });
        expect(h.synthesizeMissions.mock.calls[0][0].request).toBe("a request");
        expect(optionsOf()).toMatchObject({ topK: 7, nCandidates: 30 });
    });

    it.each([
        ["zero", 0],
        ["negative", -4],
        ["fractional", 3.5],
    ])("rejects a %s topK at the schema boundary", async (_label, bad) => {
        const result: any = await handleGMSSynthesizeMissions({ request: "a request", topK: bad });
        expect(result).toMatchObject({ isError: true });
        expect(h.synthesizeMissions).not.toHaveBeenCalled();
    });

    it("applies the schema default when nCandidates is omitted", async () => {
        await handleGMSSynthesizeMissions({ request: "a request" });
        expect(optionsOf()).toMatchObject({ nCandidates: 15 });
    });

    it.each([
        ["zero", 0],
        ["negative", -4],
        ["fractional", 3.5],
    ])("rejects a %s nCandidates at the schema boundary", async (_label, bad) => {
        const result: any = await handleGMSSynthesizeMissions({ request: "a request", nCandidates: bad });
        expect(result).toMatchObject({ isError: true });
        expect(h.synthesizeMissions).not.toHaveBeenCalled();
    });

    it("caps nCandidates, since it drives one LLM call per candidate", async () => {
        const result: any = await handleGMSSynthesizeMissions({ request: "a request", nCandidates: 5000 });
        expect(result).toMatchObject({ isError: true });
        expect(h.synthesizeMissions).not.toHaveBeenCalled();

        // The cap itself is still accepted.
        await handleGMSSynthesizeMissions({ request: "a request", nCandidates: 50 });
        expect(optionsOf()).toMatchObject({ nCandidates: 50 });
    });
});
