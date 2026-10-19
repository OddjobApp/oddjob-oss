/**
 * Spatial Regions — named areas, and locating a measured position among them.
 *
 * The containment maths already exists in spatial-containment.ts. This service
 * is the durable half: it stores areas as the mixed-resolution cell sets that
 * module consumes, and exposes a lookup that CANNOT quietly lose the third
 * value.
 *
 * That is the whole design constraint here. `locate()` returns `inside` and
 * `indeterminate` as separate lists rather than one list of "matches", because
 * any API shaped as `Region[]` invites `regions.length === 0` to be read as "the
 * asset is outside every region" — which is exactly the false-departure bug
 * spatial-containment.ts was written to make unrepresentable. A caller that
 * wants to fire on absence has to reach for `indeterminate` and decide what to
 * do about it, in the open.
 */

import { latLngToCell, getResolution, isValidCell, gridDisk, cellToParent } from "h3-js";
import { and, eq, isNull, desc, inArray } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { spatialRegions, type SpatialRegion, SPATIAL_REGION_KINDS } from "@shared/schema/spatial-regions.js";
import {
    containment,
    positionAtPrecision,
    resolutionForPrecision,
    type Containment,
} from "./spatial-containment.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SpatialRegionService");

/** Resolution used to place a raw lat/lng before precision reduces it. */
const FINEST_PLACEMENT_RESOLUTION = 15;

export interface SpatialRegionCtx {
    organizationId: number;
    userId?: string;
}

export interface CreateRegionInput {
    name: string;
    description?: string;
    kind?: (typeof SPATIAL_REGION_KINDS)[number];
    /** Mixed-resolution H3 cell set. Coarse interior, fine boundary. */
    cells: string[];
    parentRegionId?: number | null;
    metadata?: Record<string, unknown>;
}

/** A position as measured, not as assumed. `precisionMetres` is required. */
export interface MeasuredPosition {
    lat: number;
    lng: number;
    /**
     * Error radius of the fix, in metres. Null means the precision is unknown,
     * which is NOT the same as precise — it makes the position unplaceable and
     * every region indeterminate. Callers must pass what they actually know.
     */
    precisionMetres: number | null;
}

export interface LocateResult {
    /** Regions the position sits definitively within. */
    inside: SpatialRegion[];
    /**
     * Regions the measurement cannot resolve — the position's cell straddles
     * their boundary, or the fix is too coarse to place at all. These are
     * neither in nor out, and an exclusion rule must not fire on them.
     */
    indeterminate: SpatialRegion[];
    /** The resolution the fix actually supports, or null if unplaceable. */
    placedAtResolution: number | null;
}

export class SpatialRegionService {
    /**
     * Normalize and validate a cell set.
     *
     * Invalid cells are dropped with a warning rather than rejected outright: a
     * region whose boundary was imported from a third-party geometry is common,
     * and losing one malformed cell degrades precision at the edge, while
     * refusing the whole set loses the area entirely. Duplicates are removed —
     * they cost containment scans nothing but are pure noise in storage.
     */
    private normalizeCells(cells: string[]): { cells: string[]; min: number | null; max: number | null } {
        const seen = new Set<string>();
        const valid: string[] = [];
        let min: number | null = null;
        let max: number | null = null;

        for (const cell of cells ?? []) {
            if (typeof cell !== "string" || !cell) continue;
            if (seen.has(cell)) continue;
            if (!isValidCell(cell)) {
                logger.warn(`Dropping invalid H3 cell from region cell set: ${cell}`);
                continue;
            }
            seen.add(cell);
            valid.push(cell);
            const res = getResolution(cell);
            min = min === null ? res : Math.min(min, res);
            max = max === null ? res : Math.max(max, res);
        }

        return { cells: valid, min, max };
    }

