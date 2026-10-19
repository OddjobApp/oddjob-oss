import { describe, expect, it } from "vitest";
import { parseExtractionId, parseSingleExtractionInput } from "./knowledge-extraction-input";

describe("knowledge extraction input", () => {
    it("parses a bounded extraction request", () => {
        expect(parseSingleExtractionInput({ documentId: 3, schemaId: 4, priority: 10 }))
            .toEqual({ documentId: 3, schemaId: 4, priority: 10 });
        expect(parseSingleExtractionInput({ documentId: 3, schemaId: 4 }).priority).toBe(0);
    });

    it("rejects invalid IDs", () => {
        for (const id of ["0", "-1", "1.5", "invalid"]) {
            expect(() => parseExtractionId(id, "document")).toThrow("Invalid document ID");
        }
    });

    it("rejects malformed bodies and priorities", () => {
        expect(() => parseSingleExtractionInput(null)).toThrow("must be an object");
        expect(() => parseSingleExtractionInput({ documentId: 1, schemaId: 2, priority: 11 }))
            .toThrow("between 0 and 10");
        expect(() => parseSingleExtractionInput({ documentId: 1, schemaId: 2, priority: 1.5 }))
            .toThrow("between 0 and 10");
    });
});
