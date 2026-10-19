/**
 * Signal Intelligence Maintenance
 *
 * Periodic upkeep for the spatial rule surface:
 * - Prunes `spatial_condition_state`, the iteration gate's confirmation counters.
 *
 * WHY THIS NEEDS A HOME: the gate writes one row per (organization, condition,
 * tracked subject). Subjects come and go — a vessel that stops reporting leaves
 * its counters behind forever — so without pruning the table grows without
 * bound.
 *
 * It lives in the standalone worker process rather than the HTTP server for the
 * same reason mission maintenance does: the server path is skipped under
 * SKIP_WORKERS, which would leave this running in no process at all.
 */

import { createLogger } from "@server/utils/logger.js";
import { spatialPersistenceStore } from "../core/spatial-persistence-store.service.js";

const logger = createLogger("SignalIntelligenceMaintenance");

/** Hourly is ample: the retention windows are measured in days. */
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/** Delay before the first run so it does not compete with process startup. */
const INITIAL_DELAY_MS = 60 * 1000;

let pruneInterval: NodeJS.Timeout | null = null;
let initialTimer: NodeJS.Timeout | null = null;

async function prune(): Promise<void> {
  try {
    await spatialPersistenceStore.prune();
  } catch (err: any) {
    // Maintenance failing must never take the worker down — the gate keeps
    // working with a larger table.
    logger.error(`Spatial condition state pruning failed: ${err.message}`);
  }
}

export function startSignalIntelligenceMaintenance(): void {
  if (pruneInterval) {
    logger.warn("Signal intelligence maintenance already running; ignoring duplicate start.");
    return;
  }

  pruneInterval = setInterval(() => void prune(), PRUNE_INTERVAL_MS);
  initialTimer = setTimeout(() => void prune(), INITIAL_DELAY_MS);

  logger.info(
    `Scheduled spatial condition state pruning every ${PRUNE_INTERVAL_MS / 60000} minutes.`
  );
}

export function stopSignalIntelligenceMaintenance(): void {
  if (pruneInterval) {
    clearInterval(pruneInterval);
    pruneInterval = null;
  }
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }
  logger.info("Stopped signal intelligence maintenance.");
}
