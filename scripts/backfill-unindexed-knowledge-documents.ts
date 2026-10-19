/**
 * Reindexes knowledge documents that are absent from the vector store.
 *
 * WHY THIS EXISTS
 *
 * On 2026-08-16 every knowledge document ingested during August — 3,457 rows
 * across every org — was recorded as indexed while no corresponding point
 * existed in Qdrant. Four defects stacked to produce that, and all four are now
 * fixed; this script repairs the data they left behind.
 *
 *   1. Under a Gemini spending cap the API answers 429, but the LangChain
 *      embedding wrapper resolved with a ZERO-LENGTH vector instead of
 *      rejecting. The Ollama/deterministic fallback never fired, because there
 *      was no error to inspect.
 *   2. Qdrant refused the empty vector ("expected dim: 768, got 0") — an error
 *      that names no document.
 *   3. That refusal was swallowed by a non-blocking `.catch(log)` in
 *      documentService.createDocument.
 *   4. `qdrant_point_id` is stamped at INSERT, before indexing is attempted, so
 *      the row went on claiming to be indexed.
 *
 * The user-visible result: a research mission wrote three briefings to the
 * knowledge base, and the crew room that requested them spent 38 rounds telling
 * the user no such documentation existed.
 *
 * WHY IT DOES NOT TRUST `qdrant_point_id`
 *
 * Defect 4 means the column lies for every row written before the fix: they all
 * carry a point id, and none of the points exist. Selecting on
 * `qdrant_point_id IS NULL` would therefore find almost nothing. The only
 * trustworthy signal is Qdrant itself, so this script asks it directly, in
 * batches, and treats absence there as the definition of "needs reindexing".
 *
 * (Going forward the column IS trustworthy — the fix clears it when indexing
 * fails — but this script keeps verifying regardless. It costs one scroll per
 * batch and removes a class of "the repair tool believed the broken field".)
 *
 * WHY IT REFUSES TO RUN WHILE THE CAP IS ON
 *
 * With the cap still in place, embedding falls back to a deterministic LEXICAL
 * vector. That indexes without error and searches without error — it is simply
 * much worse, and indistinguishable after the fact from a real embedding. A
 * backfill run in that state would write thousands of vectors that look
 * repaired and would all have to be redone. So the preflight checks the real
 * embedding endpoint and aborts unless it answers. `--force-degraded` exists for
 * the deliberate case; it is not the normal path.
 *
 * USAGE
 *
 *   tsx scripts/backfill-unindexed-knowledge-documents.ts               # report only
 *   tsx scripts/backfill-unindexed-knowledge-documents.ts --apply       # repair
 *   tsx scripts/backfill-unindexed-knowledge-documents.ts --org=291     # one org
 *   tsx scripts/backfill-unindexed-knowledge-documents.ts --limit=50 --apply
 *   tsx scripts/backfill-unindexed-knowledge-documents.ts --apply --force
 *                                       # reindex even documents already present
 *   tsx scripts/backfill-unindexed-knowledge-documents.ts --stamp-only --apply
 *                                       # stamp qdrant_point_id for documents that
 *                                       # ARE present, embedding nothing
 *
 * `--force` matters after a `--force-degraded` run: those documents are present
 * in Qdrant, just carrying lexical vectors, so the presence check would skip
 * precisely the rows that still need real embeddings.
 *
 * Exits non-zero if any document still fails to verify after a repair attempt.
 */

import { randomUUID } from "node:crypto";
import { and, asc, gt, isNotNull, sql, eq } from "drizzle-orm";
import { db } from "../server/db/index.js";
import { knowledgeDocuments } from "../shared/schema/index.js";
import { getClient, checkQdrantHealth } from "../server/integrations/qdrant-client.js";
import { reindexKnowledgeDocument } from "../server/domain/knowledge/core/knowledge-store.js";

const ASSET_TYPE = "Knowledge Document";

interface Args {
    apply: boolean;
    /** Stamp qdrant_point_id for documents already present, embedding nothing. */
    stampOnly: boolean;
    org: number | null;
    batch: number;
    limit: number | null;
    forceDegraded: boolean;
    force: boolean;
}

function parseArgs(argv: string[]): Args {
    const get = (name: string): string | undefined =>
        argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

    const org = get("org");
    const limit = get("limit");
    const batch = get("batch");

    return {
        apply: argv.includes("--apply"),
        stampOnly: argv.includes("--stamp-only"),
        org: org ? Number(org) : null,
        batch: batch ? Math.max(1, Number(batch)) : 200,
        limit: limit ? Number(limit) : null,
        forceDegraded: argv.includes("--force-degraded"),
        force: argv.includes("--force"),
    };
}

