import { describe, it, expect } from "vitest";

import { capabilitySignature, safeParseCapabilityManifest, type CapabilityManifest } from "@shared/schema/capabilities/index.js";
import {
    computeSignatureHash,
    computeContentHash,
    diffSignature,
    diffDocumentation,
    formatChangelogEntry,
    mergeWithChangelog,
} from "./capability-reconciler.service.js";

function makeManifest(overrides: Partial<CapabilityManifest> = {}): CapabilityManifest {
    return {
        schema_version: 1,
        capability_version: "1.0.0",
        capability_id: "extract_invoice_rows",
        metadata: {
            display_name: "Extract Invoice Rows",
            category: "Data Operations",
            description: "Extract line items from an invoice image.",
            owner: "data-team",
        },
        technical_spec: {
            inputs: { image_url: "str" },
            outputs: { rows: "list" },
        },
        documentation_meta: {
            summary: "",
            business_use_cases: [],
            guardrails: [],
        },
        runtime_context: {
            risk_profile: "Low",
            execution_environment: "Host",
            dependencies: [],
        },
        ...overrides,
    };
}

describe("signature vs content hashing (the loop-break gate)", () => {
    it("is stable for identical manifests", () => {
        expect(computeSignatureHash(makeManifest())).toBe(computeSignatureHash(makeManifest()));
    });

    it("ignores cosmetic prose: a reworded description keeps the signature hash but changes the content hash", () => {
        const base = makeManifest();
        const reworded = makeManifest({
            metadata: { ...base.metadata, description: "Totally different wording, same behaviour." },
            documentation_meta: { ...base.documentation_meta, summary: "A shiny new summary." },
        });
        // Behaviour unchanged -> gate stays closed (no re-apply, no ping-pong).
        expect(computeSignatureHash(reworded)).toBe(computeSignatureHash(base));
        // But something *did* change, so the full content hash differs.
        expect(computeContentHash(reworded)).not.toBe(computeContentHash(base));
    });

    it("opens the gate when an input data type changes", () => {
        const base = makeManifest();
        const changed = makeManifest({
            technical_spec: { inputs: { image_url: "bytes" }, outputs: { rows: "list" } },
        });
        expect(computeSignatureHash(changed)).not.toBe(computeSignatureHash(base));
    });

    it("validates explicit semantic versions and defaults legacy inputs", () => {
        const legacy = { ...makeManifest() } as any;
        delete legacy.capability_version;
        delete legacy.schema_version;
        expect(safeParseCapabilityManifest(legacy)).toMatchObject({
            success: true,
            data: { capability_version: "1.0.0", schema_version: 1 },
        });
        expect(safeParseCapabilityManifest({ ...makeManifest(), capability_version: "next" }).success).toBe(false);
    });
});

describe("diffSignature", () => {
    it("reports a modified input type with old/new values", () => {
        const base = makeManifest();
        const changed = makeManifest({
            technical_spec: { inputs: { image_url: "bytes" }, outputs: { rows: "list" } },
        });
        const diffs = diffSignature(capabilitySignature(base), changed);
        expect(diffs).toContainEqual(
            expect.objectContaining({ path: "inputs.image_url", changeType: "modified", old: "str", new: "bytes" }),
        );
    });

    it("reports an added guardrail", () => {
        const base = makeManifest();
        const guarded = makeManifest({
            documentation_meta: { summary: "", business_use_cases: [], guardrails: ["Never transmit raw PII"] },
        });
        const diffs = diffSignature(capabilitySignature(base), guarded);
        expect(diffs).toContainEqual(
            expect.objectContaining({ path: "guardrails", changeType: "added", new: "Never transmit raw PII" }),
        );
    });

    it("reports an added and a removed output", () => {
        const base = makeManifest();
        const changed = makeManifest({
            technical_spec: { inputs: { image_url: "str" }, outputs: { total: "float" } },
        });
        const diffs = diffSignature(capabilitySignature(base), changed);
        expect(diffs).toContainEqual(expect.objectContaining({ path: "outputs.rows", changeType: "removed" }));
        expect(diffs).toContainEqual(expect.objectContaining({ path: "outputs.total", changeType: "added" }));
    });
});

