import { db } from "@server/database_service.js";
import {
    orgLearningProfiles, orgPreferenceEvents, orgSettings, missions, missionRuns,
} from "@shared/schema/index.js";
import { eq, sql, avg, isNull, and } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { systemAiService } from "../../ai/core/system-ai.service.js";

const logger = createLogger("OrgMaturityService");

/**
 * Organizational maturity scoring and "Soul Trait" synthesis. Split out of
 * OrgForgeService — these read the org's learning/preference history and are
 * independent of the blueprint install pipeline.
 */
export class OrgMaturityService {

    /**
     * Generates a maturity report for the organization.
     */
    async getMaturityReport(orgId: number) {
        logger.info(`[OrgForge] Generating maturity report for org: ${orgId}`);

        const [[profile], [settings]] = await Promise.all([
            db.select().from(orgLearningProfiles).where(eq(orgLearningProfiles.organizationId, orgId)),
            db.select().from(orgSettings).where(eq(orgSettings.organizationId, orgId)),
        ]);

        const [missionStats, totalMissionsCount] = await Promise.all([
            db.select({
                avgCost: avg(missionRuns.costUsd),
                totalRuns: sql<number>`count(*)`,
                successRate: sql<number>`sum(case when ${missionRuns.isSuccess} = true or ${missionRuns.status} = 'completed' then 1 else 0 end) * 100.0 / nullif(count(case when ${missionRuns.status} != 'cancelled' then 1 end), 0)`
            })
            .from(missionRuns)
            .innerJoin(missions, eq(missionRuns.missionId, missions.id))
            .where(eq(missions.organizationId, orgId)),

            db.select({ count: sql<number>`count(*)` })
            .from(missions)
            .where(eq(missions.organizationId, orgId))
        ]);

        const autonomyScore = Math.min(100, (Number(totalMissionsCount[0]?.count || 0)) * 2);
        const reliabilityScore = Math.min(100, Math.round(Number(missionStats[0]?.successRate || 0)));
        const knowledgeScore = profile?.learningEnabled 
            ? ((settings?.knowledgeStoreEnabled && settings?.knowledgeGraphEnabled) ? 100 : 75) 
            : 20;
        const soulScore = profile?.autoApplyLearnings 
            ? (settings?.assistantSoulArchetype ? 100 : 85) 
            : 45;
        const maturityIndex = Math.round((autonomyScore + reliabilityScore + knowledgeScore + soulScore) / 4);

        return {
            orgId,
            maturityIndex,
            dimensions: { autonomy: autonomyScore, reliability: reliabilityScore, knowledge: knowledgeScore, soul: soulScore },
            profile: profile || null,
            settings: settings || null,
            stats: {
                totalMissions: Number(totalMissionsCount[0]?.count || 0),
                avgCostUsd: Number(missionStats[0]?.avgCost || 0).toFixed(2),
                successRate: Number(missionStats[0]?.successRate || 0).toFixed(1)
            },
            recommendations: this.generateRecommendations(maturityIndex, autonomyScore)
        };
    }

    /**
     * Uses AI to synthesize and refine the Organization's "Soul Traits".
     */
    async synthesizeSoulTraits(orgId: number) {
        logger.info(`[OrgForge] Synthesizing Soul Traits for org: ${orgId}`);

        const events = await db.select()
            .from(orgPreferenceEvents)
            .where(eq(orgPreferenceEvents.organizationId, orgId))
            .limit(50);

        const prompt = `Analyze the following organization preference events and synthesize a cohesive "Soul Profile".
        Events: ${JSON.stringify(events)}
        Return a JSON object with:
        - archetype: string (e.g., "The Precision Engineer", "The Creative Maverick")
        - traits: Record<string, number> (0-100 score for traits like "compliance", "creativity", "speed")
        - rationale: string`;

        const synthesis = await systemAiService.generateJson(prompt, 'architect');

        await db.insert(orgSettings)
            .values({
                organizationId: orgId,
                assistantSoulTraits: synthesis.traits,
                assistantSoulArchetype: synthesis.archetype,
            })
            .onConflictDoUpdate({
                target: orgSettings.organizationId,
                set: {
                    assistantSoulTraits: synthesis.traits,
                    assistantSoulArchetype: synthesis.archetype,
                    updatedAt: sql`now()`,
                }
            });

        return synthesis;
    }

    private generateRecommendations(index: number, autonomy: number) {
        const recs = [];
        if (index < 50) recs.push("Enable 'Auto-Learning' to accelerate organizational maturity.");
        if (autonomy < 30) recs.push("Spawn more varied missions to increase agentic experience.");
        recs.push("Synthesize Soul Traits to ensure cross-agent consistency.");
        return recs;
    }
}

export const orgMaturityService = new OrgMaturityService();
