import { describe, it, expect, vi } from "vitest";

import {
    ManifestExtractorService,
    ManifestExtractionError,
    extractJsonObject,
} from "./manifest-extractor.service.js";

const VALID_MANIFEST = {
    schema_version: 1,
    capability_version: "1.0.0",
    capability_id: "extract_invoice_rows",
    metadata: {
        display_name: "Extract Invoice Rows",
        category: "Financial Operations",
        description: "Extract line items from an invoice image.",
        owner: "data-team",
    },
    technical_spec: { inputs: { image_url: "str" }, outputs: { rows: "list" } },
    documentation_meta: { summary: "", business_use_cases: [], guardrails: ["Never store raw card numbers"] },
    runtime_context: { risk_profile: "High", execution_environment: "Isolated Docker Container", dependencies: [] },
};

describe("extractJsonObject", () => {
    it("pulls a JSON object out of prose + code fences", () => {
        const raw = 'Sure, here you go:\n```json\n{ "a": 1, "b": { "c": 2 } }\n```\nThanks!';
        expect(extractJsonObject(raw)).toBe('{ "a": 1, "b": { "c": 2 } }');
    });

    it("respects braces inside string literals", () => {
        const raw = '{ "text": "a } b { c", "n": 1 }';
        expect(extractJsonObject(raw)).toBe(raw);
    });

    it("returns null when there is no object", () => {
        expect(extractJsonObject("no json here")).toBeNull();
    });
});

describe("ManifestExtractorService.extract", () => {
    it("extracts and validates a manifest from fenced JSON", async () => {
        const generate = vi.fn(async () => "```json\n" + JSON.stringify(VALID_MANIFEST) + "\n```");
        const extractor = new ManifestExtractorService({ generate });

        const manifest = await extractor.extract("# Extract Invoice Rows\n\n...doc...");
        expect(generate).toHaveBeenCalledOnce();
        expect(manifest.capability_id).toBe("extract_invoice_rows");
        expect(manifest.runtime_context.risk_profile).toBe("High");
        expect(manifest.documentation_meta.guardrails).toContain("Never store raw card numbers");
    });

    it("applies schema defaults for a minimal JSON object", async () => {
        const minimal = {
            capability_id: "ping_service",
            metadata: { display_name: "Ping", category: "System Utilities", description: "Ping a host." },
            technical_spec: { inputs: { host: "str" }, outputs: { ok: "bool" } },
        };
        const extractor = new ManifestExtractorService({ generate: vi.fn(async () => JSON.stringify(minimal)) });

        const manifest = await extractor.extract("# Ping\n\ndoc");
        expect(manifest.metadata.owner).toBe("unassigned");
        expect(manifest.runtime_context.risk_profile).toBe("Low");
        expect(manifest.runtime_context.execution_environment).toBe("Host");
        expect(manifest.documentation_meta.guardrails).toEqual([]);
    });

    it("retries once with a corrective prompt when the first response is unusable", async () => {
        const generate = vi
            .fn()
            .mockResolvedValueOnce("I cannot help with that.")
            .mockResolvedValueOnce(JSON.stringify(VALID_MANIFEST));
        const extractor = new ManifestExtractorService({ generate });

        const manifest = await extractor.extract("# doc");
        expect(generate).toHaveBeenCalledTimes(2);
        // Second call's prompt should reference the parse failure.
        const [, secondArgs] = generate.mock.calls;
        expect(secondArgs![0].user).toMatch(/could not be parsed/);
        expect(manifest.capability_id).toBe("extract_invoice_rows");
    });

    it("throws ManifestExtractionError when all attempts fail schema validation", async () => {
        const bad = JSON.stringify({ capability_id: "X BAD ID", metadata: {} });
        const extractor = new ManifestExtractorService({ generate: vi.fn(async () => bad), maxAttempts: 2 });

        await expect(extractor.extract("# doc")).rejects.toBeInstanceOf(ManifestExtractionError);
    });

    it("throws on empty markdown without calling the model", async () => {
        const generate = vi.fn(async () => "{}");
        const extractor = new ManifestExtractorService({ generate });
        await expect(extractor.extract("   ")).rejects.toBeInstanceOf(ManifestExtractionError);
        expect(generate).not.toHaveBeenCalled();
    });
});