describe("diffDocumentation", () => {
    it("reports prose and capability-version changes without calling them behavioral changes", () => {
        const base = makeManifest();
        const changed = makeManifest({
            capability_version: "1.0.1",
            metadata: { ...base.metadata, description: "Clearer documentation." },
        });
        expect(diffDocumentation(base, changed)).toEqual(expect.arrayContaining([
            expect.objectContaining({ path: "capability_version", old: "1.0.0", new: "1.0.1" }),
            expect.objectContaining({ path: "metadata.description" }),
        ]));
        expect(computeSignatureHash(changed)).toBe(computeSignatureHash(base));
    });
});

describe("changelog rendering", () => {
    it("formats a dated entry with per-field lines", () => {
        const entry = formatChangelogEntry(
            [{ path: "risk_profile", changeType: "modified", old: "Low", new: "High" }],
            "code",
            new Date("2026-07-17T00:00:00Z"),
        );
        expect(entry).toContain("[Auto-Changelog 2026-07-17]");
        expect(entry).toContain("(source: code)");
        expect(entry).toContain("modified `risk_profile`: `Low` → `High`");
    });
});

describe("mergeWithChangelog (non-destructive history)", () => {
    const body = "# Extract Invoice Rows\n\nBody paragraph.";

    it("does not append the same change again when a failed run retries", () => {
        // The doc is written before reconciled state is saved; each retry of a
        // run that failed later diffed against the same old state.
        const diff = [{ path: "risk_profile", changeType: "modified" as const, old: "Low", new: "High" }];
        const first = mergeWithChangelog(body, null, diff, "code", new Date("2026-10-03T00:00:00Z"));
        const retry = mergeWithChangelog(body, first, diff, "code", new Date("2026-10-04T00:00:00Z"));
        expect(retry).toBe(first);
        expect(retry.match(/Auto-Changelog/g)).toHaveLength(1);
    });

    it("still records a change that went back and then forth again", () => {
        const up = [{ path: "risk_profile", changeType: "modified" as const, old: "Low", new: "High" }];
        const down = [{ path: "risk_profile", changeType: "modified" as const, old: "High", new: "Low" }];
        let doc = mergeWithChangelog(body, null, up, "code", new Date("2026-10-01T00:00:00Z"));
        doc = mergeWithChangelog(body, doc, down, "code", new Date("2026-10-02T00:00:00Z"));
        doc = mergeWithChangelog(body, doc, up, "code", new Date("2026-10-03T00:00:00Z"));
        expect(doc.match(/Auto-Changelog/g)).toHaveLength(3);
    });

    it("leaves the body untouched when there are no diffs (new capability)", () => {
        expect(mergeWithChangelog(body, null, [], "code")).toBe("# Extract Invoice Rows\n\nBody paragraph.\n");
    });

    it("appends a changelog section on drift", () => {
        const out = mergeWithChangelog(
            body,
            null,
            [{ path: "inputs.image_url", changeType: "modified", old: "str", new: "bytes" }],
            "code",
            new Date("2026-07-17T00:00:00Z"),
        );
        expect(out).toContain("## Change History");
        expect(out).toContain("<!-- ACDD:CHANGELOG -->");
        expect(out).toContain("[Auto-Changelog 2026-07-17]");
    });

    it("preserves prior entries and appends the newest without duplicating the section", () => {
        const first = mergeWithChangelog(
            body,
            null,
            [{ path: "inputs.image_url", changeType: "modified", old: "str", new: "bytes" }],
            "code",
            new Date("2026-07-17T00:00:00Z"),
        );
        const second = mergeWithChangelog(
            "# Extract Invoice Rows\n\nRegenerated body.",
            first,
            [{ path: "guardrails", changeType: "added", old: undefined, new: "Never transmit raw PII" }],
            "docs",
            new Date("2026-07-18T00:00:00Z"),
        );

        expect(second).toContain("2026-07-17"); // prior history retained
        expect(second).toContain("2026-07-18"); // newest appended
        expect(second.match(/## Change History/g)?.length).toBe(1);
        expect(second.match(/<!-- ACDD:CHANGELOG -->/g)?.length).toBe(1);
        expect(second).toContain("Regenerated body."); // body was updated, not overwritten-away
    });
});
