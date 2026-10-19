import "dotenv/config";
import { db } from "@server/database_service.js";
import { eq } from "drizzle-orm";
import { orgs } from "@shared/schema/index.js";

async function run() {
    const defaultOrg = await db.select().from(orgs).where(eq(orgs.name, "Default Org"));
    console.log("Default Org ID:", defaultOrg.length ? defaultOrg[0].id : "NOT FOUND");
    process.exit(0);
}
run();
