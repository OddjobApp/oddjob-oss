
import { missionResearchTool } from "@domain/tools/v1/capabilities/mission-research.js";
import { searchService } from "@domain/knowledge/core/search/search-service.js";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { missions } from "@shared/schema/index.js";
import { eq, and, ilike } from "drizzle-orm";
import { assertOrgId } from "@server/utils/auth-context.js";

const logger = createLogger("TestMissionResearch");

async function runTest() {
    logger.info("Starting MissionResearchTool test...");

    // 1. Find a mission to search for (or just use a generic query)
    const [sampleMission] = await db.select().from(missions).limit(1);
    const orgId = assertOrgId(sampleMission?.organizationId);

    const context = {
        organizationId: orgId,
        userId: "test-user"
    };

    const query = "Autonomous";
    logger.info(`Searching for: ${query}`);

    logger.info("Calling searchService.executeUnifiedSearch...");
    const searchResults = await searchService.executeUnifiedSearch(query, "keyword", orgId);
    logger.info(`Found ${searchResults.length} total search results.`);

    // --- DEEP INSPECTION ---
    logger.info(`Inspecting Mission 48 directly...`);
    const [m48] = await db.select().from(missions).where(eq(missions.id, 48)).limit(1);
    if (m48) {
        logger.info(`MISSION 48: name='${m48.name}', orgId=${m48.organizationId} (${typeof m48.organizationId})`);
        logger.info(`Testing query match manually...`);
        const queryMatches = m48.name.includes("Autonomous");
        logger.info(`Name contains 'Autonomous': ${queryMatches}`);
    }

    // --- RAW SQL TEST ---
    logger.info("Running raw SQL query for mission...");
    const { sql } = await import("drizzle-orm");
    const rawResults = await db.execute(sql`SELECT id, name FROM missions WHERE organization_id = ${orgId} AND name ILIKE ${`%${query}%`}`) as any;
    logger.info(`Raw SQL found ${rawResults.length} missions.`);
    if (rawResults.length > 0) {
        logger.info(`Raw SQL matched mission content: ${JSON.stringify(rawResults[0])}`);
    }

    // --- ORG ONLY TEST ---
    logger.info(`Running Org-only query for OrgID ${orgId}...`);
    const orgMissions = await db.select().from(missions).where(eq(missions.organizationId, orgId)).limit(5);
    logger.info(`Found ${orgMissions.length} missions for this org.`);

    // --- NAME ONLY TEST ---
    logger.info(`Running Name-only query (ilike '%Autonomous%')...`);
    const nameMissions = await db.select().from(missions).where(ilike(missions.name, `%Autonomous%`)).limit(5);
    logger.info(`Found ${nameMissions.length} missions matching 'Autonomous' by name.`);

    // --- DIRECT DB TEST ---
    logger.info("Running direct DB query for mission (Org AND Name)...");
    const dbMissions = await db.select()
        .from(missions)
        .where(
            and(
                eq(missions.organizationId, orgId),
                ilike(missions.name, `%${query}%`)
            )
        )
        .limit(5);
    logger.info(`Direct DB query found ${dbMissions.length} missions.`);
    if (dbMissions.length > 0) {
        logger.info(`Sample matched mission ID: ${dbMissions[0].id}`);
    }

    const missionResults = searchResults.filter(r => r.type === "mission").slice(0, 3);
    logger.info(`Found ${missionResults.length} mission results.`);

    if (missionResults.length === 0) {
        logger.warn("No similar past missions found in results.");
        return;
    }

    // 2. Fetch full blackboard for these missions
    const finalResults = [];
    for (const res of missionResults) {
        logger.info(`Fetching details for mission ID: ${res.id}`);
        const [mission] = await db.select()
            .from(missions)
            .where(eq(missions.id, res.id.toString().replace("mission-", "") as any))
            .limit(1);
        
        if (mission) {
            logger.info(`Successfully fetched mission: ${mission.name}`);
        }
    }
}

runTest().catch(err => {
    logger.error("Test failed:", err);
    process.exit(1);
});

