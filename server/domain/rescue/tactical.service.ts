
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { rescueSessions } from "@shared/schema/rescue.js";
import { missions } from "@shared/schema/missions/core.js";
import { eq, and, inArray, desc, sql } from "drizzle-orm";

const logger = createLogger("RescueTacticalService");

export interface TacticalOverview {
    squads: any[];
    rescues: any[];
    highPriorityCount: number;
    systemHealth: number;
}

export const rescueTacticalService = {
    /**
     * Aggregates a tactical overview of all rescue assets and missions.
     */
    async getTacticalOverview(orgId: number): Promise<TacticalOverview> {
        logger.info(`Fetching tactical overview for organization ${orgId}`);

        // Fetch active rescue sessions for this org
        const activeSessions = await db
            .select({
                id: rescueSessions.id,
                missionId: rescueSessions.missionId,
                status: rescueSessions.status,
                serviceType: rescueSessions.serviceType,
                createdAt: rescueSessions.createdAt,
                providerId: rescueSessions.providerId,
            })
            .from(rescueSessions)
            .where(
                and(
                    eq(rescueSessions.organizationId, orgId),
                    inArray(rescueSessions.status, ["REQUESTED", "ACCEPTED", "ENROUTE", "ARRIVED"])
                )
            )
            .orderBy(desc(rescueSessions.createdAt))
            .limit(50);

        // Fetch mission names for each session's associated mission
        const missionIds = [...new Set(activeSessions.map(s => s.missionId).filter(Boolean))] as number[];
        const missionNames = missionIds.length > 0
            ? await db
                .select({ id: missions.id, name: missions.name })
                .from(missions)
                .where(inArray(missions.id, missionIds))
            : [];
        const nameById = new Map(missionNames.map(m => [m.id, m.name]));

        // Build squads (group by providerId)
        const providerMap = new Map<string, typeof activeSessions>();
        for (const session of activeSessions) {
            const key = session.providerId || "__unassigned__";
            if (!providerMap.has(key)) providerMap.set(key, []);
            providerMap.get(key)!.push(session);
        }

        const squads = [...providerMap.entries()].map(([providerId, sessions]) => ({
            id: providerId === "__unassigned__" ? "UNASSIGNED" : `PROVIDER-${String(providerId).slice(0, 6).toUpperCase()}`,
            status: sessions.some(s => s.status === "ENROUTE" || s.status === "ARRIVED") ? "Active" : "Standby",
            health: 1.0,
            mission: sessions[0]?.missionId ? nameById.get(sessions[0].missionId) ?? "Unknown Mission" : "None",
            agents: sessions.length,
        }));

        const rescues = activeSessions.map(session => ({
            id: `RSC-${String(session.id).padStart(3, "0")}`,
            target: session.missionId ? nameById.get(session.missionId) ?? `Mission #${session.missionId}` : `Session #${session.id}`,
            priority: session.status === "REQUESTED" ? "Critical" : "Medium",
            timeElapsed: session.createdAt
                ? `${Math.max(0, Math.floor((Date.now() - new Date(session.createdAt).getTime()) / 60000))}m`
                : "--",
            status: session.status,
        }));

        const highPriorityCount = rescues.filter(r => r.priority === "Critical").length;
        const systemHealth = squads.length > 0
            ? squads.reduce((a, b) => a + b.health, 0) / squads.length
            : 1.0;

        return { squads, rescues, highPriorityCount, systemHealth };
    }
};
