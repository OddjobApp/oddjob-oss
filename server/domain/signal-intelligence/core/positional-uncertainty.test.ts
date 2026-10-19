import { describe, it, expect } from "vitest";
import {
    fromRadius,
    eigenDecompose2x2,
    confidenceScale,
    ellipseAxes,
    errorEllipsePolygon,
    assessContainment,
    refineWithUncertainty,
    fromHdop,
    fromEllipse,
    horizontalDopFromPdop,
} from "./positional-uncertainty.js";

describe("eigenDecompose2x2", () => {
    it("treats an isotropic covariance as a circle", () => {
        const { lambda1, lambda2 } = eigenDecompose2x2(fromRadius(100));
        expect(lambda1).toBeCloseTo(10_000, 6);
        expect(lambda2).toBeCloseTo(10_000, 6);
    });

    it("recovers the axes of an axis-aligned ellipse", () => {
        // 2 km along east, 50 m along north.
        const { lambda1, lambda2, angleRad } = eigenDecompose2x2({ xx: 2000 ** 2, yy: 50 ** 2, xy: 0 });
        expect(Math.sqrt(lambda1)).toBeCloseTo(2000, 3);
        expect(Math.sqrt(lambda2)).toBeCloseTo(50, 3);
        expect(angleRad).toBeCloseTo(0, 6); // major axis points east
    });

    it("orients the major axis north when north is the larger variance", () => {
        const { angleRad } = eigenDecompose2x2({ xx: 50 ** 2, yy: 2000 ** 2, xy: 0 });
        expect(Math.abs(angleRad)).toBeCloseTo(Math.PI / 2, 6);
    });

    it("recovers a rotated ellipse", () => {
        // Equal variances with correlation → principal axes at 45°.
        const { lambda1, lambda2, angleRad } = eigenDecompose2x2({ xx: 100, yy: 100, xy: 50 });
        expect(lambda1).toBeCloseTo(150, 6);
        expect(lambda2).toBeCloseTo(50, 6);
        expect(Math.abs(angleRad)).toBeCloseTo(Math.PI / 4, 6);
    });

    it("keeps eigenvalues ordered and non-negative", () => {
        const { lambda1, lambda2 } = eigenDecompose2x2({ xx: 1, yy: 9, xy: 2 });
        expect(lambda1).toBeGreaterThanOrEqual(lambda2);
        expect(lambda2).toBeGreaterThanOrEqual(0);
    });

    it("does not produce NaN for a degenerate matrix", () => {
        const { lambda1, lambda2 } = eigenDecompose2x2({ xx: 0, yy: 0, xy: 0 });
        expect(Number.isNaN(lambda1)).toBe(false);
        expect(Number.isNaN(lambda2)).toBe(false);
    });
});

describe("fromHdop", () => {
    it("turns a geometry figure into a distance via UERE", () => {
        // horizontal error ≈ HDOP × UERE
        const cov = fromHdop(2, 4);
        expect(Math.sqrt(cov.xx)).toBeCloseTo(8, 6);
        expect(Math.sqrt(cov.yy)).toBeCloseTo(8, 6);
    });

    it("is isotropic — HDOP alone cannot express orientation", () => {
        // A single number yields a circle. Recovering an ellipse needs the
        // off-diagonal DOP terms, which NMEA GGA does not carry.
        const cov = fromHdop(5);
        expect(cov.xy).toBe(0);
        expect(cov.xx).toBeCloseTo(cov.yy, 9);
    });

    it("degrades monotonically as HDOP worsens", () => {
        expect(fromHdop(20).xx).toBeGreaterThan(fromHdop(1).xx);
    });

    it("rejects a non-positive HDOP", () => {
        expect(() => fromHdop(0)).toThrow(RangeError);
        expect(() => fromHdop(-3)).toThrow(RangeError);
        expect(() => fromHdop(NaN)).toThrow(RangeError);
    });

    it("puts an excellent fix inside a few metres and a poor one outside 50", () => {
        expect(Math.sqrt(fromHdop(1).xx)).toBeLessThan(10);
        expect(Math.sqrt(fromHdop(20).xx)).toBeGreaterThan(50);
    });
});

