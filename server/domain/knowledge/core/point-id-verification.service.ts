import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { knowledgeDocuments } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("PointIdVerification");

/**
 * Auditing the back catalogue's claim to be indexed.
 *
 * Before fce1b1c7f, `qdrant_point_id` was stamped at INSERT — so 3,866 of 3,871
 * documents assert they are retrievable regardless of whether embedding ever
 * succeeded. New writes are honest; these are not.
 *
 * This costs NOTHING to run. It embeds nothing and calls no model: it counts
 * points already in Qdrant. Re-embedding whatever it finds missing is a separate
 * decision, taken with real numbers instead of a guess.
 *
 * The subtlety that makes it work: the stored value is the ASSET KEY, not a
 * point id. Chunk ids are UUIDs derived from `${assetKey}:${index}`, so a
 * document cannot be checked with a point lookup — it is counted by payload
 * filter on `assetKey`.
 */

export interface VerificationReport {
    checked: number;
    verified: number;
    /** Claimed indexed, but no points exist. The claim was false. */
    missing: number;
    /** Could not be checked — the collection or Qdrant was unreachable. */
    unchecked: number;
    /** Only set when `apply` was true. */
    cleared: number;
    byOrg: Array<{ organizationId: number | null; checked: number; missing: number }>;
    /** A sample of the false claims, for a human to sanity-check before applying. */
    examples: Array<{ id: number; title: string; organizationId: number | null }>;
}

function collectionFor(organizationId: number | null): string {
    // Mirrors getShardedCollection in rag-langchain.service.
    return organizationId
        ? `oddjob_org_${organizationId}`
        : (process.env.QDRANT_COLLECTION || "oddjob_rag_assets");
}

export const pointIdVerificationService = {
    /**
     * Checks every document that claims to be indexed.
     *
     * `apply: false` reports only — nothing is written. Run it that way first:
     * the count is the input to the re-embedding decision, and clearing ids
     * before anyone has seen the number just moves the surprise later.
     */
    async verify(options: { apply?: boolean; limit?: number; organizationId?: number } = {}): Promise<VerificationReport> {
        const { getClient, ensureQdrantCollection } = await import("@server/integrations/qdrant-client.js");

        const where = options.organizationId != null
            ? and(isNotNull(knowledgeDocuments.qdrantPointId), eq(knowledgeDocuments.organizationId, options.organizationId))
            : isNotNull(knowledgeDocuments.qdrantPointId);

        const rows = await db
            .select({
                id: knowledgeDocuments.id,
                title: knowledgeDocuments.title,
                organizationId: knowledgeDocuments.organizationId,
                qdrantPointId: knowledgeDocuments.qdrantPointId,
            })
            .from(knowledgeDocuments)
            .where(where)
            .limit(options.limit ?? 100000);

        const report: VerificationReport = {
            checked: 0, verified: 0, missing: 0, unchecked: 0, cleared: 0,
            byOrg: [], examples: [],
        };
        const perOrg = new Map<number | null, { checked: number; missing: number }>();
        const client = getClient();
        // One collection may be missing entirely while others are fine; remember
        // which so a dead shard is reported once rather than per document.
        const deadCollections = new Set<string>();
        const missingIds: number[] = [];

        for (const row of rows) {
            const collection = collectionFor(row.organizationId);
            const tally = perOrg.get(row.organizationId) ?? { checked: 0, missing: 0 };

            if (deadCollections.has(collection)) {
                report.unchecked++;
                continue;
            }

            let count: number | null = null;
            try {
                await ensureQdrantCollection(collection);
                const result = await client.count(collection, {
                    filter: { must: [{ key: "assetKey", match: { value: row.qdrantPointId! } }] },
                    exact: true,
                });
                count = result?.count ?? 0;
            } catch (error: any) {
                // Unreachable is NOT the same as missing. Clearing an id because
                // Qdrant was down would destroy a true claim.
                logger.warn(`Could not check ${collection}: ${error?.message}`);
                deadCollections.add(collection);
                report.unchecked++;
                continue;
            }

            report.checked++;
            tally.checked++;
            if (count > 0) {
                report.verified++;
            } else {
                report.missing++;
                tally.missing++;
                missingIds.push(row.id);
                if (report.examples.length < 10) {
                    report.examples.push({ id: row.id, title: row.title, organizationId: row.organizationId });
                }
            }
            perOrg.set(row.organizationId, tally);
        }

        if (options.apply && missingIds.length > 0) {
            // Clearing makes `qdrant_point_id IS NULL` mean what it says, and
            // turns the false claims into a backfill worklist.
            const CHUNK = 500;
            for (let i = 0; i < missingIds.length; i += CHUNK) {
                const batch = missingIds.slice(i, i + CHUNK);
                await db
                    .update(knowledgeDocuments)
                    .set({ qdrantPointId: null })
                    // inArray, not a raw ANY(): drizzle expands an array inside
                    // sql`` into one placeholder PER ELEMENT, which produces
                    // `= ANY(($2, $3, …))` and fails at the database.
                    .where(inArray(knowledgeDocuments.id, batch));
                report.cleared += batch.length;
            }
            logger.info(`Cleared ${report.cleared} false indexed claims`);
        }

        report.byOrg = [...perOrg.entries()]
            .map(([organizationId, t]) => ({ organizationId, ...t }))
            .sort((a, b) => b.missing - a.missing);

        return report;
    },
};
