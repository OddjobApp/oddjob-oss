/**
 * Measures long-term memory recall quality: vector search vs the substring scan
 * it replaced.
 *
 * WHY THIS EXISTS
 *
 * The MemoryOS integration proposal claimed "48.36% improvement in F1" with no
 * citation and no local baseline. Those are LoCoMo numbers from the MemoryOS
 * paper — long multi-session dialogue QA against GPT-4o-mini — and Oddjob's
 * workload is agent and mission execution. A number borrowed from someone
 * else's benchmark cannot tell you whether a change helped here. This produces
 * one that can.
 *
 * WHAT IT MEASURES
 *
 * A fixed corpus of memories is written to a scratch org, then a labelled set
 * of probe queries is run through BOTH retrieval paths. Reported per path:
 *
 *   recall@1 / @3 / @5 — was the expected memory in the top N
 *   MRR                — mean reciprocal rank of the expected memory
 *
 * WHY THE PROBE SET IS SPLIT THREE WAYS
 *
 * Measuring only paraphrases would rig the result: of course a lexical scan
 * loses when no words overlap. So probes are tagged `paraphrase` (no literal
 * overlap), `literal` (the search term appears verbatim, where the substring
 * scan should do fine), and `distractor` (several near-identical memories, only
 * one correct — a ranking test that a substring scan cannot express at all).
 * Per-category numbers are printed alongside the totals.
 *
 * USAGE
 *
 *   npm run evals:memory              # seed, measure, clean up
 *   npm run evals:memory -- --keep    # leave the fixture corpus in place
 *   npm run evals:memory -- --cleanup # purge leftovers from a crashed run
 *
 * Exits non-zero if the vector path scores below the substring path on MRR —
 * this doubles as a regression gate on the retrieval change.
 */

import { and, eq, like } from "drizzle-orm";
import { db } from "../../server/db/index.js";
import { agentLongTermMemories, orgs } from "../../shared/schema/index.js";
import { longTermMemoryService } from "../../server/domain/agents/core/long-term-memory.service.js";

/**
 * Scratch org for fixtures. Nothing real lives here, and measuring inside a
 * real org would be wrong twice over: its memories would occupy result slots
 * that the probes are trying to score, and the fixtures would pollute it.
 *
 * `orgs.id` is a serial, so the id is resolved by name rather than hardcoded.
 * The org itself is left in place between runs; only the memories are purged.
 */
const EVAL_ORG_NAME = "Eval Scratch - Memory Recall";
const KEY_PREFIX = "evalfixture:";
const LIMIT = 5;

let EVAL_ORG = 0;

async function ensureEvalOrg(): Promise<number> {
    const [existing] = await db.select().from(orgs).where(eq(orgs.name, EVAL_ORG_NAME)).limit(1);
    if (existing) return existing.id;

    const [created] = await db.insert(orgs).values({ name: EVAL_ORG_NAME } as any).returning();
    return created.id;
}

type ProbeKind = "paraphrase" | "literal" | "distractor";

interface Fixture {
    key: string;
    type: "preference" | "fact" | "entity" | "strategy";
    content: string;
}

interface Probe {
    kind: ProbeKind;
    query: string;
    /** Key of the memory that SHOULD come back first. */
    expect: string;
}

const CORPUS: Fixture[] = [
    { key: "ai_provider", type: "preference", content: "Default to Google Gemini for all AI features; OpenAI is only acceptable behind a Gemini-compatible shim." },
    { key: "db_port", type: "fact", content: "The development Postgres instance listens on port 5433, not the default 5432." },
    { key: "db_container", type: "entity", content: "oddjob-db is the Docker container running the development Postgres database." },
    { key: "qdrant_container", type: "entity", content: "oddjob-qdrant is the Docker container running the vector database." },
    { key: "seed_danger", type: "strategy", content: "Never run the seed command against the development database; it truncates fourteen tables." },
    { key: "stash_danger", type: "strategy", content: "Do not use git stash on this working tree; OneDrive permission errors leave the tree dirty and the pop refuses." },
    { key: "branch_target", type: "fact", content: "The integration branch for this repository is Development, not main or master." },
    { key: "test_db_port", type: "fact", content: "The integration test database runs on port 5433 under the name oddjob_test." },
    { key: "reply_style", type: "preference", content: "The user wants terse answers with file and line references rather than long prose explanations." },
    { key: "audit_first", type: "preference", content: "Always grep and read the existing code before proposing a new feature; do not assume a capability is missing." },
    { key: "tsc_memory", type: "strategy", content: "TypeScript checking on this repo needs an eight gigabyte old-space size or it runs out of memory." },
    { key: "decimal_strings", type: "fact", content: "Drizzle decimal columns come back as JavaScript strings, never as numbers." },
];

const PROBES: Probe[] = [
    // No meaningful literal overlap with the stored text.
    { kind: "paraphrase", query: "which model vendor should I reach for on a new feature", expect: "ai_provider" },
    { kind: "paraphrase", query: "how should I phrase my responses to this person", expect: "reply_style" },
    { kind: "paraphrase", query: "is it safe to shelve my current changes temporarily", expect: "stash_danger" },
    { kind: "paraphrase", query: "what happens if I wipe and repopulate local data", expect: "seed_danger" },
    { kind: "paraphrase", query: "where do pull requests get merged in this project", expect: "branch_target" },
    { kind: "paraphrase", query: "why does the compiler keep dying partway through", expect: "tsc_memory" },

    // The search term appears verbatim — the substring scan should manage these.
    { kind: "literal", query: "5433", expect: "db_port" },
    { kind: "literal", query: "oddjob-qdrant", expect: "qdrant_container" },
    { kind: "literal", query: "decimal", expect: "decimal_strings" },

    // Several close neighbours; only one is right. Ranking, not matching.
    { kind: "distractor", query: "what is the name of the container holding the relational database", expect: "db_container" },
    { kind: "distractor", query: "which port does the test database use", expect: "test_db_port" },
    { kind: "distractor", query: "should I check what already exists before building something new", expect: "audit_first" },
];

