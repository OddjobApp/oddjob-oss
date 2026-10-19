import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";

async function run() {
    console.log("Adding failure_reason column to mission_runs...");
    try {
        await db.execute(sql`ALTER TABLE "mission_runs" ADD COLUMN "failure_reason" text`);
        console.log("Successfully added failure_reason column.");
    } catch (e: any) {
        if (e.message.includes("already exists")) {
            console.log("Column failure_reason already exists. Skipping.");
        } else {
            console.error("Migration failed:", e.message);
            process.exit(1);
        }
    }
    process.exit(0);
}

run();