describe("horizontalDopFromPdop", () => {
    it("recovers HDOP from the Pythagorean relation", () => {
        // PDOP² = HDOP² + VDOP²  →  3-4-5
        expect(horizontalDopFromPdop(5, 4)).toBeCloseTo(3, 9);
    });

    it("shows PDOP always overstates horizontal error", () => {
        // VDOP is systematically worse than HDOP, so using PDOP directly
        // inflates the ellipse with error that cannot affect a 2-D answer.
        const pdop = 5, vdop = 4;
        const hdop = horizontalDopFromPdop(pdop, vdop);
        expect(hdop).toBeLessThan(pdop);
        expect(Math.sqrt(fromHdop(hdop).xx)).toBeLessThan(Math.sqrt(fromHdop(pdop).xx));
    });

    it("rejects inconsistent inputs rather than returning NaN", () => {
        // Would otherwise sqrt a negative — most likely a swapped pair.
        expect(() => horizontalDopFromPdop(2, 5)).toThrow(RangeError);
        expect(() => horizontalDopFromPdop(3, 3)).toThrow(RangeError);
    });

    it("rejects non-positive or non-finite inputs", () => {
        expect(() => horizontalDopFromPdop(0, 1)).toThrow(RangeError);
        expect(() => horizontalDopFromPdop(NaN, 1)).toThrow(RangeError);
        expect(() => horizontalDopFromPdop(5, -1)).toThrow(RangeError);
    });
});

describe("fromEllipse", () => {
    it("round-trips a north-oriented ellipse", () => {
        // Major axis due north (0°) → larger variance on the north axis.
        const cov = fromEllipse(1000, 100, 0);
        expect(cov.yy).toBeGreaterThan(cov.xx);
        const { lambda1, lambda2 } = eigenDecompose2x2(cov);
        expect(Math.sqrt(lambda1)).toBeCloseTo(1000, 3);
        expect(Math.sqrt(lambda2)).toBeCloseTo(100, 3);
    });

    it("round-trips an east-oriented ellipse", () => {
        // 90° from north is due east → larger variance on the east axis.
        const cov = fromEllipse(1000, 100, 90);
        expect(cov.xx).toBeGreaterThan(cov.yy);
    });

    it("preserves the axis lengths under rotation", () => {
        // Bearing convention errors rotate the ellipse silently, so assert the
        // eigenvalues survive an awkward angle.
        const { lambda1, lambda2 } = eigenDecompose2x2(fromEllipse(500, 120, 37));
        expect(Math.sqrt(lambda1)).toBeCloseTo(500, 3);
        expect(Math.sqrt(lambda2)).toBeCloseTo(120, 3);
    });

    it("is a circle when the axes are equal", () => {
        const cov = fromEllipse(200, 200, 45);
        expect(cov.xy).toBeCloseTo(0, 6);
        expect(cov.xx).toBeCloseTo(cov.yy, 6);
    });
});

describe("confidence scaling", () => {
    it("matches the chi-square(2) 95% factor", () => {
        expect(confidenceScale(0.95)).toBeCloseTo(2.4477, 3);
    });

    it("grows with confidence", () => {
        expect(confidenceScale(0.99)).toBeGreaterThan(confidenceScale(0.95));
    });

    it("rejects a confidence outside (0,1)", () => {
        expect(() => confidenceScale(0)).toThrow(RangeError);
        expect(() => confidenceScale(1)).toThrow(RangeError);
    });

    it("scales the semi-axes of an anisotropic fix independently", () => {
        const { semiMajorM, semiMinorM } = ellipseAxes({ xx: 2000 ** 2, yy: 50 ** 2, xy: 0 }, 0.95);
        // This is the whole point: a scalar would have to call this a 2 km fix
        // in every direction, when across the minor axis it is ~120 m.
        expect(semiMajorM).toBeCloseTo(2000 * 2.4477, 0);
        expect(semiMinorM).toBeCloseTo(50 * 2.4477, 0);
    });
});

