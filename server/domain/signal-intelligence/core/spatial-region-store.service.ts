/**
 * Read-side backing for rule conditions that reference a stored region.
 *
 * Implements the `RegionStore` port the predicate engine declares. Kept in its
 * own module for the same reason as the persistence store: the engine has no
 * database import, which is what lets it be unit-tested with no connection and
 * run region-less by simply not attaching this.
 */

import { spatialRegionService } from "./spatial-region.service.js";
import { createLogger } from "@server/utils/logger.js";
import type { RegionStore } from "./spatial-predicate-engine.service.js";

const logger = createLogger("SpatialRegionStore");

export class SpatialRegionStoreService implements RegionStore {
  /**
   * Loads regions by id, scoped to the owning organization.
   *
   * Delegates to `spatialRegionService.getMany`, which already applies the two
   * rules that matter and is the single place they should live:
   *
   *   - the org filter IS the access control — a rule naming another org's
   *     region id gets nothing back, and the engine then refuses the condition
   *     rather than evaluating against a region it may not read;
   *   - soft-deleted regions are excluded, so a removed boundary stops matching
   *     instead of firing from rules that still reference it.
   */
  async load(
    organizationId: number,
    regionIds: number[]
  ): Promise<Array<{ id: number; name: string; cells: string[] }>> {
    if (!regionIds.length) return [];

    const rows = await spatialRegionService.getMany({ organizationId }, regionIds);

    if (rows.length !== regionIds.length) {
      const found = new Set(rows.map((r) => r.id));
      const missing = regionIds.filter((id) => !found.has(id));
      logger.warn(
        `Regions [${missing.join(", ")}] are referenced by a rule but not readable for ` +
          `org ${organizationId} — deleted, or owned by another organization.`
      );
    }

    return rows.map((r) => ({ id: r.id, name: r.name, cells: r.cells ?? [] }));
  }
}

export const spatialRegionStore = new SpatialRegionStoreService();
