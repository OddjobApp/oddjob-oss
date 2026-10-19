/**
 * Positional uncertainty as a 2-D Gaussian.
 *
 * STATUS: capability in waiting. Nothing currently produces a covariance —
 * `SpatialObservation` carries only a scalar `spatialPrecisionM`, and no
 * source in the codebase supplies HDOP/PDOP or an error ellipse. This module
 * is therefore pure math with no wiring, and it degrades exactly to today's
 * behaviour for scalar inputs (a radius is Σ = σ²I, the isotropic case).
 *
 * It deliberately does NOT introduce a second precision gate.
 * `spatialPredicateEngine.precisionGate` already rejects fixes too coarse to
 * evaluate, and is well calibrated (it scales tolerance with zone extent).
 * Adding a competing gate would repeat a duplication pattern this codebase has
 * suffered from repeatedly. What this offers instead is a richer
 * REPRESENTATION the existing gate could consume if covariance ever arrives.
 *
 * WHY A SCALAR IS LOSSY: real GNSS error is an ellipse, not a circle —
 * satellite geometry makes you far more certain along one axis than another.
 * Collapsing that to one number forces the worst case (√λ_max), so a fix that
 * is ±2 km along-track but ±50 m cross-track is treated as a 2 km fix even
 * when the boundary in question runs across the precise axis.
 */

/** Symmetric 2×2 covariance in metres², in a local east/north frame. */
export interface Covariance2D {
    /** Variance along east (x). */
    xx: number;
    /** Variance along north (y). */
    yy: number;
    /** Covariance between the two axes; 0 for an axis-aligned ellipse. */
    xy: number;
}

export interface Eigen2D {
    /** Larger eigenvalue — variance along the semi-major axis. */
    lambda1: number;
    /** Smaller eigenvalue — variance along the semi-minor axis. */
    lambda2: number;
    /** Orientation of the major axis, radians counter-clockwise from east. */
    angleRad: number;
}

/** A scalar accuracy radius is the isotropic special case, Σ = σ²I. */
export function fromRadius(radiusMetres: number): Covariance2D {
    const variance = radiusMetres * radiusMetres;
    return { xx: variance, yy: variance, xy: 0 };
}

/**
 * Typical User Equivalent Range Error for modern civil GNSS, in metres.
 * Horizontal error ≈ HDOP × UERE, so this is the constant that turns a
 * geometry figure into a distance.
 */
export const DEFAULT_UERE_METRES = 4;

/**
 * Build a covariance from HDOP — the practical ingestion path.
 *
 * HDOP is reported by essentially every receiver (NMEA GGA field 8), which
 * makes it the realistic input where a full covariance is not. It describes
 * satellite GEOMETRY, not distance: horizontal error ≈ HDOP × UERE.
 *
 * It is a single number, so it yields a CIRCLE, not an ellipse — the
 * isotropic case. That is a real limitation, not an oversight: recovering
 * orientation needs the off-diagonal DOP terms, which GGA does not carry.
 * Receivers emitting NMEA **GST** do report the error ellipse directly
 * (semi-major, semi-minor, orientation) and should use `fromEllipse` instead.
 *
 * Rough quality bands: <1 ideal · 1–2 excellent · 2–5 good · 5–10 moderate ·
 * 10–20 fair · >20 poor.
 */
export function fromHdop(hdop: number, uereMetres: number = DEFAULT_UERE_METRES): Covariance2D {
    if (!Number.isFinite(hdop) || hdop <= 0) {
        throw new RangeError(`hdop must be a positive number, got ${hdop}`);
    }
    return fromRadius(hdop * uereMetres);
}

/**
 * Derive HDOP from PDOP and VDOP.
 *
 * USE HDOP, NOT PDOP. H3 containment is a two-dimensional question — hexagons
 * on a sphere, no altitude — so vertical error is irrelevant to it. PDOP folds
 * VDOP in:
 *
 *     PDOP² = HDOP² + VDOP²
 *
 * and VDOP is systematically worse than HDOP (every satellite is above the
 * receiver, so vertical geometry is poor — commonly 1.5–2× HDOP). Passing PDOP
 * where HDOP is meant therefore inflates the error ellipse with error that
 * cannot affect the answer, pushing otherwise decidable fixes into
 * `indeterminate`.
 *
 * Nothing in `fromHdop`'s signature can detect that mistake — both are just
 * positive numbers — so this exists to make the conversion explicit for
 * receivers that report PDOP/VDOP but not HDOP directly.
 */