interface PathScore {
    hits1: number;
    hits3: number;
    hits5: number;
    reciprocalRanks: number[];
    byKind: Record<ProbeKind, { n: number; hits1: number; rr: number[] }>;
}

function emptyScore(): PathScore {
    return {
        hits1: 0, hits3: 0, hits5: 0, reciprocalRanks: [],
        byKind: {
            paraphrase: { n: 0, hits1: 0, rr: [] },
            literal: { n: 0, hits1: 0, rr: [] },
            distractor: { n: 0, hits1: 0, rr: [] },
        },
    };
}

function record(score: PathScore, probe: Probe, rankedKeys: (string | null)[]) {
    const idx = rankedKeys.findIndex((k) => k === KEY_PREFIX + probe.expect);
    const rank = idx === -1 ? Infinity : idx + 1;
    const rr = rank === Infinity ? 0 : 1 / rank;

    if (rank <= 1) score.hits1++;
    if (rank <= 3) score.hits3++;
    if (rank <= 5) score.hits5++;
    score.reciprocalRanks.push(rr);

    const k = score.byKind[probe.kind];
    k.n++;
    if (rank <= 1) k.hits1++;
    k.rr.push(rr);
}

const pct = (hit: number, n: number) => `${((hit / n) * 100).toFixed(1)}%`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

async function purge() {
    await db.delete(agentLongTermMemories).where(and(
        eq(agentLongTermMemories.organizationId, EVAL_ORG),
        like(agentLongTermMemories.key, `${KEY_PREFIX}%`),
    ));
}

async function seed(): Promise<Map<number, string>> {
    const idToKey = new Map<number, string>();
    for (const f of CORPUS) {
        const id = await longTermMemoryService.remember({
            organizationId: EVAL_ORG,
            type: f.type,
            key: KEY_PREFIX + f.key,
            content: f.content,
            importance: 5,
            source: "eval_fixture",
        });
        if (id === undefined) throw new Error(`Failed to seed fixture ${f.key}`);
        idToKey.set(id, KEY_PREFIX + f.key);
    }
    return idToKey;
}

function report(label: string, score: PathScore, n: number) {
    console.log(`\n  ${label}`);
    console.log(`    recall@1  ${pct(score.hits1, n).padStart(6)}   (${score.hits1}/${n})`);
    console.log(`    recall@3  ${pct(score.hits3, n).padStart(6)}   (${score.hits3}/${n})`);
    console.log(`    recall@5  ${pct(score.hits5, n).padStart(6)}   (${score.hits5}/${n})`);
    console.log(`    MRR       ${mean(score.reciprocalRanks).toFixed(3)}`);
    for (const kind of ["paraphrase", "literal", "distractor"] as ProbeKind[]) {
        const k = score.byKind[kind];
        if (k.n === 0) continue;
        console.log(`      ${kind.padEnd(11)} recall@1 ${pct(k.hits1, k.n).padStart(6)}  MRR ${mean(k.rr).toFixed(3)}`);
    }
}

async function main() {
    const argv = process.argv.slice(2);
    const keep = argv.includes("--keep");

    EVAL_ORG = await ensureEvalOrg();

    if (argv.includes("--cleanup")) {
        await purge();
        console.log(`Purged eval fixtures from org ${EVAL_ORG}.`);
        process.exit(0);
    }

    console.log("Long-term memory recall eval");
    console.log(`  corpus: ${CORPUS.length} memories, probes: ${PROBES.length}, k=${LIMIT}`);

    await purge();
    const idToKey = await seed();
    console.log(`  seeded ${idToKey.size} fixtures into scratch org ${EVAL_ORG}`);

    const vector = emptyScore();
    const substring = emptyScore();

    try {
        for (const probe of PROBES) {
            const v = await longTermMemoryService.recall({
                organizationId: EVAL_ORG, search: probe.query, limit: LIMIT,
            });
            record(vector, probe, v.map((r: any) => idToKey.get(r.id) ?? null));

            const s = await (longTermMemoryService as any)._recallBySql({
                organizationId: EVAL_ORG, search: probe.query, limit: LIMIT,
            });
            record(substring, probe, s.map((r: any) => idToKey.get(r.id) ?? null));
        }

        const n = PROBES.length;
        report("VECTOR (current)", vector, n);
        report("SUBSTRING (previous behaviour)", substring, n);

        const vMrr = mean(vector.reciprocalRanks);
        const sMrr = mean(substring.reciprocalRanks);
        const delta = sMrr === 0 ? Infinity : ((vMrr - sMrr) / sMrr) * 100;

        console.log(`\n  MRR ${sMrr.toFixed(3)} -> ${vMrr.toFixed(3)}` +
            (Number.isFinite(delta) ? `  (${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%)` : "  (substring scored zero)"));
        console.log(`  recall@1 ${pct(substring.hits1, n)} -> ${pct(vector.hits1, n)}\n`);

        if (vMrr < sMrr) {
            console.error("REGRESSION: vector recall scores below the substring scan.");
            process.exit(1);
        }
    } finally {
        if (keep) {
            console.log(`Fixtures left in place (org ${EVAL_ORG}). Purge with --cleanup.`);
        } else {
            for (const id of idToKey.keys()) await longTermMemoryService.unindex(id);
            await purge();
            console.log("Cleaned up fixtures.");
        }
    }

    process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
