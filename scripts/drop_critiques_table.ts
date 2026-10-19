
import "dotenv/config";
import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";

async function dropTable() {
    console.log("Dropping table agent_critiques...");
    await db.execute(sql`DROP TABLE IF EXISTS agent_critiques`);
    console.log("Dropped.");
    process.exit(0);
}

dropTable().catch(console.error);
