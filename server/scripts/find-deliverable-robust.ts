import { db } from "../database_service.js";
import { missionDeliverables } from "../../shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

async function findItem() {
  try {
    const list = await db.select().from(missionDeliverables).where(eq(missionDeliverables.missionId, 91)).orderBy(desc(missionDeliverables.createdAt)).limit(1);
    console.log(JSON.stringify(list, null, 2));
  } catch (err) {
    console.error("DB Error:", err);
  } finally {
    process.exit(0);
  }
}

findItem();

