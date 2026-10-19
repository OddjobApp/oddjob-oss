
import { db } from "../server/db/index.js";
import { missions } from "../shared/schema/index.js";
import { and, eq, or, isNull, desc, sql, aliasedTable } from "drizzle-orm";

async function main() {
    try {
        const { missionService } = await import("../server/domain/mission/core/mission.service.js");
        const list = await missionService.listMissionsWithStats(1);
        console.log(`Results for org 1: ${list.length}`);
        console.log(JSON.stringify(list, null, 2));

        const listAll = await missionService.listMissionsWithStats();
        console.log(`Results for no org: ${listAll.length}`);
        console.log(JSON.stringify(listAll, null, 2));

    } catch (err) {
        console.error("Error in debug-db.ts:", err);
    }
}

main().then(() => process.exit(0));
