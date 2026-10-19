/**
 * BlueprintGenerator honours a per-request nCandidates.
 *
 * gms_synthesize_missions advertises nCandidates, but generateCandidates
 * destructured `options` and then never read it — every site used
 * this.config.nCandidates, so asking for a different number changed nothing.
 * These tests drive the count that actually reaches the LLM layer.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("../../../server/domain/ai/core/ai-client.service.js", () => ({
    AIClientFactory: { getClient: () => ({ execute: h.execute }) },
}));

import { BlueprintGenerator } from "@server/core/gms/synthesis/blueprint-generator.js";

/** A proposal the parser will reject, so we exercise counting without full parsing. */
const emptyResponse = { success: true, output: "no blueprint tag here" };

function makeGenerator(config: Record<string, unknown> = {}) {
    return new BlueprintGenerator({ enforceDiversity: false, ...config } as any);
}

beforeEach(() => {
    vi.clearAllMocks();
    h.execute.mockResolvedValue(emptyResponse);
});

describe("BlueprintGenerator nCandidates", () => {
    it("generates the requested number of proposals, not the configured one", async () => {
        const gen = makeGenerator({ nCandidates: 20 });
        await gen.generateCandidates({ request: "do a thing", options: { nCandidates: 3 } } as any);
        expect(h.execute).toHaveBeenCalledTimes(3);
    });

    it("falls back to the configured count when the option is absent", async () => {
        const gen = makeGenerator({ nCandidates: 4 });
        await gen.generateCandidates({ request: "do a thing" } as any);
        expect(h.execute).toHaveBeenCalledTimes(4);
    });

    it("puts the requested count into the generation prompt", async () => {
        const gen = makeGenerator({ nCandidates: 20 });
        await gen.generateCandidates({ request: "do a thing", options: { nCandidates: 2 } } as any);

        const prompt = h.execute.mock.calls[0][0].userPrompt as string;
        expect(prompt).toContain("Generate 2 diverse mission blueprints");
        expect(prompt).toContain("Generate 2 different blueprints");
        expect(prompt).not.toContain("Generate 20 diverse mission blueprints");
    });

    it("labels each generation against the requested total", async () => {
        const gen = makeGenerator({ nCandidates: 20 });
        await gen.generateCandidates({ request: "do a thing", options: { nCandidates: 2 } } as any);

        const prompts = h.execute.mock.calls.map(c => c[0].userPrompt as string);
        expect(prompts.some(p => p.includes("[Generation 1/2]"))).toBe(true);
        expect(prompts.some(p => p.includes("[Generation 2/2]"))).toBe(true);
    });

    it.each([
        ["zero", 0],
        ["negative", -5],
        ["fractional", 2.5],
    ])("ignores a %s request and uses the configured count", async (_label, bad) => {
        const gen = makeGenerator({ nCandidates: 3 });
        await gen.generateCandidates({ request: "do a thing", options: { nCandidates: bad } } as any);
        expect(h.execute).toHaveBeenCalledTimes(3);
    });

    it("does not let the override leak into the next request", async () => {
        const gen = makeGenerator({ nCandidates: 4 });
        await gen.generateCandidates({ request: "first", options: { nCandidates: 1 } } as any);
        expect(h.execute).toHaveBeenCalledTimes(1);

        h.execute.mockClear();
        await gen.generateCandidates({ request: "second" } as any);
        expect(h.execute).toHaveBeenCalledTimes(4);
    });
});
