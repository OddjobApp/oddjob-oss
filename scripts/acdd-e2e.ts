/**
 * ACDD end-to-end harness — drives the real bi-directional loop against live
 * infra (dev DB 5433, Qdrant, Gemini/Ollama embeddings + doc generation).
 * Writes docs to a throwaway temp dir (no repo pollution) and cleans up all
 * state (Qdrant points + DB rows) at the end.
 *
 * Run: npx tsx scripts/acdd-e2e.ts
 */
import "dotenv/config";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const checks: Array<{ label: string; ok: boolean; detail?: string }> = [];
function check(label: string, ok: boolean, detail?: string) {
    checks.push({ label, ok, detail });
    console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "acdd-e2e-"));
    // Point the git-writer at the throwaway dir; keep auto-commit OFF (write-only).
    process.env.ACDD_DOCS_REPO_PATH = tmp;
    process.env.ACDD_GIT_AUTO_COMMIT = "false";
    // Pin the ACDD embedding contract (Gemini) and use a fresh, isolated Qdrant
    // collection so the run has a consistent dim and never touches a real
    // acdd_capabilities__* collection.
    process.env.ACDD_EMBEDDING_PROVIDER = "google";
    process.env.ACDD_EMBEDDING_MODEL = "gemini-embedding-001";
    const collection = `acdd_e2e_${Date.now()}`;
    process.env.ACDD_QDRANT_COLLECTION = collection;

    const { db } = await import("@server/database_service.js");
    const { orgs, capabilitySyncState, capabilityDocFileState } = await import("@shared/schema/index.js");
    const { eq, and } = await import("drizzle-orm");
    const { codeToDocsPipeline } = await import("@domain/capabilities/core/code-to-docs.pipeline.js");
    const { docsToCodePipeline } = await import("@domain/capabilities/core/docs-to-code.pipeline.js");
    const { capabilityRegistry } = await import("@domain/capabilities/core/capability-registry.service.js");

    const [org] = await db.select({ id: orgs.id }).from(orgs).limit(1);
    if (!org) throw new Error("No org in dev DB to attribute the test capability to.");
    const orgId = org.id;
    const capId = "e2e_invoice_rows";
    console.log(`\nACDD E2E — org ${orgId}, capability ${capId}, docs → ${tmp}\n`);

    const dropDbState = async () => {
        await db.delete(capabilitySyncState).where(and(eq(capabilitySyncState.organizationId, orgId), eq(capabilitySyncState.capabilityId, capId)));
        await db.delete(capabilityDocFileState).where(eq(capabilityDocFileState.organizationId, orgId));
    };
    // End-of-run cleanup: DB rows + drop the whole isolated collection + temp dir.
    // (Deliberately does NOT call registry.remove — that would ensureQdrantCollection
    // at the default dim on a fresh name and poison the client's init cache.)
    const cleanup = async () => {
        await dropDbState();
        await import("@server/integrations/qdrant-client.js")
            .then(({ getClient }) => getClient().deleteCollection(collection))
            .catch(() => {});
        await fs.rm(tmp, { recursive: true, force: true });
    };

    await dropDbState(); // clear any DB residue from a prior run (fresh Qdrant collection each run)

    const manifest: any = {
        capability_id: capId,
        metadata: { display_name: "Extract Invoice Rows", category: "Financial Operations", description: "Extract line items from an invoice image.", owner: "e2e" },
        technical_spec: { inputs: { image_url: "str" }, outputs: { rows: "list" } },
        documentation_meta: { summary: "E2E test capability.", business_use_cases: ["invoice automation"], guardrails: ["Never store raw card numbers"] },
        runtime_context: { risk_profile: "Low", execution_environment: "Host", dependencies: [] },
    };

    try {
        // 1. Path A — new capability
        const r1 = await codeToDocsPipeline.run(orgId, manifest);
        check("code→docs (new): applied, isNew, indexed, rev=1", r1.applied && r1.isNew && r1.indexed && r1.revision === 1, `rev=${r1.revision}`);

        const docPath = path.join(tmp, "docs/capabilities", `${capId}.md`);
        const docExists = await fs.stat(docPath).then(() => true).catch(() => false);
        check("doc written to disk", docExists, docPath);

        const [row1] = await db.select().from(capabilitySyncState).where(and(eq(capabilitySyncState.organizationId, orgId), eq(capabilitySyncState.capabilityId, capId)));
        check("reconciler state row persisted (source=code)", !!row1 && row1.lastSource === "code", row1 ? `rev ${row1.revision}` : "missing");

        // 2. Semantic discovery via real embeddings + Qdrant
        const disc = await capabilityRegistry.discover(orgId, "pull the line items out of an invoice picture", 5);
        const hit = disc.find((d) => d.capabilityId === capId);
        check("semantic discover() returns the capability", !!hit, hit ? `score ${hit.score.toFixed(3)}` : `got [${disc.map((d) => d.capabilityId).join(", ")}]`);

        // 3. Idempotency — same manifest, gate closes
        const r2 = await codeToDocsPipeline.run(orgId, manifest);
        check("code→docs (unchanged): gated out (loop break)", r2.applied === false, r2.reason);

        // 4. Drift — changed input type + new output
        const drifted = { ...manifest, technical_spec: { inputs: { image_url: "bytes" }, outputs: { rows: "list", total: "float" } } };
        const r3 = await codeToDocsPipeline.run(orgId, drifted);
        check("code→docs (drift): applied, !isNew, rev=2, has diffs", r3.applied && !r3.isNew && r3.revision === 2 && (r3.changedFields?.length ?? 0) > 0, `rev=${r3.revision}, ${r3.changedFields?.length ?? 0} field change(s)`);

        const docContent = await fs.readFile(docPath, "utf8");
        check("doc has appended Change History", docContent.includes("Change History") && docContent.includes("[Auto-Changelog"));

        // 5. Path B round-trip — ingest the generated doc; loop must terminate
        const relPath = `docs/capabilities/${capId}.md`;
        const ing = await docsToCodePipeline.ingestDoc(orgId, relPath, docContent);
        const terminates = ing.status !== "error";
        check("docs→code round-trip terminates (no crash)", terminates, `status=${ing.status}${ing.reason ? ` (${ing.reason})` : ""}`);

        // 6. Re-ingest identical file — file-hash loop break
        const ing2 = await docsToCodePipeline.ingestDoc(orgId, relPath, docContent);
        check("docs→code re-ingest same file: skipped_unchanged_file", ing2.status === "skipped_unchanged_file", `status=${ing2.status}`);
    } finally {
        await cleanup();
        console.log(`\ncleaned up (Qdrant point + DB rows + temp dir).`);
    }

    const failed = checks.filter((c) => !c.ok);
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
    if (failed.length) {
        console.error(`FAILED: ${failed.map((f) => f.label).join("; ")}`);
        process.exit(1);
    }
    console.log("✅ ACDD end-to-end PASSED against live infra.");
    process.exit(0);
}

main().catch((err) => {
    console.error("E2E crashed:", err);
    process.exit(1);
});
