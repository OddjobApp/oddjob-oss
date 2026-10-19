import { describe, expect, it } from "vitest";
import { parseLinkPredictionReview, parseLinkPredictionStatus } from "./link-prediction-input";

describe("link prediction route input", () => {
    it("accepts canonical statuses and defaults to predicted", () => {
        expect(parseLinkPredictionStatus(undefined)).toBe("predicted");
        expect(parseLinkPredictionStatus("approved")).toBe("approved");
        expect(() => parseLinkPredictionStatus("all")).toThrow("Status must be");
    });

    it("parses valid review requests", () => {
        expect(parseLinkPredictionReview("12", { action: "approve" }))
            .toEqual({ linkId: 12, action: "approve" });
    });

    it("rejects invalid IDs and actions", () => {
        for (const id of ["0", "-1", "1.5", "invalid"]) {
            expect(() => parseLinkPredictionReview(id, { action: "reject" })).toThrow("Invalid predicted link id");
        }
        expect(() => parseLinkPredictionReview("1", { action: "skip" })).toThrow("Action must be");
        expect(() => parseLinkPredictionReview("1", null)).toThrow("must be an object");
    });
});
