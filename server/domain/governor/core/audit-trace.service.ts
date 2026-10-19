import { db } from "@server/database_service.js";
import { missionBlackboardHistory, missions } from "@shared/schema/index.js";
import { eq, asc, lte, and } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { NotFoundError } from "@server/utils/errors.js";

const logger = createLogger("AuditTrace");

export class AuditTraceService {
    /**
     * Reconstructs the mission blackboard at a specific historical point in time.
     */
    async getBlackboardAtTimestamp(missionId: number, targetTimestamp: Date): Promise<any> {
        logger.info(`Forensic reconstruction requested for mission ${missionId} at ${targetTimestamp.toISOString()}`);

        // 1. Fetch all history deltas up to the target timestamp
        const history = await db.select()
            .from(missionBlackboardHistory)
            .where(and(
                eq(missionBlackboardHistory.missionId, missionId),
                lte(missionBlackboardHistory.createdAt, targetTimestamp)
            ))
            .orderBy(asc(missionBlackboardHistory.createdAt));

        if (history.length === 0) {
            // Check if mission existed at all
            const [mission] = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
            if (!mission) throw new NotFoundError("Mission history not found");
            return {}; // Initial state
        }

        // 2. Replay deltas
        // Note: Our history currently stores patches (deltas). 
        // We start with an empty object and merge every patch in order.
        let state: any = {};
        for (const entry of history) {
            const patch = entry.blackboard as any;
            state = { ...state, ...patch };
        }

        return state;
    }

    /**
     * Returns a timeline of all high-impact blackboard changes.
     */
    async getChangeTimeline(missionId: number) {
        return await db.select()
            .from(missionBlackboardHistory)
            .where(eq(missionBlackboardHistory.missionId, missionId))
            .orderBy(asc(missionBlackboardHistory.createdAt));
    }
}

export const auditTraceService = new AuditTraceService();
