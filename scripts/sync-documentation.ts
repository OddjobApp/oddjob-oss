/**
 * Documentation sync — fingerprint-aware regeneration trigger.
 *
 * Regenerates system documentation specs (module / API / UI) whose content
 * fingerprint no longer matches the stored one — i.e. only the specs whose
 * documented facts actually changed. Designed to be invoked on demand: as a
 * post-deploy step, from a dispatchable CI workflow, or manually by ops, to drop
 * doc-staleness latency from the daily schedule to "right after a change ships".
 *
 * Usage:
 *   npm run docs:sync                # all orgs, only stale/missing specs
 *   npm run docs:sync -- --force     # all orgs, rebuild every spec
 *   npm run docs:sync -- --org=123   # a single org
 *
 * Requires the same DATABASE_URL + AI configuration as the app (the AI
 * enrichment falls back to deterministic facts if AI is unavailable).
 */
import { db } from "@server/database_service.js";
import { orgs } from "@shared/schema/auth.js";
import { documentationService } from "@domain/admin/documentation.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("docs:sync");

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const orgArg = args.find((a) => a.startsWith("--org="));
  const orgId = orgArg ? parseInt(orgArg.split("=")[1], 10) : null;

  if (orgArg && (orgId === null || Number.isNaN(orgId))) {
    logger.error(`Invalid --org value: ${orgArg}`);
    process.exit(1);
  }

  const targets = orgId != null ? [{ id: orgId }] : await db.select({ id: orgs.id }).from(orgs);

  logger.info(`Documentation sync starting (force=${force}) for ${targets.length} org(s)`);

  let totalRegenerated = 0;
  let failures = 0;
  for (const org of targets) {
    try {
      const { scheduled } = await documentationService.generateAll(org.id, force);
      totalRegenerated += scheduled;
      logger.info(`Org ${org.id}: regenerated ${scheduled} spec(s)`);
    } catch (err: any) {
      failures++;
      logger.error(`Org ${org.id}: sync failed — ${err.message}`);
    }
  }

  logger.info(
    `Documentation sync complete — ${totalRegenerated} spec(s) regenerated across ${targets.length} org(s)` +
      (failures ? `, ${failures} org(s) failed` : ""),
  );
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  logger.error(`Fatal: ${err?.message ?? err}`);
  process.exit(1);
});
