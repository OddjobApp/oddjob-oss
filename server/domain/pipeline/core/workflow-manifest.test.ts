/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { stableStringify, type WorkflowReleaseManifest } from "@shared/workflow-release.js";
import { jobDigest, manifestDigest } from "./workflow-manifest.js";

function manifest(overrides: Partial<WorkflowReleaseManifest> = {}): WorkflowReleaseManifest {
    return {
        manifestVersion: 1,
        pipeline: {
            id: 7,
            name: "Lead triage",
            description: null,
            triggerType: "manual",
            triggerCredentialId: null,
            labels: null,
            organizationId: 3,
            governorSettings: null,
            governorPolicyId: null,
            enableKnowledgeGraph: false,
            knowledgeGraphConfig: null,
            monthlyBudgetUsd: null,
        },
        steps: [
            { id: 11, pipelineId: 7, jobId: 5, order: 0, outputName: "triaged" },
            { id: 12, pipelineId: 7, jobId: 9, order: 1, outputName: null },
        ],
        jobs: {
            "5": { id: 5, name: "Score lead", config: { model: "gemini" } },
            "9": { id: 9, name: "Notify" },
        },
        triggers: [],
        dependencies: [
            { kind: "job", id: "5", digest: "x" },
            { kind: "job", id: "9", digest: "y" },
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

const reorderKeys = (v: any): any =>
    Array.isArray(v)
        ? v.map(reorderKeys)
        : v && typeof v === "object"
            ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reorderKeys(x)]))
            : v;

describe("stableStringify", () => {
    it("is insensitive to object key order but preserves array order", () => {
        const a = { b: 2, a: { d: 4, c: 3 } };
        const b = { a: { c: 3, d: 4 }, b: 2 };
        expect(stableStringify(a)).toBe(stableStringify(b));
        expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
    });
});

describe("manifestDigest", () => {
    it("is identical for key-order permutations and different createdAt", () => {
        const a = manifest({ createdAt: "2026-01-01T00:00:00.000Z" });
        const b = reorderKeys(manifest({ createdAt: "2026-06-30T12:00:00.000Z" }));
        expect(manifestDigest(a)).toBe(manifestDigest(b));
    });

    it("changes when a step field changes", () => {
        const a = manifest();
        const b = manifest({
            steps: [
                { id: 11, pipelineId: 7, jobId: 5, order: 0, outputName: "renamed" },
                { id: 12, pipelineId: 7, jobId: 9, order: 1, outputName: null },
            ],
        });
        expect(manifestDigest(a)).not.toBe(manifestDigest(b));
    });

    it("changes when a job's config changes", () => {
        const a = manifest();
        const b = manifest({
            jobs: {
                "5": { id: 5, name: "Score lead", config: { model: "claude" } },
                "9": { id: 9, name: "Notify" },
            },
        });
        expect(manifestDigest(a)).not.toBe(manifestDigest(b));
    });
});

describe("jobDigest", () => {
    it("is stable across key order, sensitive to content", () => {
        const j1 = { id: 5, name: "A", config: { x: 1 } };
        const j2 = { config: { x: 1 }, name: "A", id: 5 };
        expect(jobDigest(j1)).toBe(jobDigest(j2));
        expect(jobDigest({ ...j1, name: "B" })).not.toBe(jobDigest(j1));
    });
});