export function horizontalDopFromPdop(pdop: number, vdop: number): number {
    if (!Number.isFinite(pdop) || pdop <= 0) {
        throw new RangeError(`pdop must be a positive number, got ${pdop}`);
    }
    if (!Number.isFinite(vdop) || vdop < 0) {
        throw new RangeError(`vdop must be a non-negative number, got ${vdop}`);
    }
    const squared = pdop * pdop - vdop * vdop;
    if (squared <= 0) {
        // PDOP can never be smaller than VDOP; if it is, the inputs are
        // inconsistent (mismatched sentences, or a swapped pair).
        throw new RangeError(
            `Inconsistent DOP: pdop (${pdop}) must exceed vdop (${vdop}) — check the fields are not swapped.`,
        );
    }
    return Math.sqrt(squared);
}

/**
 * Build a covariance from a reported error ellipse (NMEA GST, or a Kalman
 * filter's output): 1σ semi-axes in metres plus the major axis orientation in
 * degrees clockwise from true north.
 *
 * Converts the bearing convention to the east/north frame this module works
 * in — north-clockwise and east-counter-clockwise differ, and getting that
 * wrong rotates every ellipse by the wrong sense without any error surfacing.
 */
export function fromEllipse(
    semiMajorM: number,
    semiMinorM: number,
    orientationDegFromNorth: number,
): Covariance2D {
    const angleRad = ((90 - orientationDegFromNorth) * Math.PI) / 180;
    const a = semiMajorM * semiMajorM;
    const b = semiMinorM * semiMinorM;
    const c = Math.cos(angleRad);
    const s = Math.sin(angleRad);

    return {
        xx: a * c * c + b * s * s,
        yy: a * s * s + b * c * c,
        xy: (a - b) * c * s,
    };
}

/**
 * Closed-form eigendecomposition of a symmetric 2×2 matrix.
 *
 * Done directly rather than via a linear-algebra dependency: for 2×2 symmetric
 * input the roots of the characteristic polynomial are exact, and the guard
 * below (clamping a negative discriminant that can only arise from floating
 * point) is the only numerical subtlety.
 */
export function eigenDecompose2x2(cov: Covariance2D): Eigen2D {
    const { xx, yy, xy } = cov;

    const trace = xx + yy;
    // For a genuine covariance matrix this is non-negative; a tiny negative
    // value can only come from rounding, so clamp rather than produce NaN.
    const disc = Math.max(0, (xx - yy) * (xx - yy) / 4 + xy * xy);
    const root = Math.sqrt(disc);

    const lambda1 = trace / 2 + root;
    const lambda2 = trace / 2 - root;

    // Axis-aligned: no rotation to recover, and the eigenvector formula below
    // degenerates. Major axis follows whichever variance is larger.
    let angleRad: number;
    if (Math.abs(xy) < 1e-12) {
        angleRad = xx >= yy ? 0 : Math.PI / 2;
    } else {
        angleRad = Math.atan2(lambda1 - xx, xy);
    }

    return { lambda1, lambda2: Math.max(0, lambda2), angleRad };
}

/**
 * Scale factor for a confidence region of a 2-D Gaussian.
 *
 * From the chi-square distribution with 2 degrees of freedom:
 * k = sqrt(-2 ln(1 - p)). At p = 0.95 this is ≈ 2.4477.
 */
export function confidenceScale(confidence: number): number {
    if (!(confidence > 0 && confidence < 1)) {
        throw new RangeError(`confidence must be in (0,1), got ${confidence}`);
    }
    return Math.sqrt(-2 * Math.log(1 - confidence));
}

/** Semi-axis lengths in metres for a confidence ellipse. */
export function ellipseAxes(cov: Covariance2D, confidence = 0.95): { semiMajorM: number; semiMinorM: number; angleRad: number } {
    const { lambda1, lambda2, angleRad } = eigenDecompose2x2(cov);
    const k = confidenceScale(confidence);
    return {
        semiMajorM: k * Math.sqrt(lambda1),
        semiMinorM: k * Math.sqrt(lambda2),
        angleRad,
    };
}

const METRES_PER_DEGREE_LAT = 111_320;

