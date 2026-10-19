import { describe, it, expect } from "vitest";

import type { CapabilityProposal } from "@shared/schema/capabilities/index.js";
import { capabilityGapPrioritizerService } from "./capability-gap-prioritizer.service.js";

function makeProposal(overrides: Partial<CapabilityProposal> = {}): CapabilityProposal {
    return {
        id: 1,
        organizationId: 42,
        proposalKey: "key-1",
        proposedCapabilityId: "extract_invoice_rows",
        classification: "missing",
        title: "Extract invoice rows",
        rationale: "Repeated manual extraction.",
        status: "proposed",
        confidence: 80,
        source: "evolution",
        evidence: [],
        similarCapabilities: [],
        similarityStatus: "available",
        proposedManifest: null,
        promotionResult: null,
        createdBy: "agent",
        reviewedBy: null,
        reviewNote: null,
        reviewedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    } as CapabilityProposal;
}

describe("capabilityGapPrioritizerService", () => {
    describe("when the duplicate check ran", () => {
        it("scores from confidence and evidence count", () => {
            const p = makeProposal({ confidence: 50, evidence: [{ source: "s", summary: "a" }] });
            const [ranked] = capabilityGapPrioritizerService.prioritizeProposals([p]);

            // confidence 50*0.4 = 20, evidence 1*12 = 12 => 32
            expect(ranked.priorityScore).toBe(32);
            expect(ranked.scoreWithheld).toBe(false);
            expect(ranked.similarityStatus).toBe("available");
        });

        // Regression: a `developerVotesWeight` component was published on every
        // ranking while being structurally incapable of being non-zero — no vote
        // store exists and both callers omitted the map.
        it("publishes no scoring component that cannot be non-zero", () => {
            const [ranked] = capabilityGapPrioritizerService.prioritizeProposals([makeProposal()]);
            expect(ranked).not.toHaveProperty("developerVotesWeight");
        });

        it("flags a near-identical existing capability as duplicate risk", () => {
            const p = makeProposal({
                confidence: 100,
                evidence: [{ source: "s", summary: "a" }, { source: "s", summary: "b" }],
                similarCapabilities: [{ capabilityId: "existing", score: 0.93 }],
            });
            const [ranked] = capabilityGapPrioritizerService.prioritizeProposals([p]);
            expect(ranked.recommendation).toBe("duplicate_risk");
        });

        it("treats an empty similarCapabilities as a genuine no-duplicate result", () => {
            const p = makeProposal({ confidence: 100, similarCapabilities: [] });
            const [ranked] = capabilityGapPrioritizerService.prioritizeProposals([p]);
            expect(ranked.recommendation).not.toBe("duplicate_risk");
            expect(ranked.priorityScore).not.toBeNull();
        });
    });

    describe("when the duplicate check did NOT run", () => {
        // The regression this guards: an unavailable similarity search left
        // `similarCapabilities` empty, which scored as "no duplicates", so a
        // duplicate proposal earned its FULL priority exactly when dedup was broken.
        it("withholds the score instead of awarding a clean one", () => {
            const p = makeProposal({
                confidence: 100,
                evidence: [{ source: "s", summary: "a" }, { source: "s", summary: "b" }],
                similarCapabilities: [],
                similarityStatus: "unavailable",
            });
            const [ranked] = capabilityGapPrioritizerService.prioritizeProposals([p]);

            expect(ranked.priorityScore).toBeNull();
            expect(ranked.scoreWithheld).toBe(true);
            expect(ranked.recommendation).toBe("similarity_unavailable");
            expect(ranked.withheldReason).toMatch(/did not run/i);
        });

        it("never returns high_priority_rfc for an unchecked proposal", () => {
            const p = makeProposal({
                confidence: 100,
                evidence: Array.from({ length: 10 }, () => ({ source: "s", summary: "x" })),
                similarityStatus: "unavailable",
            });
            const [ranked] = capabilityGapPrioritizerService.prioritizeProposals([p]);
            expect(ranked.recommendation).toBe("similarity_unavailable");
        });

        it("treats a missing similarityStatus as unavailable, not available", () => {
            const p = makeProposal({ similarityStatus: undefined as any });
            const [ranked] = capabilityGapPrioritizerService.prioritizeProposals([p]);
            expect(ranked.scoreWithheld).toBe(true);
        });

        it("sorts withheld candidates last — unranked, not low-ranked", () => {
            const checked = makeProposal({ id: 1, proposalKey: "a", confidence: 10 });
            const unchecked = makeProposal({
                id: 2,
                proposalKey: "b",
                confidence: 100,
                evidence: Array.from({ length: 5 }, () => ({ source: "s", summary: "x" })),
                similarityStatus: "unavailable",
            });

            const ranked = capabilityGapPrioritizerService.prioritizeProposals([unchecked, checked]);
            expect(ranked.map((r) => r.proposalId)).toEqual([1, 2]);
        });
    });
});
