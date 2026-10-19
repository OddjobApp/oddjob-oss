/**
 * Decommission the two separate SRE cycles (Chaos Engineering & Incident Response)
 * now that they have been merged into the unified SRE Operations Suite.
 *
 * Soft-deletes cycle 223 (Chaos Engineering & Auto-Recovery Drill) and
 * cycle 224 (Incident Triage & Diagnosis) by setting deletedAt.
 *
 * Does NOT delete marketplace entries — other orgs may still use them separately.
 *
 * Usage: npx tsx server/scripts/decommission-separate-sre-cycles.ts
 */
import { db } from "../database_service.js";
import { operationalCycles } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function decommission() {
    const idsToDecommission = [223, 224];

    for (const id of idsToDecommission) {
        await db.update(operationalCycles)
            .set({ deletedAt: new Date(), status: "cancelled", updatedAt: new Date() })
            .where(eq(operationalCycles.id, id));
        console.log(`Decommissioned cycle ${id}`);
    }

    console.log("\nBoth separate SRE cycles soft-deleted. They won't appear in the UI anymore.");
    console.log("Marketplace entries preserved for other orgs.");
    process.exit(0);
}

decommission().catch(e => { console.error(e); process.exit(1); });
