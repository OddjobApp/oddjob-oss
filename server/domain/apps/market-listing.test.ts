import { describe, it, expect } from "vitest";
import { listedInMarket } from "./market-listing.js";

describe("listedInMarket", () => {
    it("lists platform built-ins and marketplace listings", () => {
        expect(listedInMarket({ distribution: "standard", config: {} })).toBe(true);
        expect(listedInMarket({ distribution: "listed", config: {} })).toBe(true);
    });

    it("keeps an org's own install copies off the shared shelf", () => {
        expect(listedInMarket({ distribution: "custom", config: {} })).toBe(false);
    });

    it("hides scaffold rows flagged hiddenFromMarket", () => {
        expect(listedInMarket({ distribution: "standard", config: { hiddenFromMarket: true } })).toBe(false);
    });

    it("tolerates a missing config", () => {
        expect(listedInMarket({ distribution: "standard", config: null })).toBe(true);
    });
});