/** The org's Qdrant shard. Must match getShardedCollection in rag-langchain.service. */
function shardFor(organizationId: number): string {
    return `oddjob_org_${organizationId}`;
}

/**
 * Does the real embedding provider answer?
 *
 * Asked of the Gemini endpoint directly rather than through the LangChain
 * wrapper, because the wrapper is precisely what hides this: it converts a 429
 * into an empty vector and a resolved promise.
 */
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
                body: JSON.stringify({
                    model: `models/${model}`,
                    content: { parts: [{ text: "embedding preflight" }] },
                }),
                signal: AbortSignal.timeout(30_000),
            },
        );
        if (!res.ok) {
            const body = await res.text();
            const message = (() => {
                try { return JSON.parse(body)?.error?.message ?? body; } catch { return body; }
            })();
            return { ok: false, detail: `HTTP ${res.status}: ${String(message).trim()}` };
        }
        const data = await res.json();
        const dims = data?.embedding?.values?.length ?? 0;
        return dims > 0
            ? { ok: true, detail: `${model} responded with a ${dims}-dim vector` }
            : { ok: false, detail: `${model} returned 200 with an empty vector` };
    } catch (err: any) {
        return { ok: false, detail: err?.message ?? String(err) };
    }
}

/** Which of these document ids already have points in the org's shard. */
/**
 * Record that this document is in the vector store.
 *
 * The column is a marker, not the point key (a document is many chunk points),
 * and the contract everywhere else is that it is written only once presence is
 * confirmed - so it is only ever called after a successful presence check.
 */
async function stampIndexed(doc: { id: number; qdrantPointId?: string | null }): Promise<void> {
    if (doc.qdrantPointId) return;
    await db
        .update(knowledgeDocuments)
        .set({ qdrantPointId: randomUUID(), updatedAt: new Date() })
        .where(eq(knowledgeDocuments.id, doc.id));
}

