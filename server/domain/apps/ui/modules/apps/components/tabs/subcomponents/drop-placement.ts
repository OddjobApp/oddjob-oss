/**
 * Drag-and-drop placement for the App Builder's preview pane.
 *
 * Kept out of AppInteractiveBuilderTab.tsx so the placement rules can be tested
 * without mounting the whole studio.
 */

export type DropSlot = 'top' | 'left' | 'right' | 'bottom' | null;

/** MIME type carried by a draggable Oddjob block, from the Arsenal or the canvas. */
export const PRIMITIVE_MIME = 'application/oddjob-primitive';

/**
 * Placeholder for a drag that entered the preview from outside the builder tab
 * (the Visual canvas palette). `getData` is unreadable until drop, so the slot
 * overlay is armed with this and the real component name is resolved from the
 * drop event. Without it the overlay never mounted for those drags, the pointer
 * passed over the preview iframe, and the drop was silently swallowed.
 */
export const EXTERNAL_DRAG = '__external__';

/**
 * Where a dropped block should land, described by position only.
 *
 * These strings used to name another app's components ("beneath Squad Fleet
 * Readiness", "under Service Provider Network"), so every app was told to
 * position new blocks relative to components it does not have.
 */
export function slotInstructionFor(slot: DropSlot | undefined): string {
    switch (slot) {
        case 'top':
            return "\n\nPLACEMENT: Insert this component at the very TOP of the page, as a full-width section above the existing content.";
        case 'left':
            return "\n\nPLACEMENT: Insert this component into the LEFT column of the page's main two-column grid, after the content already there. Keep the responsive grid-cols-1 md:grid-cols-2 layout (introduce it if the page is a single column).";
        case 'right':
            return "\n\nPLACEMENT: Insert this component into the RIGHT column of the page's main two-column grid, after the content already there. Keep the responsive grid-cols-1 md:grid-cols-2 layout (introduce it if the page is a single column).";
        case 'bottom':
            return "\n\nPLACEMENT: Append this component at the very BOTTOM of the page, spanning full width beneath the existing content.";
        default:
            return "";
    }
}

/**
 * The component a drop is carrying.
 *
 * `carried` is the drag payload; `dragState` is what the pane armed on drag
 * enter, which may be the external placeholder and is never a component name.
 */
export function resolveDroppedComponent(
    carried: string | null | undefined,
    dragState: string | null,
): string | null {
    if (carried) return carried;
    return dragState && dragState !== EXTERNAL_DRAG ? dragState : null;
}

/** True when a config schema has a required field a drop cannot supply. */
export function needsConfiguration(
    fields: Array<{ required?: boolean; default?: unknown }> | undefined,
): boolean {
    return fields?.some((f) => f.required && f.default === undefined) ?? false;
}
