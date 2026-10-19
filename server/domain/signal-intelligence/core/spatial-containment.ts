/**
 * Mixed-resolution spatial containment with a three-valued result.
 *
 * THE PROBLEM THIS SOLVES: a containment test that returns a boolean has to
 * report "not inside" when a position is too imprecise to place. Rules that
 * fire on absence — "alert me if the asset LEFT the safe zone" — then fire on
 * assets whose position is merely unknown. Absence of evidence becomes
 * evidence of absence, and someone gets paged about a departure that did not
 * happen.
 *
 * THE FIX IS REPRESENTATIONAL, NOT A GUARD. A position is stored at the H3
 * resolution its measurement precision actually supports: a ±50 km country
 * lookup becomes a coarse cell, an RTK fix a fine one, no fix no cell at all.
 * An area is stored as a compact mixed-resolution cell set — coarse through
 * the interior, fine only at the boundary where precision matters.
 *
 * Containment is then a hierarchy comparison, and `INDETERMINATE` falls out of
 * the geometry rather than being a check someone must remember: you cannot
 * compute "outside" from a cell too coarse to distinguish inside from outside.
 */

import { cellToParent, getResolution, isValidCell } from "h3-js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SpatialContainment");

export type Containment = "inside" | "outside" | "indeterminate";

/**
 * Approximate H3 cell edge lengths (metres) by resolution, used to pick the
 * finest resolution a measurement can honestly support. A position is only
 * meaningful at a resolution whose cells are LARGER than its error radius —
 * below that the cell claims more than the measurement knows.
 */
const RESOLUTION_EDGE_METRES: number[] = [
    1_281_256, 483_057, 182_513, 68_979, 26_072, 9_854, 3_724, 1_406,
    531, 201, 75.9, 28.7, 10.8, 4.1, 1.5, 0.6,
];

export const MAX_RESOLUTION = 15;

/**
 * Finest resolution that does not overstate a measurement.
 *
 * Returns null when precision is unknown or too poor for any resolution —
 * meaning "we cannot place this at all", which callers must treat as
 * indeterminate rather than as a position at resolution 0.
 */
export function resolutionForPrecision(precisionMetres: number | null | undefined): number | null {
    if (precisionMetres == null || !Number.isFinite(precisionMetres) || precisionMetres < 0) return null;

    // Walk fine → coarse and take the first cell bigger than the error radius.
    for (let res = MAX_RESOLUTION; res >= 0; res--) {
        if (RESOLUTION_EDGE_METRES[res] >= precisionMetres) return res;
    }
    return null;
}

/** A measured position, already reduced to the resolution its precision supports. */
export interface PositionCell {
    cell: string;
    resolution: number;
}

/**
 * Reduce a fine-grained cell to the resolution a measurement supports.
 * Returns null when the measurement cannot be placed at all.
 */
export function positionAtPrecision(
    fineCell: string,
    precisionMetres: number | null | undefined,
): PositionCell | null {
    if (!fineCell || !isValidCell(fineCell)) return null;

    const target = resolutionForPrecision(precisionMetres);
    if (target === null) return null;

    const current = getResolution(fineCell);
    // Never refine upward: a coarse measurement cannot be made precise by
    // asking for a finer cell.
    const resolution = Math.min(target, current);

    try {
        return { cell: cellToParent(fineCell, resolution), resolution };
    } catch (err: any) {
        logger.warn(`Could not reduce ${fineCell} to res ${resolution}: ${err?.message ?? err}`);
        return null;
    }
}

/**
 * Three-valued containment of a position within a mixed-resolution cell set.
 *
 * - `inside`        — the position's cell sits wholly within an area cell.
 * - `outside`       — no area cell shares any ancestry with it.
 * - `indeterminate` — the position's cell is COARSER than area cells it
 *                     overlaps, so it straddles the boundary. The asset may be
 *                     in or out; the measurement cannot say. Also returned for
 *                     an unplaceable position.
 *
 * `inside` wins over `indeterminate`: a position wholly inside a coarse
 * interior cell is definitively inside, whatever the boundary cells do.
 */
export function containment(
    position: PositionCell | null,
    areaCells: Iterable<string>,
): Containment {
    // No usable position is not the same as being outside.
    if (!position) return "indeterminate";

    let straddles = false;

    for (const areaCell of areaCells) {
        if (!areaCell) continue;
        let areaRes: number;
        try {
            areaRes = getResolution(areaCell);
        } catch {
            continue;
        }

        if (areaRes <= position.resolution) {
            // Area cell is coarser or equal: is the position within it?
            let ancestor: string;
            try {
                ancestor = cellToParent(position.cell, areaRes);
            } catch {
                continue;
            }
            if (ancestor === areaCell) return "inside";
        } else {
            // Area cell is FINER than the position: the position's cell
            // contains part of the area, so it overlaps the boundary without
            // resolving which side the true location falls on.
            let areaAncestor: string;
            try {
                areaAncestor = cellToParent(areaCell, position.resolution);
            } catch {
                continue;
            }
            if (areaAncestor === position.cell) straddles = true;
        }
    }

    if (straddles) return "indeterminate";
    return "outside";
}

/**
 * Explicit helper for exclusion rules ("alert if NOT in the zone").
 *
 * Exists to keep callers from writing `if (!isInside(...))`, which silently
 * folds `indeterminate` back into `outside` and reinstates the false-alert
 * bug at the call site. Only a definitive `outside` may fire an exclusion.
 */
export function isDefinitelyOutside(result: Containment): boolean {
    return result === "outside";
}

/** Only a definitive `inside` may satisfy an inclusion rule. */
export function isDefinitelyInside(result: Containment): boolean {
    return result === "inside";
}
