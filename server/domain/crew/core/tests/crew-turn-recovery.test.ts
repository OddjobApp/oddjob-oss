/**
 * Getting something worth posting out of a turn that came back silent, or
 * repeated itself.
 *
 * Both recoveries exist because of a specific way turns used to be lost. A
 * lookup that ran and matched nothing had its turn discarded, so "show me the
 * RFC Research App" returned an empty room and the user could not tell a
 * missing app from a hung request. And an agent that answered three times in a
 * row with the same words had nothing watching for it but a line in the prompt
 * asking it not to.
 *
 * Neither had any coverage, so what is pinned here is the shape of the
 * decisions: when a turn is skipped outright, when it is retried, when a
 * factual fallback is posted instead, and which generation the turn ends up
 * attributed to.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const generate = vi.fn();
const recordPrediction = vi.fn();

vi.mock("../crew-generation.service.js", () => ({
    crewGenerationService: { generate },
}));

vi.mock("../crew-beliefs.service.js", () => ({
    crewBeliefsService: { recordPrediction, heldBeliefs: vi.fn(async () => []) },
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

const { resolveTurnContent } = await import("../crew-speaker-turn.service.js");

const gen = (content: string, modelId = 1, latencyMs = 10) => ({
    content,
    toolCalls: [],
    modelId,
    latencyMs,
});

const CARD = { id: 1, name: "Copilot" } as any;
const NEXT = { id: 2, name: "Analyst" } as any;

const ok = (name: string) => ({ name, ok: true, ms: 1 });
const failed = (name: string) => ({ name, ok: false, ms: 1, error: "boom" });

function resolve(overrides: Record<string, unknown> = {}) {
    const cost = { modelCalls: 0, generationMs: 0, toolCalls: 0 };
    const scope = {
        cost,
        card: CARD,
        orgId: 7,
        session: { id: 42 },
        round: 3,
        nextSpeaker: NEXT,
        messages: [{ role: "system", content: "you are copilot" }],
        result: gen("A considered answer."),
        toolsUsed: [],
        artifacts: [],
        priorTurns: [],
        roundTurns: [],
        ...overrides,
    } as any;
    return { cost, scope, run: resolveTurnContent(scope) };
}

describe("speaker turn recovery", () => {
    beforeEach(() => {
        generate.mockReset();
        recordPrediction.mockReset();
    });

    it("passes a real answer through without spending another generation", async () => {
        const { cost, run } = resolve();
        // Non-null: each case's setup guarantees content. Typed now that this
        // calls the exported function rather than reaching through `as any`.
        const out = (await run)!;

        expect(out.visible).toBe("A considered answer.");
        expect(generate).not.toHaveBeenCalled();
        expect(cost.modelCalls).toBe(0);
    });

    it("peels the prediction off so it never reaches the transcript", async () => {
        const { run } = resolve({
            result: gen("The queue should shard by tenant.\nPREDICTION (Analyst): will want numbers"),
        });
        // Non-null: each case's setup guarantees content. Typed now that this
        // calls the exported function rather than reaching through `as any`.
        const out = (await run)!;

        expect(out.visible).toBe("The queue should shard by tenant.");
        expect(out.visible).not.toContain("PREDICTION");
        expect(recordPrediction).toHaveBeenCalledWith(
            expect.objectContaining({
                prediction: expect.objectContaining({
                    predictorAgentCardId: 1,
                    subjectAgentCardId: 2,
                    predictedPosition: "will want numbers",
                }),
            }),
        );
    });

    it("records no prediction when this speaker is last", async () => {
        const { run } = resolve({
            nextSpeaker: null,
            result: gen("An answer.\nPREDICTION (Analyst): will want numbers"),
        });
        // Non-null: each case's setup guarantees content. Typed now that this
        // calls the exported function rather than reaching through `as any`.
        const out = (await run)!;

        expect(out.visible).toBe("An answer.");
        expect(recordPrediction).not.toHaveBeenCalled();
    });

    it("skips the turn when nothing was said and nothing was attempted", async () => {
        const { run } = resolve({ result: gen("") });

        // Legitimate in a multi-speaker discussion: the agent had nothing to add.
        expect(await run).toBeNull();
        expect(generate).not.toHaveBeenCalled();
    });

    it("retries once, without tools, when a turn that used tools said nothing", async () => {
        generate.mockResolvedValueOnce(gen("It is not installed."));

        const { cost, run } = resolve({
            result: gen(""),
            toolsUsed: [ok("list_installed_apps")],
        });
        // Non-null: each case's setup guarantees content. Typed now that this
        // calls the exported function rather than reaching through `as any`.
        const out = (await run)!;

        expect(generate).toHaveBeenCalledTimes(1);
        expect(generate.mock.calls[0][3]).toMatchObject({ temperature: 0.7, maxTokens: 300 });
        // Removing the option to call anything leaves prose as the only reply.
        expect(generate.mock.calls[0][3].tools).toBeUndefined();
        expect(out.visible).toBe("It is not installed.");
        expect(cost.modelCalls).toBe(1);
    });

    it("attributes the turn to the retry that actually produced the text", async () => {
        generate.mockResolvedValueOnce(gen("It is not installed.", 99, 55));

        const { run } = resolve({
            result: gen("", 1, 10),
            toolsUsed: [ok("list_installed_apps")],
        });
        // Non-null: each case's setup guarantees content. Typed now that this
        // calls the exported function rather than reaching through `as any`.
        const out = (await run)!;

        expect(out.result.modelId).toBe(99);
        expect(out.result.latencyMs).toBe(55);
    });

    it("names humanized sources it consulted when it stays silent twice", async () => {
        generate.mockResolvedValueOnce(gen(""));

        const { run } = resolve({
            result: gen(""),
            toolsUsed: [ok("list_installed_apps"), ok("google_search"), failed("browse_web")],
        });
        // Non-null: each case's setup guarantees content. Typed now that this
        // calls the exported function rather than reaching through `as any`.
        const out = (await run)!;

        expect(out.visible).toBe(
            "I checked installed applications, web search but could not put together an answer from what came back.",
        );
        // A failed lookup is not something it "checked".
        expect(out.visible).not.toContain("web sources");
    });

    it("distinguishes reasoning turns from factual lookups on empty-turn retry", async () => {
        generate.mockResolvedValueOnce(gen("For a weather app, I recommend..."));

        const { run } = resolve({
            result: gen(""),
            toolsUsed: [ok("search_unified_knowledge")],
            userMessage: "what would you put in a weather app?",
        });
        const out = (await run)!;

        expect(generate).toHaveBeenCalledTimes(1);
        const retryMessage = generate.mock.calls[0][2].slice(-1)[0].content;
        expect(retryMessage).toContain("Draw upon your reasoning and domain expertise");
        expect(out.visible).toBe("For a weather app, I recommend...");
    });

    it("says the lookup failed when every tool it called failed", async () => {
        generate.mockResolvedValueOnce(gen(""));

        const { run } = resolve({ result: gen(""), toolsUsed: [failed("google_search")] });
        // Non-null: each case's setup guarantees content. Typed now that this
        // calls the exported function rather than reaching through `as any`.
        const out = (await run)!;

        expect(out.visible).toBe(
            "I tried to look this up but the lookup failed, so I have nothing reliable to report.",
        );
    });

    it("keeps a silent turn that produced an artifact", async () => {
        const { run } = resolve({
            result: gen(""),
            artifacts: [{ tool: "render_app_surface", payload: { type: "instant_app" } }],
        });
        // Non-null: each case's setup guarantees content. Typed now that this
        // calls the exported function rather than reaching through `as any`.
        const out = (await run)!;

        // Skipping here would drop a rendered surface the user can see.
        expect(out).not.toBeNull();
        expect(out.visible).toContain("nothing reliable to report");
        expect(generate).not.toHaveBeenCalled();
    });

    it("retries once at a higher temperature when the agent repeats itself", async () => {
        const said = "We should shard the ingest queue by tenant identifier for isolation.";
        generate.mockResolvedValueOnce(gen("Here is a costing instead."));

        const { run } = resolve({
            result: gen(said),
            priorTurns: [{ id: 9, speakerType: "agent", agentCardId: 1, content: said }],
        });
        // Non-null: each case's setup guarantees content. Typed now that this
        // calls the exported function rather than reaching through `as any`.
        const out = (await run)!;

        expect(generate).toHaveBeenCalledTimes(1);
        expect(generate.mock.calls[0][3]).toMatchObject({ temperature: 0.9, maxTokens: 400 });
        expect(out.visible).toBe("Here is a costing instead.");
    });

    it("does not attribute the turn to a restatement retry", async () => {
        const said = "We should shard the ingest queue by tenant identifier for isolation.";
        generate.mockResolvedValueOnce(gen("Here is a costing instead.", 99, 55));

        const { run } = resolve({
            result: gen(said, 1, 10),
            priorTurns: [{ id: 9, speakerType: "agent", agentCardId: 1, content: said }],
        });
        // Non-null: each case's setup guarantees content. Typed now that this
        // calls the exported function rather than reaching through `as any`.
        const out = (await run)!;

        // That pass only rewords; the work belongs to the generation before it.
        expect(out.result.modelId).toBe(1);
        expect(out.result.latencyMs).toBe(10);
    });

    it("lets the turn stand when the restatement retry throws", async () => {
        const said = "We should shard the ingest queue by tenant identifier for isolation.";
        generate.mockRejectedValueOnce(new Error("provider down"));

        const { run } = resolve({
            result: gen(said),
            priorTurns: [{ id: 9, speakerType: "agent", agentCardId: 1, content: said }],
        });
        // Non-null: each case's setup guarantees content. Typed now that this
        // calls the exported function rather than reaching through `as any`.
        const out = (await run)!;

        expect(out.visible).toBe(said);
    });

    it("lets the turn stand when the retry comes back empty", async () => {
        const said = "We should shard the ingest queue by tenant identifier for isolation.";
        generate.mockResolvedValueOnce(gen(""));

        const { run } = resolve({
            result: gen(said),
            priorTurns: [{ id: 9, speakerType: "agent", agentCardId: 1, content: said }],
        });
        // Non-null: each case's setup guarantees content. Typed now that this
        // calls the exported function rather than reaching through `as any`.
        const out = (await run)!;

        expect(out.visible).toBe(said);
    });

    it("ignores another agent's near-identical turn", async () => {
        const said = "We should shard the ingest queue by tenant identifier for isolation.";

        const { run } = resolve({
            result: gen(said),
            priorTurns: [{ id: 9, speakerType: "agent", agentCardId: 2, content: said }],
        });
        await run;

        // Agreeing with the previous speaker is not restating yourself.
        expect(generate).not.toHaveBeenCalled();
    });
});
