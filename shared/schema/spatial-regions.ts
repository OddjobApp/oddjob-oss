/**
 * Spatial Regions
 *
 * A named geographic area, stored the way `spatial-containment.ts` needs to read
 * it: as a compact MIXED-RESOLUTION H3 cell set — coarse through the interior,
 * fine only at the boundary where precision matters.
 *
 * Two things this table deliberately does NOT have, because both would let a
 * caller route around the three-valued containment the platform depends on:
 *
 *   - No centroid or bounding box. A single lat/lng for an area invites
 *     distance-to-centre tests, which cannot express "the measurement is too
 *     coarse to say" and so collapse `indeterminate` back into `outside`. The
 *     cell set is the only authority on where a region is.
 *
 *   - No stored neighbour list. Adjacency is derivable from the cell set with
 *     `gridDisk`, and a denormalized copy would drift the moment a region's
 *     boundary is edited — silently, since nothing recomputes it. Regions that
 *     are adjacent by geometry must stay adjacent by geometry.
 *
 * `minResolution` / `maxResolution` are a cache of the cell set's own range,
 * maintained by the writer. They exist so a query can reject a containment test
 * that the region is too coarse to answer without loading and scanning every
 * cell first; they are never the source of truth for the geometry.
 */

import { pgTable, serial, integer, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { orgs } from "./auth.js";

/** What kind of area this is. Descriptive only — containment is identical for all three. */
export const SPATIAL_REGION_KINDS = ["region", "zone", "corridor"] as const;
export type SpatialRegionKind = (typeof SPATIAL_REGION_KINDS)[number];

export const spatialRegions = pgTable(
    "spatial_regions",
    {
        id: serial("id").primaryKey(),
        organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }),

        name: text("name").notNull(),
        description: text("description"),
        kind: text("kind").notNull().default("region"),

        /**
         * The mixed-resolution H3 cell set, as a JSON array of cell ids. This is the
         * geometry. Passed straight to `containment(position, cells)`.
         */
        cells: jsonb("cells").$type<string[]>().notNull().default([]),

        /** Coarsest and finest resolution present in `cells`. Cache, not authority. */
        minResolution: integer("min_resolution"),
        maxResolution: integer("max_resolution"),

        /**
         * Containment nesting, not a bounding relation: a zone inside a region.
         * ON DELETE SET NULL so removing a parent never deletes the areas inside it.
         */
        parentRegionId: integer("parent_region_id"),

        metadata: jsonb("metadata").default({}),
        createdBy: text("created_by").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
        deletedAt: timestamp("deleted_at", { withTimezone: true }),
    },
    (table) => ({
        orgIdx: index("idx_spatial_regions_org").on(table.organizationId),
        parentIdx: index("idx_spatial_regions_parent").on(table.parentRegionId),
        kindIdx: index("idx_spatial_regions_kind").on(table.kind),
    }),
);

export type SpatialRegion = typeof spatialRegions.$inferSelect;
export type InsertSpatialRegion = typeof spatialRegions.$inferInsert;
