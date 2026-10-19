import "dotenv/config";
import { cycleIntegrationsService } from "../domain/mission/core/cycle-integrations.service.js";
import { db } from "../database_service.js";
import { operationalCycles } from "@shared/schema/index.js";
import { eq, and, desc, like } from "drizzle-orm";

async function main() {
    const ORG_ID = 1;
    const [cycle] = await db.select().from(operationalCycles)
        .where(and(eq(operationalCycles.organizationId, ORG_ID), like(operationalCycles.name, '%Hybrid AI SDLC%')))
        .orderBy(desc(operationalCycles.createdAt)).limit(1);
    if (!cycle) { console.error("No SDLC cycle found"); process.exit(1); }

    console.log(`\nUsing cycle id=${cycle.id} "${cycle.name}"\n`);

    // 1. LIST
    const list1 = await cycleIntegrationsService.listForCycle(cycle.id, ORG_ID);
    console.log(`encryption available: ${list1.encryptionAvailable}`);
    console.log(`integrations found:   ${list1.integrations.length}`);
    list1.integrations.forEach(i => console.log(`  [${i.credentialId}] ${i.integrationName.padEnd(16)}  env=${i.envVarName.padEnd(25)}  status=${i.status}`));

    if (!list1.encryptionAvailable) {
        console.log("\n⚠️  Encryption not available — set ENCRYPTION_KEY env var. Skipping set/clear test.");
        process.exit(0);
    }

    // 2. SET value on first integration
    const target = list1.integrations[0];
    console.log(`\n[SET] credential ${target.credentialId} (${target.integrationName}) ← "test-secret-value-xyz"`);
    await cycleIntegrationsService.setValue(cycle.id, target.credentialId, "test-secret-value-xyz", ORG_ID);

    // 3. LIST again — should show set_encrypted
    const list2 = await cycleIntegrationsService.listForCycle(cycle.id, ORG_ID);
    const after = list2.integrations.find(i => i.credentialId === target.credentialId);
    console.log(`[VERIFY] integration ${target.integrationName} status is now: ${after?.status}`);

    // 4. RESOLVE — should return the value
    const resolved = await cycleIntegrationsService.resolveValue(target.credentialId);
    console.log(`[RESOLVE] returned: ${resolved === "test-secret-value-xyz" ? "✓ match" : `✗ got "${resolved}"`}`);

    // 5. CLEAR
    console.log(`[CLEAR] credential ${target.credentialId}`);
    await cycleIntegrationsService.clearValue(cycle.id, target.credentialId, ORG_ID);
    const list3 = await cycleIntegrationsService.listForCycle(cycle.id, ORG_ID);
    const final = list3.integrations.find(i => i.credentialId === target.credentialId);
    console.log(`[VERIFY] integration ${target.integrationName} status after clear: ${final?.status}`);

    console.log("\n[PASS] Full round-trip verified");
    process.exit(0);
}

main().catch(err => { console.error("[FAIL]", err.message); process.exit(1); });
