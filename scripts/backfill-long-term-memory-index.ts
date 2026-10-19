/**
 * Indexes `agent_long_term_memories` rows that have no point in the vector store.
 *
 * WHY THIS EXISTS
 *
 * Long-term memory recall was a Postgres `ILIKE '%term%'` scan — no vectors were
 * ever written, so there is nothing in Qdrant for any row that predates the
 * vector path in `long-term-memory.service.ts`. Recall now prefers a vector
 * search and falls back to the substring scan when the search returns nothing,
 * which keeps the old behaviour working but means every pre-existing memory is
 * reachable only by literal substring until this script runs.
 *
 * WHY IT ASKS QDRANT RATHER THAN POSTGRES
 *
 * There is no `indexed` column on this table, and that is on purpose. A column
 * stamped at write time is a claim, not a fact — the knowledge-document
 * incident of 2026-08-16 turned on exactly that, where 3,457 rows carried a
 * `qdrant_point_id` for points that did not exist. The only trustworthy answer
 * to "is this row indexed?" is Qdrant's, so this script scrolls the collection
 * and treats absence there as the definition of "needs indexing".
 *
 * WHY IT REFUSES TO RUN WHILE EMBEDDINGS ARE DEGRADED
 *
 * Under a Gemini spending cap the embed endpoint answers 200 with an EMPTY
 * vector rather than an error. An empty vector is refused by upsertQdrantPoints,
 * so a run in that state would report every row as failed — or worse, if a
 * lexical fallback is configured, would write thousands of vectors that look
 * indexed and search badly. The preflight asks the provider directly and aborts
 * unless it answers with a real vector.
 *
 * USAGE
 *
 *   tsx scripts/backfill-long-term-memory-index.ts              # report only
 *   tsx scripts/backfill-long-term-memory-index.ts --apply      # index missing rows
 *   tsx scripts/backfill-long-term-memory-index.ts --org=473 --apply
 *   tsx scripts/backfill-long-term-memory-index.ts --apply --force
 *                                   # re-embed rows already present in Qdrant
 *
 * Exits non-zero if any row still fails to index after an --apply run.
 */

import { and, asc, eq, gt, isNotNull, type SQL } from "drizzle-orm";
import { db } from "../server/db/index.js";
import { agentLongTermMemories } from "../shared/schema/index.js";
import { getClient, checkQdrantHealth } from "../server/integrations/qdrant-client.js";
import { longTermMemoryService, LTM_COLLECTION } from "../server/domain/agents/core/long-term-memory.service.js";

interface Args {
    apply: boolean;
    org: number | null;
    batch: number;
    limit: number | null;
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
        org: org ? Number(org) : null,
        batch: batch ? Math.max(1, Number(batch)) : 200,
        limit: limit ? Number(limit) : null,
        force: argv.includes("--force"),
    };
}

/**
 * Does the real embedding provider answer with a real vector?
 *
 * Asked of the endpoint directly rather than through the service, because the
 * service's job is to degrade gracefully and that is precisely what would hide
 * a capped provider from a backfill.
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

/** Which of these memory ids already have points in the collection. */
async function presentInQdrant(ids: number[]): Promise<Set<number>> {
    const present = new Set<number>();
    if (ids.length === 0) return present;

    const client = getClient();

    try {
        const found = await client.retrieve(LTM_COLLECTION, {
            ids,
            with_payload: false,
            with_vector: false,
        });
        for (const point of found) {
            const id = Number(point.id);
            if (Number.isFinite(id)) present.add(id);
        }
    } catch (err: any) {
        // A collection that does not exist yet means nothing in it is indexed —
        // which is an answer, not a failure.
        if (/not found|doesn'?t exist|does not exist/i.test(err?.message ?? "")) return present;
        throw err;
    }

    return present;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    console.log("Long-term memory vector index backfill");
    console.log(`  mode:       ${args.apply ? "APPLY (will write)" : "report only — pass --apply to index"}`);
    console.log(`  scope:      ${args.org ? `org ${args.org}` : "all orgs"}${args.limit ? `, first ${args.limit} rows` : ""}`);
    console.log(`  collection: ${LTM_COLLECTION}`);
    console.log("");

    const health = await checkQdrantHealth();
    if (!health.healthy) {
        console.error(`Qdrant is not reachable: ${health.error}`);
        process.exit(1);
    }

    if (args.apply) {
        const embeddings = await realEmbeddingsAvailable();
        if (!embeddings.ok) {
            console.error(`Refusing to run: real embeddings are unavailable — ${embeddings.detail}`);
            console.error("Indexing now would write nothing usable. Restore embedding capacity and re-run.");
            process.exit(1);
        }
        console.log(`  embeddings: ${embeddings.detail}`);
        console.log("");
    }

    let cursor = 0;
    let scanned = 0;
    let alreadyIndexed = 0;
    let indexed = 0;
    let failed = 0;
    const failures: number[] = [];

    for (;;) {
        if (args.limit !== null && scanned >= args.limit) break;

        const conditions: SQL[] = [
            gt(agentLongTermMemories.id, cursor),
            isNotNull(agentLongTermMemories.organizationId),
        ];
        if (args.org !== null) {
            conditions.push(eq(agentLongTermMemories.organizationId, args.org));
        }

        const take = args.limit !== null
            ? Math.min(args.batch, args.limit - scanned)
            : args.batch;

        const rows = await db.select()
            .from(agentLongTermMemories)
            .where(and(...conditions))
            .orderBy(asc(agentLongTermMemories.id))
            .limit(take);

        if (rows.length === 0) break;

        cursor = rows[rows.length - 1].id;
        scanned += rows.length;

        const present = args.force
            ? new Set<number>()
            : await presentInQdrant(rows.map((r) => r.id));

        for (const row of rows) {
            if (present.has(row.id)) {
                alreadyIndexed++;
                continue;
            }

            if (!args.apply) {
                indexed++; // counted as "would index"
                continue;
            }

            const ok = await longTermMemoryService.index(row.id, {
                organizationId: row.organizationId!,
                userId: row.userId,
                type: row.type,
                content: row.content,
            });

            if (ok) {
                indexed++;
            } else {
                failed++;
                failures.push(row.id);
            }
        }

        console.log(`  … scanned ${scanned} rows (indexed ${indexed}, already present ${alreadyIndexed}, failed ${failed})`);
    }

    console.log("");
    console.log(`Scanned:         ${scanned}`);
    console.log(`Already indexed: ${alreadyIndexed}`);
    console.log(args.apply ? `Indexed:         ${indexed}` : `Would index:     ${indexed}`);
    if (failed > 0) {
        console.log(`Failed:          ${failed} (ids: ${failures.slice(0, 20).join(", ")}${failures.length > 20 ? ", …" : ""})`);
    }

    if (!args.apply && indexed > 0) {
        console.log("");
        console.log("Re-run with --apply to write these vectors.");
    }

    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