async function presentInQdrant(organizationId: number, ids: number[]): Promise<Set<number>> {
    const present = new Set<number>();
    if (ids.length === 0) return present;

    const client = getClient();
    const collection = shardFor(organizationId);

    let offset: unknown = undefined;
    do {
        let page: any;
        try {
            page = await client.scroll(collection, {
                limit: 1000,
                offset: offset as any,
                with_payload: ["assetId"],
                with_vector: false,
                filter: {
                    must: [
                        { key: "assetId", match: { any: ids } },
                        { key: "assetType", match: { value: ASSET_TYPE } },
                    ],
                },
            });
        } catch (err: any) {
            // A shard that does not exist yet means nothing in it is indexed —
            // which is an answer, not a failure.
            if (/not found|doesn'?t exist|does not exist/i.test(err?.message ?? "")) return present;
            throw err;
        }

        for (const point of page?.points ?? []) {
            const assetId = (point.payload as any)?.assetId;
            if (typeof assetId === "number") present.add(assetId);
        }
        offset = page?.next_page_offset ?? undefined;
    } while (offset !== undefined && offset !== null);

    return present;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    console.log("Knowledge document reindex backfill");
    console.log(`  mode:  ${args.apply ? "APPLY (will write)" : "report only — pass --apply to repair"}`);
    console.log(`  scope: ${args.org ? `org ${args.org}` : "all orgs"}${args.limit ? `, first ${args.limit} documents` : ""}`);
    console.log("");

    const health = await checkQdrantHealth();
    if (!health.healthy) {
        console.error(`Qdrant is not reachable: ${health.error}`);
        process.exit(1);
    }

    const embeddings = await realEmbeddingsAvailable();
    console.log(`  embeddings: ${embeddings.ok ? "OK" : "DEGRADED"} — ${embeddings.detail}`);
    if (!embeddings.ok && args.apply && !args.forceDegraded) {
        console.error("");
        console.error("Refusing to backfill with the real embedding provider unavailable.");
        console.error("Every document would be indexed with a deterministic LEXICAL vector, which");
        console.error("succeeds silently and would all have to be redone. Lift the spending cap");
        console.error("first (https://ai.studio/spend), then re-run.");
        console.error("");
        console.error("Pass --force-degraded only if lexical-quality indexing is what you want.");
        process.exit(2);
    }
    if (!embeddings.ok && args.apply && args.forceDegraded) {
        console.log("");
        console.log("  !! Indexing with LEXICAL fallback vectors. These documents will then look");
        console.log("  !! indexed and a later run would SKIP them. After lifting the cap, re-run");
        console.log("  !! this script with --force to redo them with real embeddings.");
    }
    console.log("");

    const where = args.org
        ? and(isNotNull(knowledgeDocuments.organizationId), eq(knowledgeDocuments.organizationId, args.org))
        : isNotNull(knowledgeDocuments.organizationId);

    let cursor = 0;
    let scanned = 0;
    let missing = 0;
    let repaired = 0;
    let stamped = 0;
    const failed: Array<{ id: number; reason: string }> = [];

    for (;;) {
        if (args.limit !== null && scanned >= args.limit) break;

        const take = args.limit !== null ? Math.min(args.batch, args.limit - scanned) : args.batch;
        const rows = await db
            .select()
            .from(knowledgeDocuments)
            .where(and(where, gt(knowledgeDocuments.id, cursor), sql`length(coalesce(${knowledgeDocuments.textContent}, '')) > 0`))
            .orderBy(asc(knowledgeDocuments.id))
            .limit(take);

        if (rows.length === 0) break;
        cursor = rows[rows.length - 1].id;
        scanned += rows.length;

        // Group the batch by org so each shard is asked once.
        const byOrg = new Map<number, typeof rows>();
        for (const row of rows) {
            const org = row.organizationId as number;
            if (!byOrg.has(org)) byOrg.set(org, [] as any);
            byOrg.get(org)!.push(row);
        }

        for (const [org, orgRows] of byOrg) {
            // --force ignores presence. Needed after a --force-degraded run:
            // those documents ARE present, just indexed with lexical vectors, so
            // presence alone would skip exactly the rows that need redoing.
            const present = args.force
                ? new Set<number>()
                : await presentInQdrant(org, orgRows.map((r) => r.id));
            const absent = orgRows.filter((r) => !present.has(r.id));
            missing += absent.length;

            // --stamp-only repairs the bookkeeping left by earlier runs of this
            // script, which indexed the vectors and never wrote the column.
            if (args.stampOnly) {
                for (const doc of orgRows.filter((r) => present.has(r.id) && !r.qdrantPointId)) {
                    if (!args.apply) {
                        console.log(`  UNSTAMPED doc ${doc.id} (org ${org}) :: present in Qdrant, column NULL`);
                        continue;
                    }
                    await stampIndexed(doc);
                    stamped++;
                    console.log(`  STAMPED  doc ${doc.id} (org ${org}) :: ${String(doc.title).slice(0, 60)}`);
                }
                continue;
            }

            for (const doc of absent) {
                if (!args.apply) {
                    console.log(`  MISSING  doc ${doc.id} (org ${org}) :: ${String(doc.title).slice(0, 70)}`);
                    continue;
                }
                try {
                    await reindexKnowledgeDocument(doc);
                } catch (err: any) {
                    failed.push({ id: doc.id, reason: err?.message ?? String(err) });
                    console.log(`  FAILED   doc ${doc.id} (org ${org}): ${err?.message ?? err}`);
                    continue;
                }

                // Read back. An upsert that reports success and leaves nothing
                // behind is the exact failure this script exists to repair, so
                // it is not taken on trust here either.
                const verify = await presentInQdrant(org, [doc.id]);
                if (verify.has(doc.id)) {
                    // Stamp the marker column, now that the point is known to
                    // exist. Without this the repair leaves the row reading
                    // "never indexed": index-backfill.service selects on
                    // `qdrant_point_id IS NULL` and would embed all of these
                    // again, and every "unindexed documents" count stays wrong.
                    await stampIndexed(doc);
                    repaired++;
                    console.log(`  OK       doc ${doc.id} (org ${org}) :: ${String(doc.title).slice(0, 60)}`);
                } else {
                    failed.push({ id: doc.id, reason: "reindex reported success but no point is present" });
                    console.log(`  UNVERIFIED doc ${doc.id} (org ${org}) — reindexed, still absent`);
                }
            }
        }
    }

    console.log("");
    console.log(`Scanned ${scanned} document(s); ${missing} absent from the vector store.`);
    if (args.stampOnly) {
        console.log(args.apply
            ? `Stamped qdrant_point_id on ${stamped} document(s) already present in the vector store.`
            : "Re-run with --apply to stamp them.");
        process.exit(0);
    }
    if (args.apply) {
        console.log(`Repaired and verified: ${repaired}. Failed: ${failed.length}.`);
        if (failed.length > 0) {
            console.log("");
            for (const f of failed.slice(0, 20)) console.log(`  doc ${f.id}: ${f.reason}`);
            if (failed.length > 20) console.log(`  … and ${failed.length - 20} more`);
        }
    } else if (missing > 0) {
        console.log("Re-run with --apply to repair them.");
    }

    process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error("Backfill aborted:", err);
    process.exit(1);
});
