#!/usr/bin/env npx tsx
/**
 * Delete all missions and mission_step_assignments from the database.
 * Run: npx tsx scripts/delete-all-missions.ts
 */
import "dotenv/config";
import { db } from "../server/db/index.js";
import { missionStepAssignments, missions } from "@shared/schema";
import { sql } from "drizzle-orm";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  console.log("Deleting all missions...");

  // 1. Delete mission_step_assignments first (references missions) - table may not exist in all DBs
  try {
    const a = await db.delete(missionStepAssignments).where(sql`true`).returning();
    console.log(`Deleted ${a.length} mission_step_assignments rows`);
  } catch (e: any) {
    if (e?.code === "42P01") {
      console.log("mission_step_assignments table not found, skipping");
    } else throw e;
  }

  // 2. Delete all missions
  try {
    const m = await db.delete(missions).where(sql`true`).returning();
    console.log(`Deleted ${m.length} missions rows`);
    console.log("Done. All missions and mission step assignments have been removed.");
  } catch (e: any) {
    if (e?.code === "42P01") {
      console.log("missions table not found. No missions exist in this database.");
    } else throw e;
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
