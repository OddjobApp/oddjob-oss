import { describe, expect, it } from "vitest";
import { restatementScore } from "./crew-orchestrator.service.js";

describe("restatementScore", () => {
    it("scores an identical answer as a full restatement", () => {
        const s = "I need you to clarify what 'RFC Research' means before I can proceed.";
        expect(restatementScore(s, s)).toBe(1);
    });

    it("catches the near-verbatim repeat that prompted this", () => {
        // Copilot's actual turns, one after the other.
        const first =
            "I am aware of the duplication. It was an attempt to reiterate the capabilities of the " +
            "two applications in the context of your request for research capabilities. I need you " +
            "to clarify what 'RFC Research' means to proceed.";
        const second =
            "I am aware of the duplication and it was an attempt to reiterate capabilities; I need " +
            "the user to clarify 'RFC Research' to proceed.";
        expect(restatementScore(first, second)).toBeGreaterThanOrEqual(0.8);
    });

    it("does not flag two genuinely different answers on one subject", () => {
        // The threshold has to tolerate shared vocabulary, or every focused
        // discussion would trip it.
        const a = "The catalogue holds 57 applications; none is named 'RFC Research App'.";
        const b =
            "I checked the knowledge base for RFC synthesis and found a Technical Research " +
            "workbench that may cover what you need.";
        expect(restatementScore(a, b)).toBeLessThan(0.8);
    });

    it("refuses to judge turns too short to be meaningfully compared", () => {
        // "Agreed." shares all of its vocabulary with anything containing the
        // word, so containment would report a perfect restatement.
        expect(restatementScore("the a of in on", "a the in on of")).toBe(0);
        expect(restatementScore("Agreed with that.", "Agreed with that point entirely.")).toBe(0);
    });

    it("is symmetric", () => {
        const a = "consensus reached on the deployment plan";
        const b = "the deployment plan reached consensus";
        expect(restatementScore(a, b)).toBe(restatementScore(b, a));
    });

    it("returns zero rather than dividing by zero on empty input", () => {
        expect(restatementScore("", "anything at all here")).toBe(0);
        expect(restatementScore("anything at all here", "")).toBe(0);
    });

    it("does not treat a short answer as a restatement of a long one", () => {
        // "Yes." after a paragraph is a new contribution, not an echo.
        const long = "The catalogue holds 57 applications across several categories and blueprints.";
        expect(restatementScore(long, "Agreed.")).toBeLessThan(0.8);
    });
});
