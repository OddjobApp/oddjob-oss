import { describe, expect, it } from "vitest";
import { assertRescueTransition, canTransitionRescue } from "./dispatch-policy.js";

describe("rescue dispatch policy", () => {
    it("requires an offer before provider acceptance", () => {
        expect(canTransitionRescue("REQUESTED", "ACCEPTED")).toBe(false);
        expect(canTransitionRescue("REQUESTED", "OFFERED")).toBe(true);
        expect(canTransitionRescue("OFFERED", "ACCEPTED")).toBe(true);
    });

    it("blocks invalid and terminal transitions", () => {
        expect(() => assertRescueTransition("REQUESTED", "ENROUTE")).toThrow("Invalid rescue transition");
        expect(() => assertRescueTransition("CANCELLED", "REQUESTED")).toThrow("terminal");
    });

    it("requires verified arrival before assisting", () => {
        expect(() => assertRescueTransition("ARRIVED", "ASSISTING")).toThrow("Arrival verification");
        expect(() => assertRescueTransition("ARRIVED", "ASSISTING", { arrivalVerified: true })).not.toThrow();
    });

    it("requires operational evidence and confirmation before completion", () => {
        expect(() => assertRescueTransition("ASSISTING", "COMPLETED")).toThrow("Completion requires");
        expect(() => assertRescueTransition("ASSISTING", "COMPLETED", {
            completionEvidence: { providerNotes: "Coolant pump replaced", requesterConfirmed: true },
        })).not.toThrow();
    });
});
