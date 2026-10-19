/** @vitest-environment node */
import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@server/database_service.js";
import { sql } from "drizzle-orm";
import { rescueSessions } from "@shared/schema/rescue";

describe("Rescue Table Check", () => {
    it("should query rescue_sessions", async () => {
        console.log("DB URL:", process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":****@"));
        const result = await db.execute(sql`SELECT count(*) FROM rescue_sessions`);
        console.log("Raw SQL Count:", result.rows[0].count);

        try {
            const sessions = await db.select().from(rescueSessions).limit(1);
            console.log("Drizzle Select Count:", sessions.length);
        } catch (e: any) {
            console.error("Drizzle Select FAILED:", e.message);
        }
    });
});
