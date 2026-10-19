
import { db } from "../server/database_service.js";
import { missions } from "../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function fix() {
    await db.update(missions).set({ executionStrategy: 'dynamic_autonomous' }).where(eq(missions.id, 2002));
    console.log('Mission 2002 updated to dynamic_autonomous');
}

fix().catch(err => {
    console.error(err);
    process.exit(1);
});
