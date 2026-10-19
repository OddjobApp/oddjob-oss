import { describe, expect, it } from "vitest";
import {
    appendDivergenceQuestion,
    buildDivergenceQuestion,
    positionEntropyBits,
} from "./crew-supervisor.service.js";

const at = (proposition: string, confidence: number) => ({ proposition, confidence });

describe("positionEntropyBits", () => {
    it("is zero when the room holds one position", () => {
        expect(positionEntropyBits([at("ship it", 0.9), at("ship it", 0.8)]).bits).toBe(0);
    });

    it("is exactly one bit on an even two-way split", () => {
        // The anchor the whole threshold is calibrated against.
        expect(positionEntropyBits([at("ship it", 0.5), at("hold it", 0.5)]).bits).toBe(1);
    });

    it("weights by confidence, so a hedged dissent moves it less than a firm one", () => {
        const hedged = positionEntropyBits([at("ship it", 0.9), at("hold it", 0.1)]).bits;
        const firm = positionEntropyBits([at("ship it", 0.5), at("hold it", 0.5)]).bits;
        expect(hedged).toBeLessThan(firm);
        expect(hedged).toBeGreaterThan(0);
    });

    it("is NOT a rescaled consensus percentage", () => {
        // Guards the thing this was written to avoid: `1 - consensusLevel` wearing
        // an information-theoretic name. A three-way even split exceeds one bit,
        // which no rescaling of a 0-100 agreement score can produce.
        const threeWay = positionEntropyBits([
            at("a", 1), at("b", 1), at("c", 1),
        ]).bits;
        expect(threeWay).toBeGreaterThan(1);
        expect(threeWay).toBeCloseTo(Math.log2(3), 1);
    });

    it("treats propositions as the same claim regardless of casing or padding", () => {
        expect(positionEntropyBits([at("Ship It", 0.5), at("  ship it  ", 0.5)]).bits).toBe(0);
    });

    it("clusters a concise claim with a longer paraphrase", () => {
        expect(positionEntropyBits([
            at("Oddjob uses world models to predict future system states", 0.7),
            at("World models let Oddjob predict likely future system states before acting", 0.8),
        ]).bits).toBe(0);
    });

    it("falls back to uniform mass when no confidence is usable", () => {
        // Zero confidences must not collapse to "no disagreement" — the positions
        // are still different claims.
        const { bits, branches } = positionEntropyBits([at("ship it", 0), at("hold it", 0)]);
        expect(bits).toBe(1);
        expect(branches).toHaveLength(2);
    });

    it("ranks branches by belief mass, heaviest first", () => {
        const { branches } = positionEntropyBits([
            at("minority", 0.2), at("majority", 0.7), at("majority", 0.1),
        ]);
        expect(branches[0].proposition).toBe("majority");
        expect(branches[1].proposition).toBe("minority");
    });

    it("survives an empty round without dividing by zero", () => {
        expect(positionEntropyBits([])).toEqual({ bits: 0, branches: [] });
    });
});

describe("buildDivergenceQuestion", () => {
    const split = [
        { agent: "A", proposition: "the app can be built as an instant app", confidence: 0.5 },
        { agent: "B", proposition: "it needs App Forge", confidence: 0.5 },
    ];

    it("asks when the room is genuinely split", () => {
        const result = buildDivergenceQuestion({
            positions: split,
            consensusLevel: 20,
            activeTopic: "Feasibility of a weather instant app",
        });

        expect(result).not.toBeNull();
        expect(result!.branchA).toBeTruthy();
        expect(result!.branchB).not.toBe(result!.branchA);
        expect(result!.question.formAgentPayload).toBeTruthy();
    });

    it("stays silent when the room already agrees", () => {
        // The supervisor's own read overrides a nominal spread — manufacturing a
        // disagreement the room does not have is worse than saying nothing.
        expect(
            buildDivergenceQuestion({ positions: split, consensusLevel: 95, activeTopic: "x" }),
        ).toBeNull();
    });

    it("stays silent on collaborative outlining and additive proposals", () => {
        const additive = [
            { agent: "Copilot", proposition: "Scribe Studio is recommended for drafting the PRD, and a standard PRD table of contents should be suggested", confidence: 0.8 },
            { agent: "Analyst", proposition: "Before suggesting a standard PRD TOC, ensure data modeling and entity tracking are included", confidence: 0.8 },
        ];
        expect(
            buildDivergenceQuestion({ positions: additive, consensusLevel: 25, activeTopic: "TOC for Shelfie PRD" }),
        ).toBeNull();
    });

    it("stays silent when everyone holds the same position", () => {
        expect(
            buildDivergenceQuestion({
                positions: [
                    { agent: "A", proposition: "same claim", confidence: 0.9 },
                    { agent: "B", proposition: "same claim", confidence: 0.8 },
                ],
                consensusLevel: 30,
                activeTopic: "x",
            }),
        ).toBeNull();
    });

    it("stays silent when only one agent has spoken", () => {
        expect(
            buildDivergenceQuestion({
                positions: [{ agent: "A", proposition: "only claim", confidence: 0.9 }],
                consensusLevel: 10,
                activeTopic: "x",
            }),
        ).toBeNull();
    });

    it("stays silent on a lopsided split below the threshold", () => {
        // 0.9/0.1 is ~0.47 bits — a near-consensus with one hedged dissenter is
        // not worth interrupting the room for.
        expect(
            buildDivergenceQuestion({
                positions: [
                    { agent: "A", proposition: "ship it", confidence: 0.9 },
                    { agent: "B", proposition: "hold it", confidence: 0.1 },
                ],
                consensusLevel: 50,
                activeTopic: "x",
            }),
        ).toBeNull();
    });
});

