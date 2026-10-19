import "dotenv/config";
import { missionService } from "../domain/mission/core/mission.service.js";
import { db } from "../database_service.js";
import { missions } from "@shared/schema/index.js";
import { eq, count, isNull, and } from "drizzle-orm";

async function main() {
    // Baseline counts from DB
    const totalQ = await db.select({ n: count() }).from(missions).where(isNull(missions.deletedAt));
    const org2Q = await db.select({ n: count() }).from(missions).where(and(isNull(missions.deletedAt), eq(missions.organizationId, 2)));
    const org1Q = await db.select({ n: count() }).from(missions).where(and(isNull(missions.deletedAt), eq(missions.organizationId, 1)));
    console.log(`DB: total active=${totalQ[0].n}  org1=${org1Q[0].n}  org2=${org2Q[0].n}\n`);

    // Mode 1: super admin without ?orgId= → uses 0 (all)
    const all = await missionService.listMissionsWithStats(0);
    console.log(`super admin (no ?orgId=, treated as 0): returned ${all.length} missions  (expect ${totalQ[0].n})  → ${all.length === Number(totalQ[0].n) ? "PASS" : "FAIL"}`);

    // Mode 2: ?orgId=2 → returns TechStart Inc only
    const org2 = await missionService.listMissionsWithStats(2);
    console.log(`super admin (?orgId=2): returned ${org2.length} missions             (expect ${org2Q[0].n})  → ${org2.length === Number(org2Q[0].n) ? "PASS" : "FAIL"}`);

    // Mode 3: regular user, defaultOrg = 1 → returns Default Org only
    const org1 = await missionService.listMissionsWithStats(1);
    console.log(`regular user (orgId=1): returned ${org1.length} missions              (expect ${org1Q[0].n})  → ${org1.length === Number(org1Q[0].n) ? "PASS" : "FAIL"}`);

    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
