import { describe, expect, it } from "vitest";
import { normalizeExtractionResult } from "./extraction-normalizer";

describe("normalizeExtractionResult", () => {
    it("defaults missing collections to empty arrays", () => {
        expect(normalizeExtractionResult({})).toEqual({ entities: [], relationships: [] });
    });

    it("rejects non-object responses", () => {
        expect(normalizeExtractionResult(null)).toBeNull();
        expect(normalizeExtractionResult([])).toBeNull();
        expect(normalizeExtractionResult("invalid")).toBeNull();
    });

    it("drops malformed entities and relationships", () => {
        expect(normalizeExtractionResult({
            entities: [
                { name: "Oddjob", label: "Organization" },
                { name: "Missing label" },
                null,
            ],
            relationships: [
                { source: "Oddjob", target: "Missions", relation: "supports" },
                { source: "Oddjob", relation: "missing_target" },
            ],
        })).toEqual({
            entities: [{ name: "Oddjob", label: "Organization" }],
            relationships: [{ source: "Oddjob", target: "Missions", relation: "supports" }],
        });
    });
});
