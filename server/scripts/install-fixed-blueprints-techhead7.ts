/**
 * Install the 4 newly-repaired cycle blueprints into TECHHEAD7 to confirm they
 * now provision cleanly (they previously failed to parse). Data plane only —
 * skipAppLaunch=true skips the Next build, same as the e2e install scripts.
 *
 * Usage: npx tsx server/scripts/install-fixed-blueprints-techhead7.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../database_service.js";
import { orgs, operationalCycles, jobs } from "@shared/schema/index.js";
import { and, eq } from "drizzle-orm";
import { orgForgeService } from "../domain/org/core/org-forge.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BLUEPRINTS = [
    "analytics-dashboard.cycle.yaml",
    "it-service-desk.cycle.yaml",
    "monitoring-observability.cycle.yaml",
    "vendor-management.cycle.yaml",
];

async function main() {
    const [org] = await db.select().from(orgs).where(eq(orgs.name, "TECHHEAD7")).limit(1);
    if (!org) throw new Error("TECHHEAD7 not found");
    console.log(`🏢 TECHHEAD7 = org #${org.id}\n`);

    let anyFail = false;
    for (const file of BLUEPRINTS) {
        const yamlContent = await fs.readFile(path.resolve(__dirname, "../cycles", file), "utf-8");
        console.log(`📦 Installing ${file} (skipAppLaunch=true)...`);
        let result: any;
        try {
            result = await orgForgeService.installCycleApp(org.id, yamlContent, { skipAppLaunch: true });
        } catch (e) {
            anyFail = true;
            console.log(`   ❌ THREW: ${(e as Error).message}\n`);
            continue;
        }
        if (!result?.success) {
            anyFail = true;
            console.log(`   ❌ success=false: ${JSON.stringify(result).slice(0, 300)}\n`);
            continue;
        }
        console.log(`   ✅ success — datasets=${result.datasetsProvisioned ?? 0} agents=${result.agentsProvisioned ?? 0} forms=${result.formsProvisioned ?? 0} missions=${result.missionsProvisioned ?? 0} apps=${result.appsProvisioned ?? 0}`);
        if (result.warnings?.length) {
            console.log(`   ⚠️  ${result.warnings.length} warning(s):`);
            result.warnings.slice(0, 8).forEach((w: string) => console.log(`       - ${w}`));
        }
        console.log("");
    }

    // Verify the cycles now exist as operational_cycles for the org.
    console.log("── Post-install: operational_cycles for the 4 blueprints ──");
    const wanted = ["Analytics Dashboard", "IT Service Desk", "Monitoring & Observability", "Vendor Management"];
    const cycles = await db.select().from(operationalCycles).where(eq(operationalCycles.organizationId, org.id));
    for (const name of wanted) {
        const hit = cycles.find((c) => c.name === name);
        console.log(`   ${hit ? "✅" : "❓"} ${name}${hit ? `  → cycle #${hit.id} [${hit.status}]` : "  (not found under this exact name — check install summary)"}`);
    }

    const agentCount = (await db.select().from(jobs).where(and(eq(jobs.organizationId, org.id), eq(jobs.type, "ai_agent")))).length;
    console.log(`\n   ai_agent jobs in org now: ${agentCount}`);
    console.log(anyFail ? "\n❌ One or more installs failed." : "\n✅ All 4 blueprints installed cleanly.");
    process.exit(anyFail ? 1 : 0);
}

main().catch((e) => { console.error("❌ threw:", e); process.exit(1); });
