/**
 * Durable backing for the spatial iteration gate's confirmation counters.
 *
 * Implements the `PersistenceStore` port the predicate engine declares. Kept in
 * its own module so the engine has no database import — that is what lets the
 * engine be unit-tested with no connection, and what lets a deployment run the
 * gate in memory-only mode by simply not attaching this.
 */

import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { spatialConditionState } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import type { PersistenceStore } from "./spatial-predicate-engine.service.js";

const logger = createLogger("SpatialPersistenceStore");

interface StateRow {
  conditionKey: string;
  subjectId: string;
  hits: number;
  misses: number;
  latched: boolean;
  lastSeenMs: number;
}

export class SpatialPersistenceStoreService implements PersistenceStore {
  /**
   * Loads counters for a batch of (condition, subject) pairs.
   *
   * Fetches by the two column sets rather than issuing one query per pair — a
   * signal can touch many conditions, and a query each would put the gate's
   * cost on the ingest path. The superset is filtered in memory, which is
   * cheap because the row count is bounded by conditions × subjects in flight.
   */
  public async load(
    organizationId: number,
    keys: Array<{ conditionKey: string; subjectId: string }>
  ): Promise<StateRow[]> {
    if (!keys.length) return [];

    const conditionKeys = [...new Set(keys.map((k) => k.conditionKey))];
    const subjectIds = [...new Set(keys.map((k) => k.subjectId))];

    const rows = await db
      .select()
      .from(spatialConditionState)
      .where(
        and(
          eq(spatialConditionState.organizationId, organizationId),
          inArray(spatialConditionState.conditionKey, conditionKeys),
          inArray(spatialConditionState.subjectId, subjectIds)
        )
      );

    const wanted = new Set(keys.map((k) => `${k.conditionKey}::${k.subjectId}`));

    return rows
      .filter((r) => wanted.has(`${r.conditionKey}::${r.subjectId}`))
      .map((r) => ({
        conditionKey: r.conditionKey,
        subjectId: r.subjectId,
        hits: r.hits,
        misses: r.misses,
        latched: r.latched,
        lastSeenMs: new Date(r.lastSeenAt).getTime(),
      }));
  }

  /**
   * Upserts changed counters.
   *
   * `onConflictDoUpdate` on the (org, condition, subject) unique index rather
   * than select-then-insert: two consumers processing the same subject
   * concurrently would otherwise race, and one would fail on the unique
   * constraint.
   */
  public async save(organizationId: number, rows: StateRow[]): Promise<void> {
    if (!rows.length) return;

    await db
      .insert(spatialConditionState)
      .values(
        rows.map((r) => ({
          organizationId,
          conditionKey: r.conditionKey,
          subjectId: r.subjectId,
          hits: r.hits,
          misses: r.misses,
          latched: r.latched,
          lastSeenAt: new Date(r.lastSeenMs),
        }))
      )
      .onConflictDoUpdate({
        target: [
          spatialConditionState.organizationId,
          spatialConditionState.conditionKey,
          spatialConditionState.subjectId,
        ],
        set: {
          hits: sql`excluded.hits`,
          misses: sql`excluded.misses`,
          latched: sql`excluded.latched`,
          lastSeenAt: sql`excluded.last_seen_at`,
        },
      });
  }

  /**
   * Drops counters for subjects that have stopped reporting.
   *
   * Unbounded growth is the failure mode here: one row per tracked entity per
   * gated condition, and entities come and go. A subject absent for longer than
   * any plausible confirmation window has no progress worth keeping.
   *
   * Latched rows are kept longer — a latched geofence is live state, and
   * dropping it would re-fire ON_ENTER for an asset still sitting in the zone,
   * which is the exact bug this table exists to prevent.
   */
  public async prune(
    unlatchedOlderThanMs = 24 * 60 * 60 * 1000,
    latchedOlderThanMs = 30 * 24 * 60 * 60 * 1000
  ): Promise<number> {
    const unlatchedCutoff = new Date(Date.now() - unlatchedOlderThanMs);
    const latchedCutoff = new Date(Date.now() - latchedOlderThanMs);

    const deleted = await db
      .delete(spatialConditionState)
      .where(
        or(
          and(
            eq(spatialConditionState.latched, false),
            lt(spatialConditionState.lastSeenAt, unlatchedCutoff)
          ),
          and(
            eq(spatialConditionState.latched, true),
            lt(spatialConditionState.lastSeenAt, latchedCutoff)
          )
        )
      )
      .returning({ id: spatialConditionState.id });

    if (deleted.length) {
      logger.info(`[SpatialPersistenceStore] Pruned ${deleted.length} stale condition state row(s).`);
    }
    return deleted.length;
  }
}

export const spatialPersistenceStore = new SpatialPersistenceStoreService();
