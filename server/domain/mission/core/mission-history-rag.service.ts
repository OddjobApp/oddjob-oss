
import { db } from "@server/database_service.js";
import { missionRuns } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { getEmbeddings } from "../../knowledge/core/rag-langchain.service.js";
import { upsertQdrantPoints, ensureQdrantCollection, searchQdrant } from "../../../integrations/qdrant-client.js";
import { createLogger } from "@server/utils/logger.js";
import { createHash } from "crypto";


const log = createLogger("MissionRAG");
const COLLECTION = "oddjob_mission_history";

/**
 * Similarity bonus given to traces from the run doing the asking.
 *
 * Deliberately small: it breaks ties toward the current run without letting a
 * weak local match outrank a genuinely relevant lesson from an earlier one —
 * which is the entire reason for searching beyond a single run.
 */
const SAME_RUN_BONUS = 0.05;

export class MissionHistoryRAGService {
    private static logger = log;
    /**
     * Indexes new significant traces for a mission run from its JSONB dynamic_trace column.
     */
    static async indexNewTraces(missionRunId: number): Promise<void> {
        try {
            await ensureQdrantCollection(COLLECTION);

            const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
            if (!run) return;

            const traces = (run.dynamicTrace as any[]) || [];
            const lastIndexedIndex: number = (run.missionContext as any)?.lastIndexedTraceIndex || -1;

            // 1. Fetch only NEW traces added since last index
            const newTraces = traces.slice(lastIndexedIndex + 1);
            if (newTraces.length === 0) return;

            const significantTypes = ['reflection', 'vibe_audit', 'critic', 'strategist', 'system_summary'];
            const filtered = newTraces.filter(t => significantTypes.includes(t.type as string) || (t.note && t.note.length > 300));
            
            if (filtered.length === 0) {
                // Still update the index so we don't re-scan these non-significant traces next time
                await this.updateLastIndex(missionRunId, run.missionContext, traces.length - 1);
                return;
            }

            // Pre-compute index map so the .map() below stays O(n)
            const traceToNewIndex = new Map(newTraces.map((t, i) => [t, i]));

            const embeddings = getEmbeddings();
            const points = await Promise.all(filtered.map(async (t) => {
                const text = `[Wave History] ${t.event || t.type}: ${t.note}`;
                const vector = await embeddings.embedQuery(text);
                const actualIndex = lastIndexedIndex + 1 + (traceToNewIndex.get(t) ?? 0);
                const hash = createHash("md5").update(`${missionRunId}-${actualIndex}`).digest("hex");
                
                return {
                    id: `trace-${hash}`,
                    vector,
                    payload: {
                        missionRunId,
                        // Stamped so retrieval can widen beyond a single run
                        // without ever crossing a tenant boundary. Points
                        // indexed before this existed carry neither field and
                        // are matched by run id alone.
                        organizationId: run.organizationId,
                        missionId: run.missionId,
                        traceIndex: actualIndex,
                        type: t.type,
                        event: t.event,
                        note: t.note,
                        timestamp: t.timestamp
                    }
                };
            }));

            await upsertQdrantPoints(points, COLLECTION);
            await this.updateLastIndex(missionRunId, run.missionContext, traces.length - 1);

            this.logger.debug(`[MissionRAG] Indexed ${points.length} significant traces for Run ${missionRunId}`);
        } catch (err: any) {
            this.logger.error(`[MissionRAG] Indexing failed: ${err.message}`);
        }
    }

    private static async updateLastIndex(missionRunId: number, context: any, index: number) {
        await db.update(missionRuns)
            .set({ missionContext: { ...(context || {}), lastIndexedTraceIndex: index } })
            .where(eq(missionRuns.id, missionRunId));
    }

    /**
     * Retrieves the most relevant past events for the current strategic objective.
     */
    static async retrieveRelevantHistory(missionRunId: number, query: string, limit: number = 5): Promise<string[]> {
        try {
            const embeddings = getEmbeddings();
            const vector = await embeddings.embedQuery(query);

            // Which tenant this run belongs to. Retrieval is scoped to it, so a
            // mission can learn from the org's earlier runs and only those.
            const [run] = await db
                .select({ organizationId: missionRuns.organizationId })
                .from(missionRuns)
                .where(eq(missionRuns.id, missionRunId))
                .limit(1);

            // `should` is OR: this org's traces, or this exact run's. The second
            // clause is what keeps traces indexed before organizationId was
            // stamped retrievable — and it cannot widen the blast radius,
            // because mission_runs.id is unique across the whole platform.
            const should: any[] = [{ key: "missionRunId", match: { value: missionRunId } }];
            if (run?.organizationId != null) {
                should.push({ key: "organizationId", match: { value: run.organizationId } });
            }

            // Over-fetch, then re-rank: an equally similar trace from THIS run
            // is more useful than one from a run months ago, but a much better
            // match from an earlier run should still win.
            const results = await searchQdrant(vector, {
                limit: Math.max(limit * 4, limit),
                collection: COLLECTION,
                filter: { should },
            });

            const ranked = results
                .map(r => {
                    const p = r.payload as any;
                    const sameRun = Number(p.missionRunId) === missionRunId;
                    return { p, sameRun, score: (r.score ?? 0) + (sameRun ? SAME_RUN_BONUS : 0) };
                })
                .sort((a, b) => b.score - a.score)
                .slice(0, limit);

            return ranked.map(({ p, sameRun }) => {
                // Labelled by provenance: without this the planner cannot tell
                // its own run's history from a different mission's, and would
                // reason about earlier runs as though they were the current one.
                const origin = sameRun ? "this run" : `run #${p.missionRunId}`;
                return `[Past Event · ${origin} (${p.timestamp})] ${p.event || p.type}: ${p.note}`;
            });
        } catch (err: any) {
            this.logger.error(`[MissionRAG] Retrieval failed: ${err.message}`);
            return [];
        }
    }
}
