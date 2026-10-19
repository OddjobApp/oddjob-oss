/**
 * How much room the manuscript gets.
 *
 * The audit called the editor "squeezed into a narrow column between chat,
 * outline, and critics". That is measurable, and the first tests here are the
 * measurement: at the widths the studio actually shipped with, the manuscript
 * got 461px on a 1920px screen and 266px on a 1440px one.
 *
 * The risk in fixing it is folding rails an author wanted. So a wide window
 * keeps both, and the rails give way only in the order an author would choose
 * them to.
 */

import { describe, expect, it } from "vitest";
import {
    canvasWidth,
    canvasFits,
    fitRails,
    resolveRails,
    MIN_CANVAS,
    MIN_CANVAS_WITH_DOCK,
} from "./canvas-layout";

const BOTH_OPEN = { spineCollapsed: false, dockOpen: true };

/**
 * Pod widths as measured in the browser, per viewport.
 *
 * These were computed here from the rail's Tailwind clamp — a second copy of
 * `w-[clamp(46rem,54vw,72rem)]` living in a test. That is why the numbers below
 * are recorded rather than derived: a change to the rail's width leaves a
 * duplicated formula quietly describing a layout that no longer exists, and the
 * two squeeze tests would keep passing while asserting fiction.
 *
 * What these tests are actually about is the arithmetic in canvasWidth and
 * fitRails: given a pod this wide, how much does the manuscript get, and which
 * rails have to fold. The pod width is an input to that, not something to
 * re-derive.
 *
 * Whether the pod is really this wide is checked against the live DOM in
 * tests/e2e/scribe-accessibility.spec.ts, which measures rather than assumes.
 */
const POD_WIDTH: Record<number, number> = {
    1440: 893,
    1920: 1190,
    2560: 1408,
};

const podWidth = (viewport: number) => {
    const width = POD_WIDTH[viewport];
    if (width === undefined) throw new Error(`No recorded pod width for a ${viewport}px viewport`);
    return width;
};

describe("the squeeze, measured", () => {
    it("cannot hold both rails at 1440 without going under the comfortable measure", () => {
        // 893 - 224 spine - 288 dock. Three pixels short of MIN_CANVAS, which
        // used to cost the entire critics dock.
        const width = canvasWidth(podWidth(1440), BOTH_OPEN, 1440);

        expect(Math.round(width)).toBe(381);
        expect(width).toBeLessThan(MIN_CANVAS);
    });

    it("holds both comfortably at 1920", () => {
        const width = canvasWidth(podWidth(1920), BOTH_OPEN, 1920);

        expect(Math.round(width)).toBe(614);
        expect(width).toBeGreaterThanOrEqual(MIN_CANVAS);
    });

    it("never reports a negative width, however cramped", () => {
        expect(canvasWidth(100, BOTH_OPEN, 1440)).toBe(0);
        expect(canvasWidth(0, BOTH_OPEN, 1440)).toBe(0);
    });

    it("would fold everything for a container of zero width", () => {
        // Which is why the caller does not ask: zero is an unmeasured
        // container — before first layout, or in a hidden pane — not a narrow
        // one, and folding the rails on it decides the layout from nothing.
        expect(fitRails(0, 1440)).toEqual({ spineCollapsed: true, dockOpen: false });
    });
});

describe("keeping both rails when there is room", () => {
    it("changes nothing on a full-width canvas", () => {
        // Chat collapsed on a 1920px screen: the pod has the whole width.
        expect(fitRails(1920, 1920)).toEqual({ spineCollapsed: false, dockOpen: true });
    });

    it("keeps them at the exact width where the manuscript still fits", () => {
        // 256 spine + 320 dock + 560 canvas.
        expect(fitRails(1136, 1920)).toEqual({ spineCollapsed: false, dockOpen: true });
    });

    it("accounts for the wider rails a large viewport switches on", () => {
        // The same container is roomier below 2xl, where the rails are smaller.
        expect(fitRails(1100, 1920).spineCollapsed).toBe(true);
        expect(fitRails(1100, 1440).spineCollapsed).toBe(false);
    });
});

describe("giving way, in order", () => {
    // Explicit widths rather than viewport-derived ones: these are about the
    // order things are given up in, and pinning them to a viewport meant they
    // stopped exercising that order as soon as the rail's own width changed.
    it("folds the spine before touching the critics dock", () => {
        // 1000px below 2xl: both open leaves 488, folding the spine leaves 664.
        // Navigation survives folding — the spine keeps every station as a
        // numbered stop — so it is the cheaper thing to give up.
        expect(fitRails(1000, 1440)).toEqual({ spineCollapsed: true, dockOpen: true });
    });

    it("closes the dock only when folding the spine was not enough", () => {
        // 700px: folded with the dock open leaves 364, under every floor.
        expect(fitRails(700, 1440)).toEqual({ spineCollapsed: true, dockOpen: false });
    });

    it("never leaves the manuscript below the absolute floor", () => {
        // Comfortable where possible; usable always. The dock is allowed to
        // survive a near miss, so the guarantee is the lower of the two.
        for (const viewport of Object.keys(POD_WIDTH).map(Number)) {
            const available = podWidth(viewport);
            const width = canvasWidth(available, fitRails(available, viewport), viewport);
            expect(width).toBeGreaterThanOrEqual(MIN_CANVAS_WITH_DOCK);
        }
    });

    it("keeps the rails when nothing can make the manuscript readable", () => {
        // On a genuinely tiny container, hiding navigation costs the author
        // something and buys nothing.
        const layout = fitRails(400, 1440);

        expect(layout).toEqual({ spineCollapsed: true, dockOpen: false });
        expect(canvasFits(400, layout, 1440)).toBe(false);
    });
});

