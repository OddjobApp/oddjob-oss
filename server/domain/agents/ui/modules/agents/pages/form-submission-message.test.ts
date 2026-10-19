/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { formatSubmissionValue, humanizeFieldKey, parseFormSubmissionMessage, parseStructuredJsonMessage } from "./form-submission-message";

describe("parseFormSubmissionMessage", () => {
    it("extracts the nonce and submitted inputs from the protocol message", () => {
        const inputs = { incidentType: "Structural collapse", address: "Sector 7, Building A", casualties: "3" };
        const content = `[FORM_SUBMISSION] Execute pipeline with nonce abc-123 and inputs: ${JSON.stringify(inputs)}`;
        expect(parseFormSubmissionMessage(content)).toEqual({ nonce: "abc-123", inputs });
    });

    it("ignores ordinary chat messages", () => {
        expect(parseFormSubmissionMessage("dispatch the rescue squad")).toBeNull();
        expect(parseFormSubmissionMessage(undefined)).toBeNull();
        expect(parseFormSubmissionMessage({ type: "input_request" })).toBeNull();
    });

    it("still recognises the marker when the payload is missing or unparseable", () => {
        expect(parseFormSubmissionMessage("[FORM_SUBMISSION]")).toEqual({ nonce: null, inputs: null });
        expect(parseFormSubmissionMessage("[FORM_SUBMISSION] Execute pipeline with nonce n1 and inputs: {oops")).toEqual({ nonce: "n1", inputs: null });
        expect(parseFormSubmissionMessage("[FORM_SUBMISSION] Execute pipeline with nonce n1 and inputs: [1,2]")).toEqual({ nonce: "n1", inputs: null });
    });
});

describe("parseStructuredJsonMessage", () => {
    it("returns whole-content JSON objects and arrays", () => {
        expect(parseStructuredJsonMessage('{"type":"dispatch_update","status":"en_route"}'))
            .toEqual({ type: "dispatch_update", status: "en_route" });
        expect(parseStructuredJsonMessage('  ["a","b"]  ')).toEqual(["a", "b"]);
    });

    it("leaves prose, embedded JSON and primitives alone", () => {
        expect(parseStructuredJsonMessage("Dispatch is on the way.")).toBeNull();
        expect(parseStructuredJsonMessage('Result: {"a":1} — see above')).toBeNull();
        expect(parseStructuredJsonMessage('"just a string"')).toBeNull();
        expect(parseStructuredJsonMessage("42")).toBeNull();
        expect(parseStructuredJsonMessage("{not json")).toBeNull();
        expect(parseStructuredJsonMessage(undefined)).toBeNull();
        expect(parseStructuredJsonMessage({ type: "x" })).toEqual({ type: "x" });
    });
});

describe("humanizeFieldKey", () => {
    it("turns storage keys into labels", () => {
        expect(humanizeFieldKey("incidentType")).toBe("Incident Type");
        expect(humanizeFieldKey("serial_number")).toBe("Serial Number");
        expect(humanizeFieldKey("asset-id")).toBe("Asset Id");
    });
});

describe("formatSubmissionValue", () => {
    it("renders scalars, blanks, arrays and nested records without JSON syntax", () => {
        expect(formatSubmissionValue("Sector 7")).toBe("Sector 7");
        expect(formatSubmissionValue("")).toBe("—");
        expect(formatSubmissionValue(null)).toBe("—");
        expect(formatSubmissionValue(true)).toBe("Yes");
        expect(formatSubmissionValue(false)).toBe("No");
        expect(formatSubmissionValue(["a", "b"])).toBe("a, b");
        expect(formatSubmissionValue({ lat: 34, lng: -118 })).toBe("Lat: 34, Lng: -118");
    });
});
