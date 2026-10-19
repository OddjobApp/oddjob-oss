import { describe, expect, it } from "vitest";
import { assessClaimPositions, claimSimilarity } from "./crew-claims.service.js";

describe("claim consensus assessment", () => {
    it("clusters close restatements and exposes dissent", () => {
        const claims = assessClaimPositions([
            { agent: "Research", proposition: "The release should include an approval gate", confidence: 0.9 },
            { agent: "Risk", proposition: "The release should include the approval gate", confidence: 0.8 },
            { agent: "Builder", proposition: "The release should ship without an approval gate", confidence: 0.7 },
        ], [] as any);
        expect(claims).toHaveLength(2);
        expect(claims[0].agreementLevel).toBe(67);
        expect(claims[0].status).toBe("disputed");
        expect(claims[0].positions.filter((p) => p.stance === "support")).toHaveLength(2);
    });

    it("only calls a claim supported when a successful tool backs it", () => {
        const turns = [{
            id: 9, speakerType: "agent", speakerName: "Research", content: "The API returned the current policy.",
            toolsUsed: [{ name: "search_policy", ok: true, ms: 4 }], createdAt: new Date("2026-08-15T00:00:00Z"),
        }] as any;
        const [claim] = assessClaimPositions([
            { agent: "Research", proposition: "The current policy requires approval", confidence: 0.9 },
        ], turns);
        expect(claim.status).toBe("supported");
        expect(claim.evidence[0].label).toContain("search_policy");
        expect(claim.sourceTurnId).toBe(9);
    });

    it("does not merge materially different propositions", () => {
        expect(claimSimilarity("Ship the release today", "Delay the migration until next quarter")).toBeLessThan(0.72);
    });
});
