/**
 * Stamps securityClassification onto Qdrant points that lack it.
 *
 * search-service filters every vector hit with
 *   must: [{ key: "securityClassification", range: { lte: clearance } }]
 * and a Qdrant range filter excludes any point LACKING the key. No indexer ever wrote
 * the field, so the vector arm of unified search matched nothing, anywhere: 0 of 7826
 * points in org 342, 0 of 5064 in org 291, while the same query with no filter
 * returned 5 documents. Agents concluded the knowledge base was empty and fell back to
 * the public web.
 *
 * This is a payload-only backfill. Vectors are untouched, so nothing is re-embedded
 * and it costs no model quota.
 *
 * Usage:
 *   npx tsx scripts/backfill-security-classification.ts            # report only
 *   npx tsx scripts/backfill-security-classification.ts --apply    # write
 */
import "dotenv/config";
import { getClient } from "../server/integrations/qdrant-client.js";
import { DEFAULT_SECURITY_CLASSIFICATION } from "../server/domain/knowledge/core/rag-langchain.service.js";

const APPLY = process.argv.includes("--apply");
const KEY = "securityClassification";
/** Points missing the field. Also what search-service's is_empty tolerance matches. */
const MISSING = { must: [{ is_empty: { key: KEY } }] } as const;

async function main() {
    const client = getClient();
    const { collections } = await client.getCollections();

    // Only knowledge corpora. Agent memory, the semantic cache and the mission history
    // are not searched through this filter, and stamping them would imply a
    // classification nobody chose.
    const targets = collections
        .map((c: { name: string }) => c.name)
        .filter((n: string) => n.startsWith("oddjob_org_") || n === "oddjob_rag_assets" || n.startsWith("acdd_capabilities"))
        .sort();

    let totalMissing = 0;
    let totalStamped = 0;
    const failures: string[] = [];

    for (const name of targets) {
        let missing = 0;
        try {
            missing = (await client.count(name, { filter: MISSING as any, exact: true })).count;
        } catch (err: any) {
            failures.push(`${name}: count failed — ${err?.message ?? err}`);
            continue;
        }
        if (missing === 0) continue;
        totalMissing += missing;

        if (!APPLY) {
            console.log(`  ${name}: ${missing} point(s) missing ${KEY}`);
            continue;
        }

        try {
            // Filtered set_payload — one server-side call per collection, no scrolling
            // and no re-embedding.
            await client.setPayload(name, {
                payload: { [KEY]: DEFAULT_SECURITY_CLASSIFICATION },
                filter: MISSING as any,
                wait: true,
            });
            const left = (await client.count(name, { filter: MISSING as any, exact: true })).count;
            totalStamped += missing - left;
            console.log(`  ${name}: stamped ${missing - left}/${missing}${left ? ` — ${left} STILL MISSING` : ""}`);
            if (left) failures.push(`${name}: ${left} point(s) still missing after write`);
        } catch (err: any) {
            failures.push(`${name}: setPayload failed — ${err?.message ?? err}`);
        }
    }

    console.log(
        APPLY
            ? `\nStamped ${totalStamped} of ${totalMissing} point(s) with ${KEY}=${DEFAULT_SECURITY_CLASSIFICATION} across ${targets.length} collection(s).`
            : `\n${totalMissing} point(s) across ${targets.length} collection(s) are missing ${KEY}. Re-run with --apply to write.`,
    );

    if (failures.length) {
        console.error(`\n${failures.length} problem(s):`);
        for (const f of failures) console.error(`  - ${f}`);
        process.exit(1);
    }
    // Only safe to set RAG_ALLOW_UNCLASSIFIED_CHUNKS=false once this reports zero.
    if (APPLY && totalMissing > 0 && totalStamped === totalMissing) {
        console.log("All points carry a classification; the is_empty tolerance in search-service can now be disabled.");
    }
    process.exit(0);
}

main().catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
});
