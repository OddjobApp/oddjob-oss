
import { db, pool } from "../../../database_service.js";
import { missionRuns } from "@shared/schema/index.js";
import { eq, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("TraceBuffer");

/**
 * The TraceBuffer accumulates mission logs in memory and flushes them 
 * periodically to reduce DB write pressure. 
 */
class TraceBuffer {
    private buffers: Map<number, any[]> = new Map();
    private flushInterval: NodeJS.Timeout | null = null;
    private readonly BATCH_INTERVAL_MS = 2000;

    constructor() {
        this.startFlushing();
    }

    /**
     * Queues a trace entry for a specific mission run.
     */
    append(missionRunId: number, traceEntry: any) {
        if (!this.buffers.has(missionRunId)) {
            this.buffers.set(missionRunId, []);
        }
        this.buffers.get(missionRunId)!.push({
            ...traceEntry,
            timestamp: traceEntry.timestamp || new Date().toISOString()
        });
    }

    /**
     * Periodic background flush to PG.
     */
    private startFlushing() {
        this.flushInterval = setInterval(async () => {
            if (this.buffers.size === 0) return;

            const pendingRuns = Array.from(this.buffers.keys());
            logger.debug(`[Mach 1] Flushing traces for ${pendingRuns.length} runs...`);

            for (const runId of pendingRuns) {
                const newTraces = this.buffers.get(runId) || [];
                logger.info(`[Mach 1] Attempting to flush ${newTraces.length} traces for run ${runId}`);
                if (newTraces.length === 0) {
                    this.buffers.delete(runId);
                    continue;
                }

                try {
                    // Sanitize traces to remove invalid characters (e.g. null bytes) that Postgres JSONB rejects
                    const sanitizedTraces = JSON.parse(JSON.stringify(newTraces).replace(/\\u0000/g, ''));

                    // Use explicit SQL via pool to bypass any Drizzle builder/version issues
                    await pool.query(`
                        UPDATE mission_runs 
                        SET dynamic_trace = COALESCE(dynamic_trace, '[]'::jsonb) || $1::jsonb,
                            updated_at = NOW()
                        WHERE id = $2
                    `, [JSON.stringify(sanitizedTraces), runId]);
                    
                    logger.info(`[Mach 1] Successfully flushed traces for run ${runId}`);
                    // Only delete from memory if DB update succeeded
                    this.buffers.delete(runId);
                } catch (err: any) {
                    logger.error(`[Mach 1] Trace flush failed for run ${runId}: ${err.message}`);
                }
            }
        }, this.BATCH_INTERVAL_MS);
    }

    /**
     * Force immediate flush (useful for mission completion).
     */
    async forceFlush(missionRunId: number) {
        const traces = this.buffers.get(missionRunId);
        if (!traces || traces.length === 0) return;
        
        try {
            const sanitizedTraces = JSON.parse(JSON.stringify(traces).replace(/\\u0000/g, ''));
            await pool.query(`
                UPDATE mission_runs 
                SET dynamic_trace = COALESCE(dynamic_trace, '[]'::jsonb) || $1::jsonb,
                    updated_at = NOW()
                WHERE id = $2
            `, [JSON.stringify(sanitizedTraces), missionRunId]);
            
            this.buffers.delete(missionRunId);
        } catch (err: any) {
            logger.error(`[Mach 1] Force flush failed for run ${missionRunId}: ${err.message}`);
            throw err;
        }
    }
}

export const traceBuffer = new TraceBuffer();
