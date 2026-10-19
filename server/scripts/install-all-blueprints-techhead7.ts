/**
 * Install ALL available YAML blueprints to TECHHEAD7 organization
 * Usage: npx tsx server/scripts/install-all-blueprints-techhead7.ts
 */
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { orgForgeService } from "../domain/org/core/org-forge.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TECHHEAD7_ORG_ID = 291;

// Blueprints that already have dedicated install scripts
const SKIP_BLUEPRINTS = [
  "hybrid-sdlc.cycle.yaml",
  "agent-training.cycle.yaml",
  "asset-service-dispatch.cycle.yaml",
  "chaos-drill.cycle.yaml",
  "incident-response-chain.cycle.yaml",
  "sre-operations-suite.cycle.yaml",
];

async function installAllBlueprints() {
  const cyclesDir = path.join(__dirname, "../cycles");
  const files = readdirSync(cyclesDir).filter(f => f.endsWith(".cycle.yaml"));

  console.log(`\n📦 Installing ${files.length} blueprint files to TECHHEAD7 (org ${TECHHEAD7_ORG_ID})...\n`);

  let installed = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    if (SKIP_BLUEPRINTS.includes(file)) {
      console.log(`⏭️  SKIP: ${file} (already has dedicated installer)`);
      skipped++;
      continue;
    }

    try {
      console.log(`🔧 Installing: ${file}`);
      const filePath = path.join(cyclesDir, file);
      const yamlContent = readFileSync(filePath, "utf-8");

      const result = await orgForgeService.installCycleApp(TECHHEAD7_ORG_ID, yamlContent, {
        skipAppLaunch: true,
      });

      if (!("cycleId" in result)) {
        throw new Error("installCycleApp returned an unexpected result shape (no cycleId)");
      }

      console.log(`   ✅ Cycle ${result.cycleId} installed (${result.agentsProvisioned} agents, ${result.appsProvisioned} apps)`);
      installed++;
    } catch (err: any) {
      console.error(`   ❌ FAILED: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📊 Installation Summary`);
  console.log(`${"=".repeat(60)}`);
  console.log(`✅ Installed:  ${installed}`);
  console.log(`⏭️  Skipped:    ${skipped}`);
  console.log(`❌ Failed:     ${failed}`);
  console.log(`📦 Total:      ${files.length}`);
  console.log(`${"=".repeat(60)}\n`);
}

installAllBlueprints().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
