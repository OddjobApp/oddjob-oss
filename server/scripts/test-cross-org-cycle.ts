import "dotenv/config";
import { db } from "../database_service.js";
import { operationalCycles } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

async function main() {
    const CYCLE_ID = 139;
    const SUPER_ADMIN_DEFAULT_ORG = 1; // What admin user defaults to

    console.log(`\nReproducing: super admin (defaults to org ${SUPER_ADMIN_DEFAULT_ORG}) viewing cycle ${CYCLE_ID} (owned by SSE Test Org / org 65)\n`);

    // OLD behavior — what the user saw:
    const oldQuery = await db.select().from(operationalCycles)
        .where(and(eq(operationalCycles.id, CYCLE_ID), eq(operationalCycles.organizationId, SUPER_ADMIN_DEFAULT_ORG)))
        .limit(1);
    console.log(`OLD behavior (org filter forced to ${SUPER_ADMIN_DEFAULT_ORG}): ${oldQuery.length === 0 ? "❌ 404 Cycle Not Found" : "✅ found"}`);

    // NEW behavior — super admin path:
    const newQuery = await db.select().from(operationalCycles)
        .where(and(eq(operationalCycles.id, CYCLE_ID)))
        .limit(1);
    console.log(`NEW behavior (super admin: no org filter):       ${newQuery.length === 0 ? "❌ still not found" : `✅ found — cycle "${newQuery[0].name}" in org ${newQuery[0].organizationId}`}`);

    // Regular user in SSE Test Org (org 65):
    const regularQuery = await db.select().from(operationalCycles)
        .where(and(eq(operationalCycles.id, CYCLE_ID), eq(operationalCycles.organizationId, 65)))
        .limit(1);
    console.log(`Regular user in org 65:                          ${regularQuery.length === 0 ? "❌ not found" : "✅ found"}`);

    // Regular user in a DIFFERENT org — should still be blocked:
    const wrongOrgQuery = await db.select().from(operationalCycles)
        .where(and(eq(operationalCycles.id, CYCLE_ID), eq(operationalCycles.organizationId, 99)))
        .limit(1);
    console.log(`Regular user in unrelated org 99:                ${wrongOrgQuery.length === 0 ? "✅ correctly blocked (404)" : "❌ leaked!"}`);

    process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
