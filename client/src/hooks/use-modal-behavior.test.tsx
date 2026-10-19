import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useModalBehavior } from "./use-modal-behavior";

/**
 * The behaviour thirteen hand-rolled overlays were missing.
 *
 * Each was written as markup — a backdrop and a panel — which looks finished and
 * is not: a dialog has to be escapable, has to hold focus, and has to stop the
 * page behind it scrolling. These assert each of those separately, because an
 * overlay can plausibly get one right and not the others.
 */
function Overlay({
    isOpen,
    onClose,
    lockScroll,
    withButtons = true,
}: {
    isOpen: boolean;
    onClose: () => void;
    lockScroll?: boolean;
    withButtons?: boolean;
}) {
    const panelRef = useModalBehavior<HTMLDivElement>({ isOpen, onClose, lockScroll });
    if (!isOpen) return null;
    return (
        <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Panel">
            {withButtons && (
                <>
                    <button type="button">First</button>
                    <button type="button">Middle</button>
                    <button type="button">Last</button>
                </>
            )}
        </div>
    );
}

afterEach(() => {
    cleanup();
    document.body.style.overflow = "";
});

describe("useModalBehavior", () => {
    it("closes on Escape", () => {
        const onClose = vi.fn();
        render(<Overlay isOpen onClose={onClose} />);

        fireEvent.keyDown(document, { key: "Escape" });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("does nothing while closed", () => {
        const onClose = vi.fn();
        render(<Overlay isOpen={false} onClose={onClose} />);

        fireEvent.keyDown(document, { key: "Escape" });
        expect(onClose).not.toHaveBeenCalled();
        expect(document.body.style.overflow).toBe("");
    });

    it("moves focus into the panel so the first Tab does not land behind it", () => {
        render(<Overlay isOpen onClose={vi.fn()} />);
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
    });

    it("wraps Tab from the last control back to the first", () => {
        render(<Overlay isOpen onClose={vi.fn()} />);

        const last = screen.getByRole("button", { name: "Last" });
        last.focus();
        fireEvent.keyDown(document, { key: "Tab" });

        expect(document.activeElement).toBe(screen.getByRole("button", { name: "First" }));
    });

    it("wraps Shift+Tab from the first control back to the last", () => {
        render(<Overlay isOpen onClose={vi.fn()} />);

        screen.getByRole("button", { name: "First" }).focus();
        fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

        expect(document.activeElement).toBe(screen.getByRole("button", { name: "Last" }));
    });

    it("keeps Tab inside even when the panel has no controls", () => {
        render(<Overlay isOpen onClose={vi.fn()} withButtons={false} />);
        // Nothing to land on must not mean "walk out into the page underneath".
        const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
        document.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });

    it("locks the page behind it, and restores scrolling on close", () => {
        const { rerender } = render(<Overlay isOpen onClose={vi.fn()} />);
        expect(document.body.style.overflow).toBe("hidden");

        rerender(<Overlay isOpen={false} onClose={vi.fn()} />);
        expect(document.body.style.overflow).toBe("");
    });

    it("leaves the page scrollable for a non-blocking drawer", () => {
        render(<Overlay isOpen onClose={vi.fn()} lockScroll={false} />);
        expect(document.body.style.overflow).toBe("");
    });

    it("gives focus back to whatever opened it", () => {
        document.body.innerHTML = '<button id="trigger">Open</button><div id="host"></div>';
        const trigger = document.getElementById("trigger") as HTMLButtonElement;
        trigger.focus();
        expect(document.activeElement).toBe(trigger);

        const { rerender } = render(<Overlay isOpen onClose={vi.fn()} />, {
            container: document.getElementById("host")!,
        });
        expect(document.activeElement).not.toBe(trigger);

        rerender(<Overlay isOpen={false} onClose={vi.fn()} />);
        // Keyboard position is not lost at the top of the page.
        expect(document.activeElement).toBe(trigger);
    });
});
