/**
 * purge-all-apps.ts
 * Deletes ALL rows from the apps table (cascades to app_deployments,
 * app_telemetry, app_audit_logs, app_records). Also clears forge-workspace.
 *
 * Run: npx tsx scripts/adhoc/purge-all-apps.ts
 */
import { db } from "@server/db/index.js";
import { apps } from "@shared/schema/apps.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FORGE_WORKSPACE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../storage/forge-workspace"
);

async function main() {
  // 1. Wipe DB
  const result = await db.delete(apps);
  console.log(`[DB] Deleted all apps rows (cascade cleared deployments/tokens/telemetry/records)`);

  // 2. Wipe forge-workspace
  const entries = await fs.readdir(FORGE_WORKSPACE, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await fs.rm(path.join(FORGE_WORKSPACE, entry.name), { recursive: true, force: true });
      removed++;
    }
  }
  console.log(`[FS] Removed ${removed} forge-workspace directories`);
  console.log("Done.");
}

main().catch(e => { console.error(e); process.exit(1); });