describe("errorEllipsePolygon", () => {
    it("returns the requested number of [lat,lng] vertices", () => {
        const poly = errorEllipsePolygon(37.7749, -122.4194, fromRadius(100), 0.95, 16);
        expect(poly).toHaveLength(16);
        for (const [lat, lng] of poly) {
            expect(Number.isFinite(lat)).toBe(true);
            expect(Number.isFinite(lng)).toBe(true);
        }
    });

    it("stays near the centre for a precise fix and spreads for a vague one", () => {
        const tight = errorEllipsePolygon(0, 0, fromRadius(10), 0.95, 8);
        const loose = errorEllipsePolygon(0, 0, fromRadius(10_000), 0.95, 8);
        const spread = (p: Array<[number, number]>) => Math.max(...p.map(([lat]) => Math.abs(lat)));
        expect(spread(loose)).toBeGreaterThan(spread(tight));
    });

    it("is elongated along the major axis", () => {
        // Large east variance, tiny north variance → wide in lng, narrow in lat.
        const poly = errorEllipsePolygon(0, 0, { xx: 5000 ** 2, yy: 10 ** 2, xy: 0 }, 0.95, 64);
        const latSpread = Math.max(...poly.map(([lat]) => Math.abs(lat)));
        const lngSpread = Math.max(...poly.map(([, lng]) => Math.abs(lng)));
        expect(lngSpread).toBeGreaterThan(latSpread * 10);
    });

    it("does not blow up near the pole", () => {
        const poly = errorEllipsePolygon(89.999, 0, fromRadius(1000), 0.95, 8);
        for (const [lat, lng] of poly) {
            expect(Number.isFinite(lat)).toBe(true);
            expect(Number.isFinite(lng)).toBe(true);
        }
    });
});

describe("assessContainment", () => {
    const zone = new Set(["a", "b", "c", "d"]);

    it("is inside when the uncertainty region lies wholly within the zone", () => {
        const r = assessContainment(["a", "b"], zone);
        expect(r.verdict).toBe("inside");
        expect(r.probability).toBe(1);
    });

    it("is outside when the region shares nothing with the zone", () => {
        const r = assessContainment(["x", "y"], zone);
        expect(r.verdict).toBe("outside");
        expect(r.probability).toBe(0);
    });

    it("is indeterminate on a straddled boundary", () => {
        const r = assessContainment(["a", "x"], zone);
        expect(r.verdict).toBe("indeterminate");
        expect(r.probability).toBeCloseTo(0.5, 6);
    });

    it("treats an empty region as indeterminate, never outside", () => {
        const r = assessContainment([], zone);
        expect(r.verdict).toBe("indeterminate");
    });
});

describe("refineWithUncertainty — the layering contract", () => {
    const definite = { verdict: "outside" as const, probability: 0 };

    it("lets the secondary layer resolve an indeterminate primary", () => {
        // The gain: the scalar gate reasons from the worst-case axis, so it
        // gives up on fixes the oriented ellipse can actually resolve.
        const r = refineWithUncertainty("indeterminate", { verdict: "inside", probability: 0.97 });
        expect(r.verdict).toBe("inside");
    });

    it("never lets the secondary layer overturn a definitive primary", () => {
        const r = refineWithUncertainty("inside", definite);
        // A modelled ellipse must not contradict a measured position.
        expect(r.verdict).toBe("inside");
    });

    it("never lets it overturn a definitive outside either", () => {
        const r = refineWithUncertainty("outside", { verdict: "inside", probability: 0.99 });
        expect(r.verdict).toBe("outside");
    });

    it("stays indeterminate when no covariance is available", () => {
        const r = refineWithUncertainty("indeterminate", null);
        expect(r.verdict).toBe("indeterminate");
    });
});