/**
 * Approximate the confidence ellipse as a lat/lng polygon.
 *
 * Returned as [lat, lng] pairs, the order `h3-js` `polygonToCells` expects, so
 * a caller can convert straight to a cell set and compare it with a zone.
 *
 * Uses a local flat-earth approximation, which is accurate for the error
 * magnitudes involved (metres to a few km) but not near the poles, where the
 * longitude scale collapses.
 */
export function errorEllipsePolygon(
    centreLat: number,
    centreLng: number,
    cov: Covariance2D,
    confidence = 0.95,
    segments = 32,
): Array<[number, number]> {
    const { semiMajorM, semiMinorM, angleRad } = ellipseAxes(cov, confidence);

    const cosLat = Math.cos((centreLat * Math.PI) / 180);
    // Guard the pole: longitude degrees per metre diverges as cos(lat) → 0.
    const metresPerDegreeLng = Math.max(1, METRES_PER_DEGREE_LAT * cosLat);

    const points: Array<[number, number]> = [];
    for (let i = 0; i < segments; i++) {
        const t = (2 * Math.PI * i) / segments;
        // Point on the unrotated ellipse, then rotated into the eigenbasis.
        const ex = semiMajorM * Math.cos(t);
        const ey = semiMinorM * Math.sin(t);
        const x = ex * Math.cos(angleRad) - ey * Math.sin(angleRad);
        const y = ex * Math.sin(angleRad) + ey * Math.cos(angleRad);

        points.push([
            centreLat + y / METRES_PER_DEGREE_LAT,
            centreLng + x / metresPerDegreeLng,
        ]);
    }
    return points;
}

export type ContainmentVerdict = "inside" | "outside" | "indeterminate";

export interface ContainmentAssessment {
    verdict: ContainmentVerdict;
    /** Fraction of the confidence region's cells that fall within the zone. */
    probability: number;
}

/**
 * Assess containment of an uncertainty region within a zone, by comparing cell
 * sets. The overlap fraction stands in for integrating the Gaussian over the
 * zone — no closed form exists for a hexagon union, and the cell
 * approximation is what the engine already works in.
 *
 * Replaces an arbitrary tolerance constant with a stated confidence level: a
 * verdict is only definitive when the overlap clears `threshold`.
 */
export function assessContainment(
    uncertaintyCells: Iterable<string>,
    zoneCells: Set<string>,
    threshold = 0.95,
): ContainmentAssessment {
    const cells = [...uncertaintyCells];
    if (cells.length === 0) {
        // Nothing to test: unknown, and emphatically not "outside".
        return { verdict: "indeterminate", probability: 0 };
    }

    let hits = 0;
    for (const cell of cells) if (zoneCells.has(cell)) hits++;

    const probability = hits / cells.length;
    if (probability >= threshold) return { verdict: "inside", probability };
    if (1 - probability >= threshold) return { verdict: "outside", probability };
    return { verdict: "indeterminate", probability };
}

/**
 * Compose this as a SECONDARY layer over the existing scalar precision gate.
 *
 * The primary gate is authoritative and always runs; it works with the scalar
 * data every source provides. This layer engages only where a covariance
 * exists, and is permitted to do exactly one thing: turn an `indeterminate`
 * into a definitive verdict.
 *
 * WHY ONLY THAT DIRECTION. The scalar gate necessarily reasons from the worst
 * case (√λ_max), so it calls a fix "too coarse" whenever the LONG axis of the
 * error ellipse is too long — even when the boundary in question runs across
 * the short axis, where the fix is precise. The Gaussian layer knows the
 * orientation and can legitimately resolve those cases. That is strictly more
 * information, so it is safe.
 *
 * The reverse is not. Allowing this layer to overturn a definitive primary
 * verdict would let a modelled ellipse contradict a measured position, and a
 * wrong "outside" is the failure that pages someone about a departure that
 * never happened. A definitive primary always stands.
 */
export function refineWithUncertainty(
    primary: ContainmentVerdict,
    secondary: ContainmentAssessment | null,
): ContainmentAssessment {
    // Primary was conclusive — the secondary layer has no authority to disagree.
    if (primary !== "indeterminate") {
        return { verdict: primary, probability: primary === "inside" ? 1 : 0 };
    }
    // No covariance available; stay unknown rather than guessing.
    if (!secondary) return { verdict: "indeterminate", probability: 0 };

    return secondary;
}
