import "dotenv/config";
import { db } from "../db/index.js";
import { orgs } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function createOrg() {
  const orgName = 'TECHHEAD2';
  await db.update(orgs).set({name: 'TECHHEAD2_OLD_' + Date.now()}).where(eq(orgs.name, orgName));
  const [org] = await db.insert(orgs).values({
    name: orgName
  }).returning();
  console.log(`\n✅ Successfully created fresh organization!\nName: ${org.name}\nID: ${org.id}\n`);
  process.exit(0);
}

createOrg().catch(console.error);
