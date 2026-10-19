import { describe, it, expect, vi } from "vitest";

import { type CapabilityManifest } from "@shared/schema/capabilities/index.js";
import { dispatchCapabilitySyncJob, type DispatchDeps } from "./capability-sync-queue.js";

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

function makeDeps() {
    const codeToDocs = { run: vi.fn(async () => ({ applied: true })) };
    const docsToCode = {
        ingestFile: vi.fn(async () => ({ status: "registered" })),
        ingestFolder: vi.fn(async () => [{ status: "registered" }]),
    };
    return { deps: { codeToDocs, docsToCode } as unknown as DispatchDeps, codeToDocs, docsToCode };
}

describe("dispatchCapabilitySyncJob", () => {
    it("routes code-to-docs to the Path A pipeline", async () => {
        const { deps, codeToDocs, docsToCode } = makeDeps();
        const manifest = makeManifest();

        await dispatchCapabilitySyncJob({ kind: "code-to-docs", organizationId: 7, manifest }, deps);

        expect(codeToDocs.run).toHaveBeenCalledWith(7, manifest);
        expect(docsToCode.ingestFile).not.toHaveBeenCalled();
        expect(docsToCode.ingestFolder).not.toHaveBeenCalled();
    });

    it("routes docs-to-code-file to ingestFile", async () => {
        const { deps, codeToDocs, docsToCode } = makeDeps();

        await dispatchCapabilitySyncJob(
            { kind: "docs-to-code-file", organizationId: 3, absPath: "/repo/docs/capabilities/x.md" },
            deps,
        );

        expect(docsToCode.ingestFile).toHaveBeenCalledWith(3, "/repo/docs/capabilities/x.md");
        expect(codeToDocs.run).not.toHaveBeenCalled();
    });

    it("routes docs-to-code-folder to ingestFolder", async () => {
        const { deps, docsToCode } = makeDeps();

        await dispatchCapabilitySyncJob({ kind: "docs-to-code-folder", organizationId: 3, dir: "/repo/docs" }, deps);

        expect(docsToCode.ingestFolder).toHaveBeenCalledWith(3, "/repo/docs");
    });
});
