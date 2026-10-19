import { randomUUID } from "crypto";
import { and, eq, isNull, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { knowledgeDocuments } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("IndexBackfill");

/**
 * Embedding the documents that were never actually indexed.
 *
 * The verification pass found 3863 of 3866 "indexed" documents had no vectors
 * at all, and cleared their ids — so `qdrant_point_id IS NULL` is now an
 * accurate worklist. This works through it.
 *
 * Built around one hard lesson: the original outage was a SPENDING CAP, and the
 * embedding provider responded by resolving empty vectors rather than throwing.
 * A backfill is exactly the burst that trips such a cap, so this stops on a run
 * of consecutive failures instead of grinding through thousands of them and
 * reporting a tidy summary of nothing.
 */

export interface BackfillReport {
    considered: number;
    indexed: number;
    chunks: number;
    /** Nothing to embed — an empty document, not a failure. */
    skipped: number;
    failed: number;
    /** Set when the circuit breaker stopped the run early. */
    abortedAfter?: string;
    failures: Array<{ id: number; title: string; error: string }>;
}

export interface BackfillOptions {
    organizationId?: number;
    limit?: number;
    /** Stop after this many consecutive failures. Zero disables the breaker. */
    consecutiveFailureLimit?: number;
    /** Report what would run, without embedding anything. */
    dryRun?: boolean;
    /** Bypass the embedding-dimension check. Only for tests. */
    skipPreflight?: boolean;
    onProgress?: (done: number, total: number) => void;
}

export const indexBackfillService = {
    /**
     * Documents that need indexing: no point id, and some text to embed.
     *
     * A document with no text would be a guaranteed skip, so it is excluded
     * here rather than counted as work.
     */
    async pending(organizationId?: number, limit = 100000) {
        const conditions = [
            isNull(knowledgeDocuments.qdrantPointId),
            isNotNull(knowledgeDocuments.textContent),
            ne(knowledgeDocuments.textContent, ""),
        ];
        if (organizationId != null) {
            conditions.push(eq(knowledgeDocuments.organizationId, organizationId));
        }
        return db
            .select()
            .from(knowledgeDocuments)
            .where(and(...conditions))
            .orderBy(knowledgeDocuments.id)
            .limit(limit);
    },

    /**
     * Refuses to start unless real embeddings are coming back.
     *
     * On quota exhaustion the embedding layer falls back to Ollama, and then to
     * a lexical vector. Those are a reasonable degradation for a single live
     * query — they are a catastrophe for a backfill, which would write tens of
     * thousands of vectors from a DIFFERENT model into a collection queried with
     * Gemini vectors. Similarity across two embedding spaces is noise, and the
     * index would look full while returning nothing useful.
     *
     * Checking the dimension catches exactly that: Gemini returns 3072, the
     * Ollama fallback 768.
     */
    async preflight(): Promise<{ ok: boolean; dims: number; expected: number; reason?: string }> {
        const expected = Number(process.env.QDRANT_VECTOR_SIZE || 3072);
        try {
            const { getEmbeddings } = await import("./rag-langchain.service.js");
            const vector = await getEmbeddings().embedQuery("preflight");
            const dims = Array.isArray(vector) ? vector.length : 0;
            if (dims !== expected) {
                return {
                    ok: false, dims, expected,
                    reason: `Embeddings returned ${dims} dimensions, expected ${expected}. ` +
                        `This is the fallback model, not Gemini — refusing to backfill an index with vectors ` +
                        `from a different embedding space.`,
                };
            }
            return { ok: true, dims, expected };
        } catch (error: any) {
            return { ok: false, dims: 0, expected, reason: String(error?.message ?? error).slice(0, 300) };
        }
    },

    async run(options: BackfillOptions = {}): Promise<BackfillReport> {
        if (!options.dryRun && options.skipPreflight !== true) {
            const check = await this.preflight();
            if (!check.ok) {
                throw new Error(`Backfill preflight failed: ${check.reason}`);
            }
            logger.info(`Preflight OK — ${check.dims}-dimension embeddings`);
        }

        const docs = await this.pending(options.organizationId, options.limit ?? 100000);
        const report: BackfillReport = {
            considered: docs.length, indexed: 0, chunks: 0, skipped: 0, failed: 0, failures: [],
        };

        if (options.dryRun) {
            logger.info(`Dry run: ${docs.length} document(s) would be embedded`);
            return report;
        }

        const { reindexKnowledgeDocument } = await import("./knowledge-store.js");
        const breakerLimit = options.consecutiveFailureLimit ?? 5;
        let consecutiveFailures = 0;
        let done = 0;

        // Sequential on purpose. Embedding providers rate-limit, and a parallel
        // burst against a capped account is how the original outage looked from
        // the inside — many calls, all resolving with nothing in them.
        for (const doc of docs) {
            const pointId = doc.qdrantPointId ?? randomUUID();
            try {
                const result = await reindexKnowledgeDocument({ ...doc, qdrantPointId: pointId });

                if (result.indexed) {
                    await db
                        .update(knowledgeDocuments)
                        .set({ qdrantPointId: pointId })
                        .where(eq(knowledgeDocuments.id, doc.id));
                    report.indexed++;
                    report.chunks += result.chunks;
                } else {
                    // Nothing embeddable. Left NULL — it is not indexed, and
                    // saying otherwise is the bug this whole effort fixed.
                    report.skipped++;
                }
                consecutiveFailures = 0;
            } catch (error: any) {
                report.failed++;
                consecutiveFailures++;
                if (report.failures.length < 20) {
                    report.failures.push({
                        id: doc.id,
                        title: doc.title,
                        error: String(error?.message ?? error).slice(0, 200),
                    });
                }

                if (breakerLimit > 0 && consecutiveFailures >= breakerLimit) {
                    // A quota or a dead vector store fails EVERY document. Better
                    // to stop and say so than to spend an hour producing 3868
                    // identical errors.
                    report.abortedAfter =
                        `${consecutiveFailures} consecutive failures — stopped rather than continuing. ` +
                        `Last error: ${report.failures.at(-1)?.error ?? "unknown"}`;
                    logger.error(report.abortedAfter);
                    break;
                }
            }

            done++;
            if (done % 25 === 0) {
                logger.info(`Backfill ${done}/${docs.length} — ${report.indexed} indexed, ${report.failed} failed`);
                options.onProgress?.(done, docs.length);
            }
        }

        logger.info(
            `Backfill finished: ${report.indexed} indexed (${report.chunks} chunks), ` +
            `${report.skipped} skipped, ${report.failed} failed of ${report.considered}`,
        );
        return report;
    },

    /** What is left, so a run can be resumed or confirmed complete. */
    async remaining(organizationId?: number): Promise<number> {
        const conditions = [
            isNull(knowledgeDocuments.qdrantPointId),
            isNotNull(knowledgeDocuments.textContent),
            ne(knowledgeDocuments.textContent, ""),
        ];
        if (organizationId != null) {
            conditions.push(eq(knowledgeDocuments.organizationId, organizationId));
        }
        const [row] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(knowledgeDocuments)
            .where(and(...conditions));
        return row?.count ?? 0;
    },
};
