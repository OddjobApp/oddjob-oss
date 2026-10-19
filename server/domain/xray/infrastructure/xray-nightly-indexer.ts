/**
 * Xray Nightly Indexer
 *
 * Runs a full relationship re-index for all active organizations once per day.
 * Schedules itself via a recursive setTimeout so it survives server restarts
 * and never overlaps if a previous run takes longer than expected.
 *
 * Triggered at 02:00 local server time by default.
 */

import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("XrayNightlyIndexer");
const RUN_HOUR = parseInt(process.env.XRAY_NIGHTLY_HOUR ?? "2", 10); // 2 AM default

let scheduled = false;

function msUntilNextRun(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(RUN_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

async function runNightlyIndexing(): Promise<void> {
  logger.info("[XrayNightly] Starting nightly composition indexing...");

  try {
    const { db } = await import("@server/database_service.js");
    const { orgs } = await import("@shared/schema/index.js");
    const { eq, isNull, or } = await import("drizzle-orm");
    const { queueService } = await import("@domain/core/infrastructure/queue/queue-service.js");

    // Fetch active organizations and orgs with no subscription status (development/self-hosted)
    const targetOrgs = await db
      .select({ id: orgs.id, name: orgs.name })
      .from(orgs)
      .where(
        or(
          eq(orgs.subscriptionStatus, "active"),
          isNull(orgs.subscriptionStatus)
        )
      );

    logger.info(`[XrayNightly] Queuing re-index for ${targetOrgs.length} organizations`);

    for (const org of targetOrgs) {
      try {
        await queueService.xrayQueue.add(`full-reindex-${org.id}`, {
          type: "FULL_REINDEX",
          organizationId: org.id
        });
        logger.info(`[XrayNightly] Org ${org.name} (${org.id}): queued`);
      } catch (err: any) {
        logger.error(`[XrayNightly] Failed to queue for org ${org.id}: ${err.message}`);
      }
    }

    logger.info(`[XrayNightly] Batch queuing complete.`);
  } catch (err: any) {
    logger.error("[XrayNightly] Fatal error during nightly indexing", err.message);
  } finally {
    scheduleNext();
  }
}

function scheduleNext(): void {
  const delay = msUntilNextRun();
  const nextRunAt = new Date(Date.now() + delay).toISOString();
  logger.info(`[XrayNightly] Next run scheduled at ${nextRunAt}`);
  setTimeout(runNightlyIndexing, delay);
}

/**
 * Start the nightly indexer. Safe to call multiple times (idempotent).
 */
export function startXrayNightlyIndexer(): void {
  if (scheduled) return;
  scheduled = true;
  scheduleNext();
  logger.info("[XrayNightly] Nightly indexer started");
}

