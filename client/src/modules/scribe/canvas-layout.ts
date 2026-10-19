/**
 * How much room the manuscript gets.
 *
 * The studio lays out three fixed columns — station spine, canvas, critics —
 * with the canvas taking whatever is left over. Nothing checked that the
 * leftover was usable, so it wasn't:
 *
 *   1920px viewport: the rail is 54vw (1037px), the spine takes 256px and the
 *   critics dock 320px, leaving the manuscript 461px.
 *
 *   1440px viewport: the rail is 778px, the spine 224px, the dock 288px,
 *   leaving 266px — a column roughly 30 characters wide, for prose.
 *
 * That is the squeeze. It is arithmetic, not taste, which is why this is a
 * function with tests rather than a set of breakpoints.
 *
 * The rails give way in the order an author would choose. The spine is
 * navigation and folds to a strip of numbered stops that still works; the
 * critics dock has a closed strip too, and goes only when folding the spine was
 * not enough. Nothing here overrides a deliberate choice — see canvasFits.
 */

/** Tailwind w-56 / 2xl:w-64, in pixels. */
const SPINE_EXPANDED = { base: 224, wide: 256 };
/** Tailwind w-12. Still shows every station as a numbered stop. */
const SPINE_COLLAPSED = 48;
/** Tailwind w-72 / 2xl:w-80. */
const DOCK_OPEN = { base: 288, wide: 320 };
/** The icon strip left behind when the dock is closed. */
const DOCK_CLOSED = 40;

/** Tailwind's 2xl breakpoint, which is what switches the wider variants on. */
const WIDE_VIEWPORT = 1536;

/**
 * The narrowest manuscript column worth writing in.
 *
 * A comfortable measure is 60-75 characters; at the canvas's 16px serif that is
 * around 520px, plus its own padding. Below this the author is scanning a
 * column narrower than a phone.
 */
export const MIN_CANVAS = 560;

/**
 * The narrowest the manuscript goes before the critics dock is given up.
 *
 * MIN_CANVAS is the comfortable measure, and a single floor made it a cliff:
 * at a 1440px viewport the canvas came to 557px with the dock open — three
 * pixels short — and the entire review panel was closed to recover them. Eighty
 * pixels of line length is not worth a panel, and 480 is still around 55
 * characters at the canvas's 16px serif.
 *
 * Below this the dock really does have to go, because what is left is not a
 * column anyone can draft in.
 */
export const MIN_CANVAS_WITH_DOCK = 480;

export interface RailLayout {
    spineCollapsed: boolean;
    dockOpen: boolean;
}

/** The width the manuscript would get under a given arrangement. */
export function canvasWidth(available: number, layout: RailLayout, viewport: number): number {
    const wide = viewport >= WIDE_VIEWPORT;
    const spine = layout.spineCollapsed ? SPINE_COLLAPSED : wide ? SPINE_EXPANDED.wide : SPINE_EXPANDED.base;
    const dock = layout.dockOpen ? (wide ? DOCK_OPEN.wide : DOCK_OPEN.base) : DOCK_CLOSED;

    return Math.max(0, available - spine - dock);
}

/** Whether the manuscript is readable as things currently stand. */
export function canvasFits(available: number, layout: RailLayout, viewport: number): boolean {
    return canvasWidth(available, layout, viewport) >= MIN_CANVAS;
}

/**
 * The most the author can keep while the manuscript stays readable.
 *
 * Both rails stay open when there is room for them, so a wide window is not
 * quietly stripped back. When there is not, the spine folds first and the dock
 * closes only if folding the spine was not enough. If even that leaves too
 * little, the arrangement is returned anyway: there is nothing else to give,
 * and hiding the rails at that point would cost navigation without buying a
 * readable column.
 */
export function fitRails(available: number, viewport: number): RailLayout {
    /**
     * In the order an author would give things up.
     *
     * The third entry is why the dock survives a near miss: the spine is
     * already folded and the manuscript is a little under its comfortable
     * measure, which is a better trade than losing the reviewer panel.
     */
    const candidates: Array<{ layout: RailLayout; floor: number }> = [
        { layout: { spineCollapsed: false, dockOpen: true }, floor: MIN_CANVAS },
        { layout: { spineCollapsed: true, dockOpen: true }, floor: MIN_CANVAS },
        { layout: { spineCollapsed: true, dockOpen: true }, floor: MIN_CANVAS_WITH_DOCK },
        { layout: { spineCollapsed: true, dockOpen: false }, floor: MIN_CANVAS },
    ];

    const chosen = candidates.find(
        ({ layout, floor }) => canvasWidth(available, layout, viewport) >= floor,
    );

    return chosen?.layout ?? candidates[candidates.length - 1].layout;
}

/** Which rail the author last acted on, so the other one gives way first. */
export type TouchedRail = "spine" | "dock";

export interface AuthorRails {
    layout: RailLayout;
    touched: TouchedRail;
}

/**
 * What to show, given what the author asked for and what will fit.
 *
 * The first cut simply stopped auto-fitting once the author touched a rail.
 * That honoured the request and then let the consequence land off-screen: with
 * both rails pinned open at a width that holds neither, the critics dock was
 * clipped mid-word past the edge of the window, because the column row hides
 * its overflow rather than scrolling it.
 *
 * Refusing the request outright is no better — expanding the spine and watching
 * it snap shut reads as a broken control. So the rail they touched is kept and
 * the other one gives way, which is the trade they would have made themselves.
 * Only when even that does not fit does the arrangement fall back to whatever
 * leaves the manuscript most room.
 */
export function resolveRails(
    available: number,
    viewport: number,
    author: AuthorRails | null,
): RailLayout {
    if (!author) return fitRails(available, viewport);
    if (canvasFits(available, author.layout, viewport)) return author.layout;

    // The same near-miss allowance: an author who pinned the spine open should
    // not lose the dock over a handful of pixels either.
    if (
        author.layout.dockOpen &&
        canvasWidth(available, author.layout, viewport) >= MIN_CANVAS_WITH_DOCK
    ) {
        return author.layout;
    }

    const relaxed: RailLayout =
        author.touched === "spine"
            ? { ...author.layout, dockOpen: false }
            : { ...author.layout, spineCollapsed: true };

    return canvasFits(available, relaxed, viewport) ? relaxed : fitRails(available, viewport);
}
