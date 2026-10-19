import { describe, it, expect, vi } from "vitest";

import { type CapabilityManifest } from "@shared/schema/capabilities/index.js";
import { CodeToDocsPipeline, type CodeToDocsDeps } from "./code-to-docs.pipeline.js";
import type { CommitResult } from "./git-doc-writer.service.js";
import type { ReconcileDecision } from "./capability-reconciler.service.js";

function makeManifest(): CapabilityManifest {
    return {
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
        documentation_meta: { summary: "", business_use_cases: [], guardrails: [] },
        runtime_context: { risk_profile: "Low", execution_environment: "Host", dependencies: [] },
    };
}

const sampleCommit: CommitResult = {
    capabilityId: "extract_invoice_rows",
    docPath: "docs/capabilities/extract_invoice_rows.md",
    branch: "feature/current",
    written: true,
    committed: true,
    pushed: false,
    requiresReview: false,
    message: "Committed.",
};

function makeDeps(decision: ReconcileDecision, existing: string | null = null) {
    const reconciler = {
        decide: vi.fn(async () => decision),
        commit: vi.fn(async () => ({ revision: 3 }) as any),
    };
    const registry = { register: vi.fn(async () => {}) };
    const compiler = { compile: vi.fn(async () => "# 💳 Extract Invoice Rows\n\nCompiled body.") };
    const writer = {
        readExisting: vi.fn(async (_id: string) => existing),
        write: vi.fn(async (_id: string, _markdown: string, _risk: any) => sampleCommit),
    };
    const publisher = { publish: vi.fn(async () => {}) };
    const deps: CodeToDocsDeps = { reconciler, registry, compiler, writer, publisher };
    return { deps, reconciler, registry, compiler, writer, publisher };
}

describe("CodeToDocsPipeline.run", () => {
    it("stops early when the reconciler gates the run out (no drift)", async () => {
        const { deps, compiler, writer, registry, reconciler } = makeDeps({
            apply: false,
            isNew: false,
            reason: "already in sync (signature unchanged)",
            changedFields: [],
            signatureHash: "x",
            contentHash: "y",
            changeKind: "none",
        });
        const result = await new CodeToDocsPipeline(deps).run(1, makeManifest());

        expect(result.applied).toBe(false);
        expect(result.reason).toMatch(/already in sync/);
        expect(compiler.compile).not.toHaveBeenCalled();
        expect(writer.write).not.toHaveBeenCalled();
        expect(registry.register).not.toHaveBeenCalled();
        expect(reconciler.commit).not.toHaveBeenCalled();
    });

    it("compiles, writes, indexes and commits state for a NEW capability without a changelog", async () => {
        const { deps, writer, registry, reconciler, publisher } = makeDeps({
            apply: true,
            isNew: true,
            reason: "new capability",
            changedFields: [],
            signatureHash: "x",
            contentHash: "y",
            changeKind: "new",
        });
        const result = await new CodeToDocsPipeline(deps).run(7, makeManifest());

        expect(result.applied).toBe(true);
        expect(result.isNew).toBe(true);
        expect(result.indexed).toBe(true);
        expect(result.revision).toBe(3);
        expect(registry.register).toHaveBeenCalledWith(7, expect.objectContaining({ capability_id: "extract_invoice_rows" }));
        expect(publisher.publish).toHaveBeenCalledWith(expect.objectContaining({
            organizationId: 7,
            revision: 1,
            changeKind: "new",
            contentHash: "y",
        }));

        // New capability => no Change History section written.
        const [, writtenMd] = writer.write.mock.calls[0]!;
        expect(writtenMd).not.toContain("## Change History");
        // State persisted with the exact markdown that was written.
        expect(reconciler.commit).toHaveBeenCalledWith(7, expect.anything(), "code", { docMarkdown: writtenMd });
    });

    it("appends a dated changelog entry on drift, preserving existing history", async () => {
        const existing =
            "# 💳 Extract Invoice Rows\n\nOld body.\n\n---\n\n## Change History\n\n<!-- ACDD:CHANGELOG -->\n\n- **[Auto-Changelog 2026-07-01]** (source: code) — 1 field change(s):\n  - added `guardrails`: `—` → `no PII`";
        const { deps, writer } = makeDeps(
            {
                apply: true,
                isNew: false,
                reason: "behavioural drift detected",
                changedFields: [{ path: "inputs.image_url", changeType: "modified", old: "str", new: "bytes" }],
                signatureHash: "x",
                contentHash: "y",
                changeKind: "behavioral",
            },
            existing,
        );

        await new CodeToDocsPipeline(deps).run(7, makeManifest());

        const [, writtenMd] = writer.write.mock.calls[0]!;
        expect(writtenMd).toContain("## Change History");
        expect(writtenMd).toContain("2026-07-01"); // prior entry preserved
        expect(writtenMd).toContain("modified `inputs.image_url`: `str` → `bytes`"); // new entry appended
        expect(writtenMd.match(/<!-- ACDD:CHANGELOG -->/g)?.length).toBe(1); // single marker
    });

    it("does NOT persist sync state if indexing fails (retry-safe ordering)", async () => {
        const { deps, reconciler, registry } = makeDeps({
            apply: true,
            isNew: true,
            reason: "new capability",
            changedFields: [],
            signatureHash: "x",
            contentHash: "y",
            changeKind: "new",
        });
        registry.register = vi.fn(async () => {
            throw new Error("embedding provider down");
        });
        deps.registry = registry;

        await expect(new CodeToDocsPipeline(deps).run(7, makeManifest())).rejects.toThrow(/embedding provider down/);
        expect(reconciler.commit).not.toHaveBeenCalled();
    });

    it("does NOT persist sync state if Documentation publication fails", async () => {
        const { deps, reconciler, publisher } = makeDeps({
            apply: true,
            isNew: true,
            reason: "new capability",
            changedFields: [],
            signatureHash: "x",
            contentHash: "y",
            changeKind: "new",
        });
        publisher.publish.mockRejectedValueOnce(new Error("change register unavailable"));

        await expect(new CodeToDocsPipeline(deps).run(7, makeManifest())).rejects.toThrow(/change register unavailable/);
        expect(reconciler.commit).not.toHaveBeenCalled();
    });
});
