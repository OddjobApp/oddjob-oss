/**
 * Signal Feed Poller
 *
 * Drives the signal ingestion pipeline on each feed's configured interval.
 *
 * WHY THIS NEEDS A HOME: `signalIngestionService.pollAndProcess` had exactly one
 * caller — the manual `POST /:id/poll` route. `polling_interval_seconds` was
 * validated on write, persisted, and then read by nothing at all. Every feed in
 * the platform, including the seeded Hacker News feed with its 900s interval,
 * ingested only when a human hand-POSTed to it. Configuring a feed looked like
 * subscribing to a source; it wasn't.
 *
 * It lives in the standalone worker process for the same reason mission and
 * signal-intelligence maintenance do: the HTTP-server path is skipped under
 * SKIP_WORKERS, which would leave this running in no process at all.
 */

import { db } from "@server/database_service.js";
import { sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { signalFeeds, type SignalFeedConfig } from "@shared/schema/index.js";
import { signalIngestionService } from "../core/signal-ingestion.service.js";
import { registerBuiltInFetchers } from "../core/fetchers/index.js";

const logger = createLogger("SignalFeedPoller");

/**
 * How often to look for due feeds. The floor on `polling_interval_seconds` is
 * 30s, so a 15s sweep keeps scheduling jitter below half the tightest interval
 * a feed can ask for.
 */
const TICK_INTERVAL_MS = 15_000;

/** Delay before the first sweep so it does not compete with process startup. */
const INITIAL_DELAY_MS = 20_000;

/** Ceiling on feeds claimed per sweep, so one tick cannot monopolise the worker. */
const MAX_FEEDS_PER_TICK = 50;

/** Feeds polled concurrently within a sweep. */
const POLL_CONCURRENCY = 4;

/**
 * Lock lifetime. Generous because `pollAndProcess` runs LLM extraction per
 * entry and can legitimately take minutes on a large first fetch. If a worker
 * dies mid-poll its feed pauses for at most this long — strictly better than
 * two workers double-ingesting the same entries, which the 72h dedup window
 * would mask rather than prevent once a lock expired early.
 */
const LOCK_TTL_SECONDS = 900;

const LOCK_KEY_PREFIX = "signal:poll:lock:";

/** Release only our own lock — never one a later holder acquired after we expired. */
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

let tickInterval: NodeJS.Timeout | null = null;
let initialTimer: NodeJS.Timeout | null = null;
/** Guards against overlapping sweeps when one runs longer than TICK_INTERVAL_MS. */
let sweepInFlight = false;

/**
 * Feeds whose next poll is due.
 *
 * The backoff arm mirrors `getBackoffDelayMs` (30s/60s/120s indexed by failure
 * count): a failing feed must not be re-polled at its normal cadence, and
 * `handlePollFailure` only doubles the stored interval once, at the point it
 * marks the feed degraded.
 */
async function selectDueFeeds(): Promise<SignalFeedConfig[]> {
  const rows = await db
    .select()
    .from(signalFeeds)
    .where(sql`
      ${signalFeeds.enabled} = true
      AND ${signalFeeds.status} <> 'disabled'
      AND (
        ${signalFeeds.lastPollAt} IS NULL
        OR ${signalFeeds.lastPollAt} + make_interval(secs => CASE
             WHEN ${signalFeeds.consecutiveFailures} = 0
               THEN ${signalFeeds.pollingIntervalSeconds}
             ELSE GREATEST(
               ${signalFeeds.pollingIntervalSeconds},
               (ARRAY[30, 60, 120])[LEAST(${signalFeeds.consecutiveFailures}, 2) + 1]
             )
           END) <= now()
      )
    `)
    // Never-polled feeds first, then the longest-waiting.
    .orderBy(sql`${signalFeeds.lastPollAt} ASC NULLS FIRST`)
    .limit(MAX_FEEDS_PER_TICK);

  return rows as SignalFeedConfig[];
}

/**
 * Poll one feed under a cross-process lock.
 * Returns true if this worker actually performed the poll.
 */
async function pollOneFeed(feed: SignalFeedConfig): Promise<boolean> {
  const { redis } = await import(
    "@domain/core/infrastructure/redis/redis-client.js"
  );

  const lockKey = `${LOCK_KEY_PREFIX}${feed.id}`;
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const acquired = await redis.set(lockKey, token, "EX", LOCK_TTL_SECONDS, "NX");
  if (acquired === null) {
    logger.debug(`Feed ${feed.id} ("${feed.name}") is being polled elsewhere; skipping.`);
    return false;
  }

  try {
    const result = await signalIngestionService.pollAndProcess(feed);
    logger.info(
      `Polled feed "${feed.name}" (id=${feed.id}, type=${feed.sourceType}): ` +
        `${result.entries} entries, ${result.events} events, ${result.transitions} transitions`
    );
    return true;
  } catch (err: any) {
    // pollFeed already records fetch failures against the feed and applies
    // backoff. Reaching here means the failure was downstream of the fetch —
    // extraction, the causal graph, the world-model bridge — so it must not
    // take the sweep down with it.
    logger.error(
      `Processing failed for feed "${feed.name}" (id=${feed.id}): ${err.message}`
    );
    return true;
  } finally {
    try {
      await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token);
    } catch (err: any) {
      // The lock expires on its own; a failed release costs one interval.
      logger.warn(`Could not release poll lock for feed ${feed.id}: ${err.message}`);
    }
  }
}