    async create(ctx: SpatialRegionCtx, input: CreateRegionInput): Promise<SpatialRegion> {
        const { cells, min, max } = this.normalizeCells(input.cells);
        if (cells.length === 0) {
            throw new Error("A spatial region needs at least one valid H3 cell; none of the supplied cells were valid.");
        }

        const [row] = await db
            .insert(spatialRegions)
            .values({
                organizationId: ctx.organizationId,
                name: input.name,
                description: input.description ?? null,
                kind: input.kind ?? "region",
                cells,
                minResolution: min,
                maxResolution: max,
                parentRegionId: input.parentRegionId ?? null,
                metadata: input.metadata ?? {},
                createdBy: ctx.userId ?? "system",
            })
            .returning();

        logger.info(`Created spatial region '${input.name}' (${cells.length} cells, res ${min}-${max}) for org ${ctx.organizationId}`);
        return row;
    }

    /**
     * Update a region in place.
     *
     * When `cells` is supplied it replaces the set outright rather than merging:
     * a boundary edit removes cells as often as it adds them, and a merge would
     * make deletion impossible. `minResolution`/`maxResolution` are recomputed
     * from the new set — they are a cache of its range, and leaving them stale
     * would let a containment test be rejected (or accepted) on the wrong bound.
     *
     * Editing a region changes every rule that references it. That is the point
     * of storing areas rather than inlining them, but it is worth knowing.
     */
    async update(
        ctx: SpatialRegionCtx,
        id: number,
        input: Partial<Omit<CreateRegionInput, "cells">> & { cells?: string[] },
    ): Promise<SpatialRegion | null> {
        const patch: Record<string, unknown> = { updatedAt: new Date() };

        if (input.cells !== undefined) {
            const { cells, min, max } = this.normalizeCells(input.cells);
            if (cells.length === 0) {
                throw new Error("A spatial region needs at least one valid H3 cell; none of the supplied cells were valid.");
            }
            patch.cells = cells;
            patch.minResolution = min;
            patch.maxResolution = max;
        }
        if (input.name !== undefined) patch.name = input.name;
        if (input.description !== undefined) patch.description = input.description;
        if (input.kind !== undefined) patch.kind = input.kind;
        if (input.parentRegionId !== undefined) patch.parentRegionId = input.parentRegionId;
        if (input.metadata !== undefined) patch.metadata = input.metadata;

        const [row] = await db
            .update(spatialRegions)
            .set(patch)
            .where(and(
                eq(spatialRegions.organizationId, ctx.organizationId),
                eq(spatialRegions.id, id),
                isNull(spatialRegions.deletedAt),
            ))
            .returning();

        return row ?? null;
    }

    async list(ctx: SpatialRegionCtx, limit = 100): Promise<SpatialRegion[]> {
        return db
            .select()
            .from(spatialRegions)
            .where(and(eq(spatialRegions.organizationId, ctx.organizationId), isNull(spatialRegions.deletedAt)))
            .orderBy(desc(spatialRegions.createdAt))
            .limit(Math.min(Math.max(1, limit), 500));
    }

    async get(ctx: SpatialRegionCtx, id: number): Promise<SpatialRegion | null> {
        const rows = await db
            .select()
            .from(spatialRegions)
            .where(and(
                eq(spatialRegions.organizationId, ctx.organizationId),
                isNull(spatialRegions.deletedAt),
                eq(spatialRegions.id, id),
            ))
            .limit(1);
        return rows[0] ?? null;
    }

    /**
     * Where is this position, among this org's regions?
     *
     * Note what is absent from the return: an `outside` list. Regions the
     * position is definitively outside of are simply not mentioned, because
     * enumerating them encourages the caller to treat "not in the inside list"
     * as outside — which is only true if the indeterminate list is empty, and
     * the type gives no way to forget that.
     */
    async locate(ctx: SpatialRegionCtx, position: MeasuredPosition): Promise<LocateResult> {
        const regions = await this.list(ctx, 500);
        return this.locateAmong(regions, position);
    }

