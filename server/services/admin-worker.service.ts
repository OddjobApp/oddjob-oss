import { desc, eq, isNull } from "drizzle-orm";
import { db } from "../database_service.js";
import { deadLetterJobs, workerHeartbeats } from "@shared/schema/infrastructure/worker-spine.js";

const DEFAULT_DLQ_LIMIT = 50;
const MAX_DLQ_LIMIT = 200;
const HEARTBEAT_LIMIT = 100;
const STALE_AFTER_MS = 90_000;

export function normalizeDlqLimit(value: unknown): number {
    const parsed = typeof value === "string" ? Number(value) : Number.NaN;
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return DEFAULT_DLQ_LIMIT;
    return Math.min(parsed, MAX_DLQ_LIMIT);
}

export const adminWorkerService = {
    async listHeartbeats(now = new Date()) {
        const staleThreshold = new Date(now.getTime() - STALE_AFTER_MS);
        const rows = await db.select().from(workerHeartbeats)
            .orderBy(desc(workerHeartbeats.lastSeen)).limit(HEARTBEAT_LIMIT);
        return rows.map((row) => ({ ...row, isStale: row.lastSeen < staleThreshold }));
    },

    async listUnresolvedDeadLetters(limit: number) {
        return db.select().from(deadLetterJobs).where(isNull(deadLetterJobs.resolvedAt))
            .orderBy(desc(deadLetterJobs.failedAt)).limit(limit);
    },

    async resolveDeadLetter(id: number, resolvedBy: string) {
        await db.update(deadLetterJobs).set({ resolvedAt: new Date(), resolvedBy })
            .where(eq(deadLetterJobs.id, id));
    },
};
