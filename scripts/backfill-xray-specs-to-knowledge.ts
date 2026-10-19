/**
 * Files existing X-Ray node specs into the knowledge base.
 *
 * WHY THIS EXISTS
 *
 * `saveNodeDocumentation` has always created a knowledge TOPIC per node — the
 * code comment reads "Sync or create Knowledge Topic for global Documentation
 * feature" and the topic id is stored back on the row — but nothing ever created
 * a knowledge DOCUMENT under that topic. On 2026-08-16 all 15 topics held zero
 * documents, so roughly 450KB of hand-written architecture specs (the
 * rescue-dispatch spec alone is 136KB) lived in a table that
 * `search_unified_knowledge` does not read. The folder was created; nothing was
 * ever filed in it.
 *
 * The service now files each spec on save. This backfills everything written
 * before that change.
 *
 * SEQUENCING
 *
 * Filing a document indexes it, so this inherits the embedding preflight logic's
 * reasoning: run it while the Gemini spending cap is active and every spec is
 * indexed with a deterministic LEXICAL vector that will have to be redone. The
 * check below refuses for that reason. Lift the cap first.
 *
 * USAGE
 *
 *   tsx scripts/backfill-xray-specs-to-knowledge.ts            # report only
 *   tsx scripts/backfill-xray-specs-to-knowledge.ts --apply
 *   tsx scripts/backfill-xray-specs-to-knowledge.ts --org=291 --apply
 */

import { and, eq, asc } from "drizzle-orm";
import { db } from "../server/db/index.js";
import { xrayNodeDocumentation } from "../shared/schema/index.js";
import { xrayNodeDetailService } from "../server/domain/xray/core/xray-node-detail.service.js";

function arg(name: string): string | undefined {
    return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

async function realEmbeddingsAvailable(): Promise<{ ok: boolean; detail: string }> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { ok: false, detail: "GEMINI_API_KEY is not set" };
    const model = (process.env.RAG_EMBEDDING_MODEL || "models/gemini-embedding-001").replace(/^models\//, "");
    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model: `models/${model}`, content: { parts: [{ text: "preflight" }] } }),
                signal: AbortSignal.timeout(30_000),
            },
        );
        if (!res.ok) {
            const body = await res.text();
            const message = (() => { try { return JSON.parse(body)?.error?.message ?? body; } catch { return body; } })();
            return { ok: false, detail: `HTTP ${res.status}: ${String(message).trim()}` };
        }
        const dims = (await res.json())?.embedding?.values?.length ?? 0;
        return dims > 0 ? { ok: true, detail: `${dims}-dim vector` } : { ok: false, detail: "200 with an empty vector" };
    } catch (err: any) {
        return { ok: false, detail: err?.message ?? String(err) };
    }
}

async function main() {
    const apply = process.argv.includes("--apply");
    const forceDegraded = process.argv.includes("--force-degraded");
    const org = arg("org") ? Number(arg("org")) : null;

    console.log("X-Ray spec → knowledge base backfill");
    console.log(`  mode:  ${apply ? "APPLY (will write)" : "report only — pass --apply to file them"}`);
    console.log(`  scope: ${org ? `org ${org}` : "all orgs"}`);

    const embeddings = await realEmbeddingsAvailable();
    console.log(`  embeddings: ${embeddings.ok ? "OK" : "DEGRADED"} — ${embeddings.detail}`);
    if (!embeddings.ok && apply && !forceDegraded) {
        console.error("");
        console.error("Refusing to file specs while the real embedding provider is unavailable —");
        console.error("they would all be indexed with lexical vectors and need redoing.");
        console.error("Lift the spending cap (https://ai.studio/spend), then re-run.");
        process.exit(2);
    }
    console.log("");

    const rows = await db
        .select()
        .from(xrayNodeDocumentation)
        .where(org ? and(eq(xrayNodeDocumentation.organizationId, org)) : undefined as any)
        .orderBy(asc(xrayNodeDocumentation.id));

    let filed = 0;
    const failed: Array<{ nodeId: string; reason: string }> = [];

    for (const row of rows) {
        const orgId = row.organizationId;
        if (!orgId) {
            console.log(`  SKIP     ${row.nodeId} — no organization_id`);
            continue;
        }
        if (!row.content?.trim()) {
            console.log(`  SKIP     ${row.nodeId} — empty content`);
            continue;
        }

        const title = xrayNodeDetailService.specDocumentTitle(row.nodeId, row.nodeType);
        if (!apply) {
            console.log(`  WOULD FILE ${row.nodeId} (${(row.content.length / 1024).toFixed(1)}KB) as "${title}"`);
            continue;
        }

        const documentId = await xrayNodeDetailService.mirrorSpecToKnowledgeBase({
            organizationId: orgId,
            nodeId: row.nodeId,
            nodeType: row.nodeType,
            summary: row.summary ?? undefined,
            content: row.content,
            knowledgeTopicId: row.knowledgeTopicId ?? undefined,
            xrayDocumentationId: row.id,
            contentFingerprint: row.contentFingerprint ?? "",
        });

        if (documentId) {
            filed++;
            console.log(`  OK       ${row.nodeId} → document ${documentId}`);
        } else {
            failed.push({ nodeId: row.nodeId, reason: "mirror returned no document id (see KB MIRROR FAILED above)" });
            console.log(`  FAILED   ${row.nodeId}`);
        }
    }

    console.log("");
    console.log(`${rows.length} spec(s) examined.`);
    if (apply) console.log(`Filed: ${filed}. Failed: ${failed.length}.`);
    process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error("Backfill aborted:", err);
    process.exit(1);
});
