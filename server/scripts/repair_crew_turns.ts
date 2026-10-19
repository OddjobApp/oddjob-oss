import { db } from "../database_service.js";
import { crewTurns } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function repairTurns() {
  const turns = await db.select().from(crewTurns);
  let updatedCount = 0;

  for (const t of turns) {
    let content = t.content.trim();
    if (content.startsWith("{") && content.endsWith("}")) {
      try {
        const parsed = JSON.parse(content);
        let cleaned = parsed.answer || parsed.content || parsed.response;
        if (typeof cleaned === "string" && cleaned.trim()) {
          await db
            .update(crewTurns)
            .set({ content: cleaned.trim() })
            .where(eq(crewTurns.id, t.id));
          updatedCount++;
          console.log(`[REPAIRED Turn ${t.id}] -> "${cleaned.trim().substring(0, 80)}..."`);
        }
      } catch {}
    }
  }

  console.log(`\nSuccessfully cleaned ${updatedCount} turn(s) with raw JSON content.`);
  process.exit(0);
}

repairTurns().catch(err => {
  console.error("Turn Repair Error:", err);
  process.exit(1);
});