/** One sweep: find due feeds and poll them with bounded concurrency. */
async function sweep(): Promise<void> {
  if (sweepInFlight) {
    logger.debug("Previous sweep still running; skipping this tick.");
    return;
  }
  sweepInFlight = true;

  try {
    // Idempotent. Also called from startSignalFeedPoller, but repeated here so
    // a sweep is correct regardless of entry point — an unregistered source
    // type silently falls back to the generic HTTP fetcher rather than failing.
    registerBuiltInFetchers();

    const due = await selectDueFeeds();
    if (due.length === 0) return;

    logger.info(`${due.length} feed(s) due for polling.`);

    const queue = [...due];
    const runners = Array.from(
      { length: Math.min(POLL_CONCURRENCY, queue.length) },
      async () => {
        while (queue.length > 0) {
          const feed = queue.shift();
          if (!feed) return;
          await pollOneFeed(feed);
        }
      }
    );

    await Promise.all(runners);
  } catch (err: any) {
    // A bad sweep must never stop the schedule — the next tick retries.
    logger.error(`Signal feed sweep failed: ${err.message}`);
  } finally {
    sweepInFlight = false;
  }
}

export function startSignalFeedPoller(): void {
  if (process.env.SIGNAL_FEED_POLLING_ENABLED === "false") {
    logger.warn(
      "SIGNAL_FEED_POLLING_ENABLED=false — signal feeds will only ingest via the manual poll route."
    );
    return;
  }

  if (tickInterval) {
    logger.warn("Signal feed poller already running; ignoring duplicate start.");
    return;
  }

  // Must precede the first sweep: an unregistered source type falls back to the
  // generic HTTP fetcher instead of failing, so a missed registration would
  // show up as a healthy feed returning nothing.
  registerBuiltInFetchers();

  tickInterval = setInterval(() => void sweep(), TICK_INTERVAL_MS);
  initialTimer = setTimeout(() => void sweep(), INITIAL_DELAY_MS);

  logger.info(
    `Signal feed poller started; sweeping every ${TICK_INTERVAL_MS / 1000}s ` +
      `(up to ${MAX_FEEDS_PER_TICK} feeds/tick, ${POLL_CONCURRENCY} concurrent).`
  );
}

export function stopSignalFeedPoller(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }
  logger.info("Stopped signal feed poller.");
}

/** Exposed for tests and for the manual "sweep now" path. */
export const __testables = { selectDueFeeds, pollOneFeed, sweep };