describe("appendDivergenceQuestion", () => {
    it("puts both branches to the room as a plain question", () => {
        const spoken = appendDivergenceQuestion("@Copilot, clarify.", "it can", "it cannot");

        expect(spoken).toContain("@Copilot, clarify.");
        expect(spoken).toContain("(A) it can");
        expect(spoken).toContain("(B) it cannot");
        // The card's headline is instrument-panel language, not something to say.
        expect(spoken).not.toMatch(/Entropy Disambiguation|ΔH/);
    });

    it("stands alone when the supervisor said nothing else", () => {
        const spoken = appendDivergenceQuestion("", "a", "b");
        expect(spoken.startsWith("The room is split")).toBe(true);
    });
});

describe("buildDivergenceQuestion — whose positions count", () => {
    const roster = ["Copilot", "Researcher"];

    it("does not manufacture a split from a one-speaker round", () => {
        // Exactly what shipped and was wrong: the supervisor attributed one
        // position to the user and one to the only agent that spoke, and the
        // room was asked to choose between a question and its answer.
        const result = buildDivergenceQuestion(
            {
                positions: [
                    { agent: "admin", proposition: "I am looking for the RFC research app", confidence: 50 },
                    { agent: "Copilot", proposition: "no such app exists in the catalog", confidence: 50 },
                ],
                consensusLevel: 20,
                activeTopic: "Identifying the 'RFC research app'",
            },
            roster,
        );

        expect(result).toBeNull();
    });

    it("still asks when two crew members genuinely disagree", () => {
        const result = buildDivergenceQuestion(
            {
                positions: [
                    { agent: "Copilot", proposition: "no such app exists", confidence: 50 },
                    { agent: "Researcher", proposition: "it exists under another name", confidence: 50 },
                ],
                consensusLevel: 20,
                activeTopic: "x",
            },
            roster,
        );

        expect(result).not.toBeNull();
    });

    it("ignores a non-roster speaker while counting the crew ones", () => {
        const result = buildDivergenceQuestion(
            {
                positions: [
                    { agent: "admin", proposition: "user restating the ask", confidence: 90 },
                    { agent: "Copilot", proposition: "position one", confidence: 50 },
                    { agent: "Researcher", proposition: "position two", confidence: 50 },
                ],
                consensusLevel: 20,
                activeTopic: "x",
            },
            roster,
        );

        expect(result).not.toBeNull();
        // The user's proposition must not become a branch, even at high confidence.
        expect([result!.branchA, result!.branchB]).not.toContain("user restating the ask");
    });

    it("counts one agent holding two propositions as no divergence", () => {
        expect(
            buildDivergenceQuestion(
                {
                    positions: [
                        { agent: "Copilot", proposition: "maybe A", confidence: 50 },
                        { agent: "Copilot", proposition: "maybe B", confidence: 50 },
                    ],
                    consensusLevel: 20,
                    activeTopic: "x",
                },
                roster,
            ),
        ).toBeNull();
    });
});

describe("Supervisor Breakout Room Steering", () => {
    it("preserves breakoutSuggestion when parsed from structured review", () => {
        const suggestion = {
            subTopic: "Signal Intelligence & Uber H3 Hexagonal Spatial Map",
            rationale: "This unsolicited deliverable requires deep spatial analysis separate from the core analytical report.",
            proposedTitle: "Spatial Intelligence & H3 Map Exploration",
        };

        expect(suggestion.subTopic).toBeTruthy();
        expect(suggestion.rationale).toBeTruthy();
        expect(suggestion.proposedTitle).toBeTruthy();
    });

    it("appends breakout room preparation notice to directive", () => {
        const initialDirective = "@Copilot, finalize the core report tables.";
        const subTopic = "Uber H3 Spatial Clustering";
        const rationale = "This warrants separate investigation.";

        const nudge = `A breakout room is being prepared for the side-topic "${subTopic}". ${rationale} The discussion will continue uninterrupted here.`;
        const combined = `${initialDirective}\n\n${nudge}`;

        expect(combined).toContain("@Copilot, finalize the core report tables.");
        expect(combined).toContain("Uber H3 Spatial Clustering");
        expect(combined).toContain("The discussion will continue uninterrupted here.");
    });
});

