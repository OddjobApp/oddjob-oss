import { systemConfigService } from "../domain/system/system-config.service.js";

/**
 * Diagnostic: what AI configuration an org actually resolves to, and whether
 * spend is currently permitted for it.
 *
 * This script had drifted badly from the service it inspects: it imported from
 * `domain/system/core/`, a directory that does not exist; imported `trackSpend`
 * as a standalone export when it is a method on the service; and printed
 * `cfg.systemAiDefaults`, which is not a field of SystemConfig. AI defaults are
 * resolved per service key and org by `resolveAiConfig`.
 */
const ORG_ID = Number(process.argv[2] ?? 291);
const SERVICE_KEY = process.argv[3] ?? "agent";

async function main() {
  const cfg = await systemConfigService.getGlobalConfig();

  console.log(`=== Resolved AI config (service="${SERVICE_KEY}", org=${ORG_ID}) ===`);
  const aiConfig = await systemConfigService.resolveAiConfig(SERVICE_KEY, ORG_ID);
  if (aiConfig) {
    // Never print apiKey.
    const { apiKey, ...safe } = aiConfig;
    console.log(JSON.stringify({ ...safe, apiKey: apiKey ? `set (${apiKey.length} chars)` : "missing" }, null, 2));
  } else {
    console.log("No AI config resolved — the service falls back to environment defaults.");
  }

  console.log("\n=== Service URLs ===");
  console.log(JSON.stringify(cfg.serviceUrls, null, 2));

  // amount 0: a read-only budget probe that records no spend.
  console.log(`\n=== Budget check (org ${ORG_ID}) ===`);
  const budget = await systemConfigService.trackSpend(0, ORG_ID, null);
  console.log(JSON.stringify(budget, null, 2));

  process.exit(0);
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
