/**
 * Activate PLATFORM-WIDE semantic leverage: register every registered agent tool
 * as a capability manifest into the ACDD vector router under the PLATFORM org, so
 * discover() surfaces them for EVERY organization (discover always searches the
 * caller's org + the platform org). Then PROVE it from multiple orgs.
 *
 * Run: npx tsx scripts/acdd-activate-leverage.ts
 */
import "dotenv/config";

// Pin the embedding contract before importing the registry (module reads it at load).
process.env.ACDD_EMBEDDING_PROVIDER = process.env.ACDD_EMBEDDING_PROVIDER || "google";
process.env.ACDD_EMBEDDING_MODEL = process.env.ACDD_EMBEDDING_MODEL || "gemini-embedding-001";

async function main() {
    const { getAgentTools } = await import("@domain/tools/v1/capabilities/index.js");
    const { toolDefinitionToManifest } = await import("@domain/capabilities/infrastructure/capability-triggers.js");
    const { capabilityRegistry, resolveCapabilityCollection, PLATFORM_ORG_ID } = await import(
        "@domain/capabilities/core/capability-registry.service.js"
    );
    const { db } = await import("@server/database_service.js");
    const { orgs } = await import("@shared/schema/index.js");

    const collection = resolveCapabilityCollection();
    const tools = getAgentTools();
    const manifests = Object.entries(tools)
        .map(([name, tool]) => toolDefinitionToManifest(name, tool as any))
        .filter((m): m is NonNullable<typeof m> => m !== null);

    console.log(`\nActivating PLATFORM-WIDE semantic leverage`);
    console.log(`  platformOrg=${PLATFORM_ORG_ID}  collection=${collection}  capabilities=${manifests.length}\n`);

    // Clean up any prior per-org registrations (earlier runs indexed under a real
    // org before platform-global indexing existed) to avoid orphaned duplicates.
    const [firstOrg] = await db.select({ id: orgs.id }).from(orgs).limit(1);
    const priorOrgId = firstOrg?.id;
    if (priorOrgId != null && priorOrgId !== PLATFORM_ORG_ID) {
        await Promise.all(manifests.map((m) => capabilityRegistry.remove(priorOrgId, m.capability_id).catch(() => {})));
        console.log(`Cleaned prior org-${priorOrgId} registrations (${manifests.length} points).`);
    }

    // Register under the platform org.
    let ok = 0;
    let fail = 0;
    const CONCURRENCY = 5;
    const started = Date.now();
    for (let i = 0; i < manifests.length; i += CONCURRENCY) {
        await Promise.all(
            manifests.slice(i, i + CONCURRENCY).map(async (m) => {
                try {
                    await capabilityRegistry.register(PLATFORM_ORG_ID, m);
                    ok++;
                } catch (e: any) {
                    fail++;
                    if (fail <= 8) console.error(`  ✗ ${m.capability_id}: ${e.message}`);
                }
            }),
        );
        if (i % 50 === 0) process.stdout.write(`  indexed ${ok + fail}/${manifests.length}...\n`);
    }
    console.log(`\nIndexed ${ok}/${manifests.length} platform capabilities (${fail} failed) in ${((Date.now() - started) / 1000).toFixed(0)}s\n`);

    // ---- PROVE: two DIFFERENT orgs (one real, one arbitrary/never-seen) both
    // resolve the platform capabilities via the platform-org fallback. ----
    const proofOrgs = [priorOrgId ?? 1, 987654];
    const queries = [
        "extract structured line items from an invoice PDF",
        "run a SQL analytics query against our data warehouse",
        "open a pull request and commit code changes on GitHub",
    ];

    for (const proofOrg of proofOrgs) {
        console.log(`=== PROOF: discover() as org ${proofOrg} (no own capabilities) ===`);
        for (const q of queries) {
            const hits = await capabilityRegistry.discover(proofOrg, q, 3);
            console.log(`\nQ (org ${proofOrg}): "${q}"`);
            if (!hits.length) console.log("   (no matches)");
            for (const h of hits) {
                console.log(`   ${h.score.toFixed(3)}  ${h.capabilityId}  [${h.manifest.metadata.category}]`);
            }
        }
        console.log("");
    }

    process.exit(fail > manifests.length / 2 ? 1 : 0);
}

main().catch((e) => {
    console.error("Activation crashed:", e);
    process.exit(1);
});
