import { db } from "../database_service.js";
import { llmRouterLogs, costLedger, operationalCycles, missions, jobs } from "@shared/schema/index.js";
import { desc, gte } from "drizzle-orm";

async function main() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  console.log("=== RECENT LLM ROUTER LOGS (LAST 1 HOUR) ===");
  try {
    const logs = await db.select().from(llmRouterLogs).where(gte(llmRouterLogs.createdAt, oneHourAgo)).orderBy(desc(llmRouterLogs.createdAt)).limit(20);
    console.log(`Count: ${logs.length}`);
    for (const l of logs) {
      console.log(`  [${l.createdAt.toISOString()}] Provider: ${l.selectedProviderId}, Model: ${l.selectedModelId}, Strategy: ${l.routingStrategy}`);
    }
  } catch (err: any) {
    console.log("LLM router logs error:", err.message);
  }

  console.log("\n=== RECENT COST LEDGER (LAST 1 HOUR) ===");
  try {
    // cost_ledger records `recordedAt`/`costUsd`/`tokensTotal` and attributes a
    // call by model+provider. This read invented createdAt, totalCostUsd,
    // moduleName, actionType and totalTokens, so it could never have run.
    const entries = await db.select().from(costLedger).where(gte(costLedger.recordedAt, oneHourAgo)).orderBy(desc(costLedger.recordedAt)).limit(20);
    console.log(`Count: ${entries.length}`);
    let totalCost = 0;
    for (const e of entries) {
      // decimal() comes back as a string.
      const cost = Number(e.costUsd || 0);
      totalCost += cost;
      console.log(`  [${e.recordedAt.toISOString()}] Provider: ${e.provider}, Model: ${e.model}, Tokens: ${e.tokensTotal}, Cost: $${cost.toFixed(4)}`);
    }
    console.log(`Total Recorded Cost (1h): $${totalCost.toFixed(4)}`);
  } catch (err: any) {
    console.log("Cost ledger error:", err.message);
  }

  console.log("\n=== ACTIVE OPERATIONAL CYCLES ===");
  try {
    const activeCycles = await db.select().from(operationalCycles).where(gte(operationalCycles.updatedAt, oneHourAgo)).limit(10);
    console.log(`Active cycles (1h): ${activeCycles.length}`);
    for (const c of activeCycles) {
      console.log(`  Cycle ID ${c.id}: "${c.name}" (status: ${c.status})`);
    }
  } catch (err: any) {
    console.log("Cycles error:", err.message);
  }

  console.log("\n=== ACTIVE MISSIONS ===");
  try {
    const activeMissions = await db.select().from(missions).where(gte(missions.updatedAt, oneHourAgo)).limit(10);
    console.log(`Active missions (1h): ${activeMissions.length}`);
    for (const m of activeMissions) {
      console.log(`  Mission ID ${m.id}: "${m.name}" (status: ${m.status})`);
    }
  } catch (err: any) {
    console.log("Missions error:", err.message);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("Check Error:", err);
  process.exit(1);
});
