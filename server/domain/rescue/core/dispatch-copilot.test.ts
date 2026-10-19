import { describe, expect, it } from "vitest";
import { recommendDispatchAction } from "./dispatch-copilot.js";

const session = {
    id: 42,
    status: "OFFERED",
    providerName: "Apex Field Response",
    severity: "Critical",
    userLocation: { lat: 34.05, lng: -118.24, resolvedBy: "map" },
    metadata: {},
    updatedAt: new Date("2026-07-29T16:00:00Z"),
} as any;

describe("dispatch Copilot recommendations", () => {
    it("does not confuse an offer with provider acceptance", () => {
        const result = recommendDispatchAction(session);
        expect(result.recommendedAction).toContain("acceptance deadline");
        expect(result.proposedStatus).toBeUndefined();
        expect(result.requiresApproval).toBe(true);
    });

    it("gates closure on evidence", () => {
        const result = recommendDispatchAction({ ...session, status: "ASSISTING" });
        expect(result.proposedStatus).toBe("COMPLETED");
        expect(result.unresolvedQuestions).toContain("Provider evidence");
    });
});

