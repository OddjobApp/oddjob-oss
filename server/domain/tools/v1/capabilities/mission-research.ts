
import { z } from "zod";

import { db } from "../../../../database_service.js";
import { missions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "../../../../utils/logger.js";

const logger = createLogger("MissionResearchTool");

export const missionResearchTool = {
    name: "research_past_missions",

    idempotency: "read-safe",
    description: "Search for similar past missions in the organization to learn from their outcomes, key decisions, and artifacts. Use this to avoid repeating mistakes or to reuse successful strategies.",
    parameters: z.object({
        query: z.string().describe("The search query (e.g., 'researching competitor pricing' or 'deployment failure')"),
        limit: z.number().optional().default(3).describe("Number of relevant missions to retrieve")
    }),
    execute: async (args: { query: string, limit?: number }, context: any) => {
        const { query, limit = 3 } = args;
        const orgId = context.organizationId;

        if (!orgId) {
            return { error: "Organization context missing." };
        }

        logger.info(`[MissionResearchTool] Searching missions for query: ${query}`);

        // 1. Search for missions
        const { searchService } = await import("../../../knowledge/core/search/search-service.js");
        const searchResults = await searchService.executeUnifiedSearch(query, "keyword", orgId);
        const missionResults = searchResults.filter(r => r.type === "mission").slice(0, limit);

        if (missionResults.length === 0) {
            return { result: "No similar past missions found." };
        }

        // 2. Fetch full blackboard for these missions
        const finalResults = [];
        for (const res of missionResults) {
            const [mission] = await db.select()
                .from(missions)
                .where(eq(missions.id, res.id.toString().replace("mission-", "") as any))
                .limit(1);

            if (mission) {
                // Extract useful bits from blackboard
                const blackboard = (mission.blackboard as any) || {};
                const lessons = blackboard.lessons || [];
                const decisions = blackboard.decisions || [];
                
                finalResults.push({
                    id: mission.id,
                    name: mission.name,
                    intent: mission.objective,
                    summary: blackboard.system_digest || "No summary available.",
                    key_lessons: lessons.slice(-3),
                    key_decisions: decisions.slice(-3),
                    status: mission.status
                });
            }
        }

        return {
            results: finalResults,
            note: "These missions may provide useful context for your current task."
        };
    }
};


