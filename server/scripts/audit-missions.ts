import { db } from "../database_service.js";
import { missionRuns, orgs as organizations } from "@shared/schema/index.js";
import { eq, sql } from "drizzle-orm";

async function auditMissions() {
    console.log("Mission Summary by Organization:");
    const results = await db.select({
        orgName: organizations.name,
        status: missionRuns.status,
        count: sql<number>`count(*)`
    })
    .from(missionRuns)
    .innerJoin(organizations, eq(missionRuns.organizationId, organizations.id))
    .groupBy(organizations.name, missionRuns.status)
    .orderBy(organizations.name, missionRuns.status);

    console.table(results);
    process.exit(0);
}

auditMissions().catch(err => {
    console.error("Audit failed:", err);
    process.exit(1);
});