    /** `locate` against an already-loaded region set, for callers batching lookups. */
    locateAmong(regions: SpatialRegion[], position: MeasuredPosition): LocateResult {
        const placedAtResolution = resolutionForPrecision(position.precisionMetres);

        // An unplaceable fix is indeterminate against EVERY region. It is not
        // "outside all of them", and it is not an empty result either — an empty
        // result would read as "checked, found nothing".
        if (placedAtResolution === null) {
            return { inside: [], indeterminate: [...regions], placedAtResolution: null };
        }

        const fineCell = latLngToCell(position.lat, position.lng, FINEST_PLACEMENT_RESOLUTION);
        const placed = positionAtPrecision(fineCell, position.precisionMetres);
        if (!placed) {
            return { inside: [], indeterminate: [...regions], placedAtResolution: null };
        }

        const inside: SpatialRegion[] = [];
        const indeterminate: SpatialRegion[] = [];

        for (const region of regions) {
            const cells = Array.isArray(region.cells) ? region.cells : [];
            const result: Containment = containment(placed, cells);
            if (result === "inside") inside.push(region);
            else if (result === "indeterminate") indeterminate.push(region);
            // "outside" is intentionally not collected — see the doc comment.
        }

        return { inside, indeterminate, placedAtResolution: placed.resolution };
    }

    /**
     * Regions adjacent to this one, computed from geometry rather than stored.
     *
     * The ring is taken at the region's COARSEST resolution. Taking it at the
     * finest would walk one small step out from a boundary cell and miss a
     * neighbour that only touches the coarse interior, reporting regions as
     * non-adjacent because of how finely their shared edge happens to be drawn.
     */
    async neighbours(ctx: SpatialRegionCtx, regionId: number, rings = 1): Promise<SpatialRegion[]> {
        const region = await this.get(ctx, regionId);
        if (!region) return [];

        const cells = Array.isArray(region.cells) ? region.cells : [];
        if (cells.length === 0) return [];

        const coarsest = region.minResolution ?? Math.min(...cells.map(getResolution));

        // Every cell reduced to the coarsest resolution present, so the ring is
        // taken in one consistent grid.
        const toCoarsest = (cell: string): string | null => {
            try {
                const res = getResolution(cell);
                return res <= coarsest ? cell : cellToParent(cell, coarsest);
            } catch {
                return null;
            }
        };

        const own = new Set<string>();
        const halo = new Set<string>();
        for (const cell of cells) {
            const atCoarsest = toCoarsest(cell);
            if (!atCoarsest) continue;
            own.add(atCoarsest);
            for (const ringCell of gridDisk(atCoarsest, Math.max(1, rings))) halo.add(ringCell);
        }
        // The disk includes the centre; the halo is only what lies beyond this region.
        for (const cell of own) halo.delete(cell);

        if (halo.size === 0) return [];

        const others = (await this.list(ctx, 500)).filter((r) => r.id !== regionId);
        return others.filter((other) => {
            const otherCells = Array.isArray(other.cells) ? other.cells : [];
            return otherCells.some((c) => {
                const atCoarsest = toCoarsest(c);
                return atCoarsest !== null && halo.has(atCoarsest);
            });
        });
    }

    /** Soft-delete. Regions are referenced by rules and history; hard deletion would orphan them. */
    async softDelete(ctx: SpatialRegionCtx, id: number): Promise<boolean> {
        const result = await db
            .update(spatialRegions)
            .set({ deletedAt: new Date(), updatedAt: new Date() })
            .where(and(
                eq(spatialRegions.organizationId, ctx.organizationId),
                eq(spatialRegions.id, id),
                isNull(spatialRegions.deletedAt),
            ))
            .returning({ id: spatialRegions.id });
        return result.length > 0;
    }

    /** Load several regions by id within an org, for batch containment work. */
    async getMany(ctx: SpatialRegionCtx, ids: number[]): Promise<SpatialRegion[]> {
        if (ids.length === 0) return [];
        return db
            .select()
            .from(spatialRegions)
            .where(and(
                eq(spatialRegions.organizationId, ctx.organizationId),
                isNull(spatialRegions.deletedAt),
                inArray(spatialRegions.id, ids),
            ));
    }
}

export const spatialRegionService = new SpatialRegionService();