describe("canvasFits", () => {
    it("is true exactly at the floor", () => {
        // 224 spine + 288 dock + 560 canvas, below 2xl.
        expect(canvasFits(1072, BOTH_OPEN, 1440)).toBe(true);
        expect(canvasFits(1071, BOTH_OPEN, 1440)).toBe(false);
    });

    it("recovers the room a folded spine gives back", () => {
        expect(canvasFits(900, BOTH_OPEN, 1440)).toBe(false);
        expect(canvasFits(900, { spineCollapsed: true, dockOpen: true }, 1440)).toBe(true);
    });
});

describe("what the author asked for, against what fits", () => {
    // 1037px of pod on a 1920px screen: room for one rail, not both.
    const CROWDED = 1037;
    const ROOMY = 1600;

    it("fits automatically when the author has not touched anything", () => {
        expect(resolveRails(CROWDED, 1920, null)).toEqual(fitRails(CROWDED, 1920));
    });

    it("honours the arrangement when there is room for it", () => {
        const asked = { layout: { spineCollapsed: false, dockOpen: true }, touched: "spine" as const };
        expect(resolveRails(ROOMY, 1920, asked)).toEqual(asked.layout);
    });

    it("closes the dock when the author expands the spine and both will not fit", () => {
        // The demo's fork step does exactly this, and the dock was clipped
        // mid-word past the edge of the window.
        const asked = { layout: { spineCollapsed: false, dockOpen: true }, touched: "spine" as const };

        expect(resolveRails(CROWDED, 1920, asked)).toEqual({ spineCollapsed: false, dockOpen: false });
    });

    it("folds the spine when the author opens the dock and both will not fit", () => {
        const asked = { layout: { spineCollapsed: false, dockOpen: true }, touched: "dock" as const };

        expect(resolveRails(CROWDED, 1920, asked)).toEqual({ spineCollapsed: true, dockOpen: true });
    });

    it("keeps the rail the author touched, not the one they did not", () => {
        const spine = { layout: { spineCollapsed: false, dockOpen: true }, touched: "spine" as const };
        const dock = { layout: { spineCollapsed: false, dockOpen: true }, touched: "dock" as const };

        expect(resolveRails(CROWDED, 1920, spine).spineCollapsed).toBe(false);
        expect(resolveRails(CROWDED, 1920, dock).dockOpen).toBe(true);
    });

    it("leaves the manuscript readable in every case it can", () => {
        for (const touched of ["spine", "dock"] as const) {
            const asked = { layout: { spineCollapsed: false, dockOpen: true }, touched };
            const resolved = resolveRails(CROWDED, 1920, asked);
            expect(canvasFits(CROWDED, resolved, 1920)).toBe(true);
        }
    });

    it("falls back to the best available fit when nothing the author asked for works", () => {
        // Nothing fits at this width; the answer is still the most folded
        // arrangement rather than an overflowing one.
        const asked = { layout: { spineCollapsed: false, dockOpen: true }, touched: "spine" as const };
        expect(resolveRails(400, 1440, asked)).toEqual({ spineCollapsed: true, dockOpen: false });
    });
});

describe("the critics dock surviving a near miss", () => {
    it("stays open when the manuscript is only just under the comfortable measure", () => {
        // 893px of pod at 1440: folding the spine leaves 557 with the dock
        // open, three pixels short of MIN_CANVAS. Closing a whole review panel
        // to recover three pixels is the wrong trade.
        const layout = fitRails(podWidth(1440), 1440);

        expect(layout).toEqual({ spineCollapsed: true, dockOpen: true });
        expect(canvasWidth(podWidth(1440), layout, 1440)).toBe(557);
    });

    it("still closes the dock when what is left would be unusable", () => {
        // 500px of pod: even folded, the dock leaves 212.
        expect(fitRails(500, 1440)).toEqual({ spineCollapsed: true, dockOpen: false });
    });

    it("gives the author the same allowance", () => {
        const asked = { layout: { spineCollapsed: true, dockOpen: true }, touched: "dock" as const };
        expect(resolveRails(podWidth(1440), 1440, asked)).toEqual(asked.layout);
    });

    it("prefers the comfortable measure when there is room for it", () => {
        // The allowance is a fallback, not a licence to crowd a wide window.
        expect(fitRails(podWidth(1920), 1920)).toEqual({ spineCollapsed: false, dockOpen: true });
    });
});
