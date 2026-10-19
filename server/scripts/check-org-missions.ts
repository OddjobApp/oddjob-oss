import "dotenv/config";
import { db } from "../db/index.js";
import { missions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function check() {
  const orgId = 252; // using the latest org from the test
  const m = await db.select().from(missions).where(eq(missions.organizationId, orgId));
  console.log(`Missions for Org ${orgId}:`, m.length);
  m.forEach(mi => console.log(` - ${mi.name} [${mi.status}]`));
  process.exit(0);
}

check().catch(console.error);
