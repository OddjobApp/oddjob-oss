import { useEffect, useRef } from "react";

/**
 * The three things a hand-rolled overlay forgets.
 *
 * The codebase has seventeen `fixed inset-0` overlays outside components/ui, and
 * thirteen of them handled no keyboard at all. Each was written as markup — a
 * dark backdrop and a panel — which looks finished on screen and is not: a
 * dialog also has to be escapable, has to keep focus inside itself, and has to
 * stop the page behind it scrolling.
 *
 * Rewriting all thirteen into the Dialog primitive would mean re-deriving
 * thirteen bespoke layouts and animations, which is a lot of regression risk for
 * behaviour that is identical in every case. So this supplies the behaviour and
 * leaves the markup alone. New overlays should still use Dialog; this is for the
 * ones that already exist.
 *
 * What it does NOT do is make the overlay announce itself. That needs
 * role="dialog" and aria-modal on the panel, which is a one-line change at each
 * call site — see the usage note below.
 *
 * Usage:
 *
 *   const panelRef = useModalBehavior<HTMLDivElement>({ isOpen, onClose });
 *   ...
 *   <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Branch diff">
 */
export function useModalBehavior<T extends HTMLElement>(options: {
    isOpen: boolean;
    onClose: () => void;
    /** Set false for a non-blocking drawer that the page may scroll behind. */
    lockScroll?: boolean;
    /** Set false where Escape means something else to the panel's own content. */
    closeOnEscape?: boolean;
}) {
    const { isOpen, onClose, lockScroll = true, closeOnEscape = true } = options;
    const panelRef = useRef<T | null>(null);
    /** Where focus was before the overlay took it, so it can be given back. */
    const previouslyFocusedRef = useRef<Element | null>(null);

    // Read through a ref so a caller passing an inline arrow does not re-bind
    // the key listener on every render.
    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!isOpen || typeof document === "undefined") return;

        previouslyFocusedRef.current = document.activeElement;

        const FOCUSABLE =
            'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

        // Deliberately not filtered on offsetParent: it is null for a
        // position:fixed element, which is exactly what these overlays are, and
        // null for everything under jsdom. Filtering on it excluded every
        // control in the panel — the selector already drops disabled and
        // tabindex="-1", and including a hidden control is a far smaller
        // problem than trapping focus on nothing.
        const focusable = () =>
            Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);

        // Move focus in, so the first Tab goes somewhere inside rather than to
        // the page behind the backdrop.
        const first = focusable()[0];
        if (first) first.focus();
        else panelRef.current?.focus?.();

        const onKeyDown = (event: KeyboardEvent) => {
            if (closeOnEscape && event.key === "Escape") {
                event.stopPropagation();
                onCloseRef.current();
                return;
            }
            if (event.key !== "Tab" || !panelRef.current) return;

            const items = focusable();
            if (items.length === 0) {
                // Nothing to land on: keep focus on the panel rather than
                // letting Tab walk out into the page underneath.
                event.preventDefault();
                return;
            }

            const firstItem = items[0];
            const lastItem = items[items.length - 1];
            const active = document.activeElement;

            if (event.shiftKey && (active === firstItem || !panelRef.current.contains(active))) {
                event.preventDefault();
                lastItem.focus();
            } else if (!event.shiftKey && active === lastItem) {
                event.preventDefault();
                firstItem.focus();
            }
        };

        document.addEventListener("keydown", onKeyDown, true);

        const previousOverflow = document.body.style.overflow;
        if (lockScroll) document.body.style.overflow = "hidden";

        return () => {
            document.removeEventListener("keydown", onKeyDown, true);
            if (lockScroll) document.body.style.overflow = previousOverflow;

            // Give focus back to whatever opened this, so keyboard position is
            // not lost at the top of the page.
            const previous = previouslyFocusedRef.current as HTMLElement | null;
            if (previous && typeof previous.focus === "function" && document.contains(previous)) {
                previous.focus();
            }
        };
    }, [isOpen, lockScroll, closeOnEscape]);

    return panelRef;
}
