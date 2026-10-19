import { describe, it, expect } from "vitest";
import { latLngToCell, cellToParent, getResolution } from "h3-js";
import {
    resolutionForPrecision,
    positionAtPrecision,
    containment,
    isDefinitelyInside,
    isDefinitelyOutside,
} from "./spatial-containment.js";

// A point in San Francisco and one in London — unambiguously far apart.
const SF = { lat: 37.7749, lng: -122.4194 };
const LONDON = { lat: 51.5074, lng: -0.1278 };

describe("resolutionForPrecision", () => {
    it("gives a fine resolution to a precise fix", () => {
        const res = resolutionForPrecision(5);
        expect(res).not.toBeNull();
        expect(res!).toBeGreaterThanOrEqual(12);
    });

    it("gives a coarse resolution to a country-level guess", () => {
        const res = resolutionForPrecision(50_000);
        expect(res).not.toBeNull();
        // ~50 km of error cannot justify anything near street level.
        expect(res!).toBeLessThanOrEqual(5);
    });

    it("is monotonic — worse precision never yields a finer resolution", () => {
        const precise = resolutionForPrecision(10)!;
        const vague = resolutionForPrecision(10_000)!;
        expect(vague).toBeLessThan(precise);
    });

    it("returns null for unknown precision", () => {
        expect(resolutionForPrecision(null)).toBeNull();
        expect(resolutionForPrecision(undefined)).toBeNull();
        expect(resolutionForPrecision(NaN)).toBeNull();
    });

    it("returns null when precision is too poor for any resolution", () => {
        // Larger than the coarsest cell — the position is not placeable.
        expect(resolutionForPrecision(50_000_000)).toBeNull();
    });
});

describe("positionAtPrecision", () => {
    it("reduces a fine cell to what the measurement supports", () => {
        const fine = latLngToCell(SF.lat, SF.lng, 13);
        const placed = positionAtPrecision(fine, 5_000);
        expect(placed).not.toBeNull();
        // A 5 km error radius must not retain res-13 precision.
        expect(placed!.resolution).toBeLessThan(13);
        expect(getResolution(placed!.cell)).toBe(placed!.resolution);
    });

    it("never refines a coarse cell upward", () => {
        const coarse = latLngToCell(SF.lat, SF.lng, 4);
        const placed = positionAtPrecision(coarse, 1);
        // Excellent claimed precision cannot manufacture detail that is absent.
        expect(placed!.resolution).toBe(4);
    });

    it("returns null when precision is unknown", () => {
        const fine = latLngToCell(SF.lat, SF.lng, 12);
        expect(positionAtPrecision(fine, null)).toBeNull();
    });

    it("returns null for an invalid cell", () => {
        expect(positionAtPrecision("not-a-cell", 10)).toBeNull();
    });
});

describe("containment", () => {
    it("reports inside when the position sits within a coarse area cell", () => {
        const area = [latLngToCell(SF.lat, SF.lng, 5)];
        const pos = positionAtPrecision(latLngToCell(SF.lat, SF.lng, 12), 10)!;
        expect(containment(pos, area)).toBe("inside");
    });

    it("reports outside when nothing shares ancestry", () => {
        const area = [latLngToCell(SF.lat, SF.lng, 5)];
        const pos = positionAtPrecision(latLngToCell(LONDON.lat, LONDON.lng, 12), 10)!;
        expect(containment(pos, area)).toBe("outside");
    });

    it("reports INDETERMINATE when the position is coarser than the boundary", () => {
        // Area described at fine resolution; position known only coarsely, so
        // its cell straddles the boundary and cannot resolve which side.
        const fineArea = [latLngToCell(SF.lat, SF.lng, 11)];
        const coarsePos = positionAtPrecision(latLngToCell(SF.lat, SF.lng, 11), 20_000)!;

        const result = containment(coarsePos, fineArea);
        expect(result).toBe("indeterminate");
        // The bug this exists to prevent: it must NOT read as outside.
        expect(isDefinitelyOutside(result)).toBe(false);
    });

    it("treats an unplaceable position as indeterminate, not outside", () => {
        const area = [latLngToCell(SF.lat, SF.lng, 5)];
        expect(containment(null, area)).toBe("indeterminate");
        expect(isDefinitelyOutside(containment(null, area))).toBe(false);
    });

    it("lets inside win over a straddled boundary cell", () => {
        // A coarse interior cell containing the position, plus a fine boundary
        // cell it straddles. Being wholly within the interior is definitive.
        const interior = latLngToCell(SF.lat, SF.lng, 5);
        const pos = positionAtPrecision(latLngToCell(SF.lat, SF.lng, 9), 300)!;
        const boundary = latLngToCell(SF.lat, SF.lng, 13);

        expect(containment(pos, [boundary, interior])).toBe("inside");
    });

    it("handles a genuinely mixed-resolution area set", () => {
        const pos = positionAtPrecision(latLngToCell(SF.lat, SF.lng, 12), 10)!;
        const mixed = [
            latLngToCell(LONDON.lat, LONDON.lng, 4),
            latLngToCell(SF.lat, SF.lng, 7),   // the one that contains it
            latLngToCell(LONDON.lat, LONDON.lng, 9),
        ];
        expect(containment(pos, mixed)).toBe("inside");
    });

    it("reports outside for an empty area", () => {
        const pos = positionAtPrecision(latLngToCell(SF.lat, SF.lng, 12), 10)!;
        expect(containment(pos, [])).toBe("outside");
    });

    it("ignores malformed area cells rather than throwing", () => {
        const pos = positionAtPrecision(latLngToCell(SF.lat, SF.lng, 12), 10)!;
        const area = ["", "garbage", latLngToCell(SF.lat, SF.lng, 5)];
        expect(containment(pos, area)).toBe("inside");
    });
});

describe("rule-facing guards", () => {
    it("only a definitive result satisfies its predicate", () => {
        expect(isDefinitelyInside("inside")).toBe(true);
        expect(isDefinitelyInside("indeterminate")).toBe(false);
        expect(isDefinitelyOutside("outside")).toBe(true);
        expect(isDefinitelyOutside("indeterminate")).toBe(false);
    });

    it("indeterminate satisfies NEITHER predicate", () => {
        // The whole point: an exclusion rule and an inclusion rule must both
        // decline to fire when the measurement cannot answer the question.
        expect(isDefinitelyInside("indeterminate")).toBe(false);
        expect(isDefinitelyOutside("indeterminate")).toBe(false);
    });
});
