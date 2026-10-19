import { describe, it, expect, vi } from "vitest";

import { type CapabilityManifest } from "@shared/schema/capabilities/index.js";
import {
    buildPipelineManifest,
    enqueuePipelineSync,
    type PipelineSnapshot,
} from "./capability-canvas.js";

function makeSnapshot(overrides: Partial<PipelineSnapshot> = {}): PipelineSnapshot {
    return {
        id: 5,
        organizationId: 42,
        name: "Invoice Ingest",
        description: "Ingest invoices and extract line items.",
        createdBy: "jane@corp.com",
        governorSettings: null,
        lifecycleStatus: "active",
        inputs: [{ name: "invoice_url", type: "url" }],
        outputs: [{ name: "rows", type: "array" }],
        toolDependencies: ["pdf_extract", "search_knowledge_base"],
        ...overrides,
    };
}

describe("buildPipelineManifest", () => {
    it("maps a pipeline snapshot to a stable, validated manifest", () => {
        const manifest = buildPipelineManifest(makeSnapshot());
        expect(manifest).not.toBeNull();
        expect(manifest!.capability_id).toBe("pipeline_5"); // stable across renames
        expect(manifest!.metadata.display_name).toBe("Invoice Ingest");
        expect(manifest!.metadata.owner).toBe("jane@corp.com");
        expect(manifest!.technical_spec.inputs).toEqual({ invoice_url: "url" });
        expect(manifest!.technical_spec.outputs).toEqual({ rows: "array" });
        expect(manifest!.runtime_context.dependencies).toEqual(["pdf_extract", "search_knowledge_base"]);
    });

    it("defaults risk to Low with no governor and adds no guardrails", () => {
        const manifest = buildPipelineManifest(makeSnapshot({ governorSettings: null }));
        expect(manifest!.runtime_context.risk_profile).toBe("Low");
        expect(manifest!.documentation_meta.guardrails).toEqual([]);
    });

    it("raises risk to Medium for a governed advisory pipeline", () => {
        const manifest = buildPipelineManifest(makeSnapshot({ governorSettings: { enabled: true, mode: "ADVISORY" } }));
        expect(manifest!.runtime_context.risk_profile).toBe("Medium");
        expect(manifest!.documentation_meta.guardrails[0]).toMatch(/Governed pipeline \(mode: ADVISORY\)/);
    });

    it("raises risk to High for an autonomous governed pipeline", () => {
        const manifest = buildPipelineManifest(makeSnapshot({ governorSettings: { enabled: true, mode: "AUTONOMOUS" } }));
        expect(manifest!.runtime_context.risk_profile).toBe("High");
        expect(manifest!.documentation_meta.guardrails[0]).toMatch(/AUTONOMOUS/);
    });

    it("falls back to a placeholder description when none is set", () => {
        const manifest = buildPipelineManifest(makeSnapshot({ description: null }));
        expect(manifest!.metadata.description).toBe("Pipeline: Invoice Ingest");
    });
});

describe("enqueuePipelineSync", () => {
    it("loads, maps and enqueues a code-to-docs job with the pipeline's org", async () => {
        const load = vi.fn(async (_id: number) => makeSnapshot());
        const enqueue = vi.fn(async (_org: number, _m: CapabilityManifest) => ({ id: "job" }));

        const ok = await enqueuePipelineSync(5, { load, enqueue });

        expect(ok).toBe(true);
        expect(load).toHaveBeenCalledWith(5);
        const [org, manifest] = enqueue.mock.calls[0]!;
        expect(org).toBe(42);
        expect(manifest.capability_id).toBe("pipeline_5");
    });

    it("skips (no enqueue) when the pipeline does not exist", async () => {
        const load = vi.fn(async () => null);
        const enqueue = vi.fn(async () => ({ id: "job" }));
        expect(await enqueuePipelineSync(999, { load, enqueue })).toBe(false);
        expect(enqueue).not.toHaveBeenCalled();
    });

    it("skips when the pipeline has no organization (can't attribute)", async () => {
        const load = vi.fn(async () => makeSnapshot({ organizationId: null }));
        const enqueue = vi.fn(async () => ({ id: "job" }));
        expect(await enqueuePipelineSync(5, { load, enqueue })).toBe(false);
        expect(enqueue).not.toHaveBeenCalled();
    });
});
