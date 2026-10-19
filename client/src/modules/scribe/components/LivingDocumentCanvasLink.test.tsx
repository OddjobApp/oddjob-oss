import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LivingDocumentCanvas } from "./LivingDocumentCanvas";

/**
 * Insert Link, which used to be window.prompt.
 *
 * That is why there were no tests for it: a native prompt is unreachable from
 * jsdom, so the only way to check the behaviour was to click it by hand. It also
 * had nowhere to put validation, so whatever was typed went to execCommand —
 * including a "javascript:" address, which becomes a link in a manuscript that
 * other people open.
 */
const node = {
    id: 7,
    documentId: 3,
    stationKey: "overview",
    title: "Overview",
    content: "Some prose.",
    wordCount: 2,
    sortOrder: 1,
    status: "draft",
} as any;

const openLinkDialog = () => {
    render(
        <LivingDocumentCanvas activeNode={node} documentTitle="Doc" defaultMode="raw" onSaveContent={vi.fn()} />,
    );
    fireEvent.mouseDown(screen.getByRole("button", { name: "Insert Link" }));
};

describe("Insert Link", () => {
    it("opens an in-app dialog rather than a browser prompt", async () => {
        const promptSpy = vi.fn();
        vi.stubGlobal("prompt", promptSpy);

        openLinkDialog();

        expect(await screen.findByTestId("scribe-link-dialog")).toBeInTheDocument();
        expect(promptSpy).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it("is a real dialog, so assistive tech announces it as one", async () => {
        openLinkDialog();

        const dialog = await screen.findByRole("dialog");
        expect(dialog).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: /insert link/i })).toBeInTheDocument();
    });

    it("refuses a javascript: address instead of linking it", async () => {
        openLinkDialog();
        await screen.findByTestId("scribe-link-dialog");

        const input = screen.getByTestId("scribe-link-input");
        fireEvent.change(input, { target: { value: "javascript:alert(1)" } });
        fireEvent.submit(input.closest("form")!);

        expect(await screen.findByTestId("scribe-link-error")).toBeInTheDocument();
        // Still open, so the author can correct it rather than losing the attempt.
        expect(screen.getByTestId("scribe-link-dialog")).toBeInTheDocument();
    });

    it("accepts the addresses a document legitimately links to", async () => {
        for (const url of ["https://example.com", "mailto:a@b.co", "/projects/4", "#overview"]) {
            const { unmount } = render(
                <LivingDocumentCanvas activeNode={node} documentTitle="Doc" defaultMode="raw" onSaveContent={vi.fn()} />,
            );
            fireEvent.mouseDown(screen.getByRole("button", { name: "Insert Link" }));
            const input = await screen.findByTestId("scribe-link-input");
            fireEvent.change(input, { target: { value: url } });
            fireEvent.submit(input.closest("form")!);

            await waitFor(() => expect(screen.queryByTestId("scribe-link-error")).not.toBeInTheDocument());
            unmount();
        }
    });

    it("closes on Escape without inserting anything", async () => {
        const onSaveContent = vi.fn();
        render(
            <LivingDocumentCanvas activeNode={node} documentTitle="Doc" defaultMode="raw" onSaveContent={onSaveContent} />,
        );
        fireEvent.mouseDown(screen.getByRole("button", { name: "Insert Link" }));
        await screen.findByTestId("scribe-link-dialog");

        // A native prompt could not be dismissed this way, or tested at all.
        fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

        await waitFor(() => expect(screen.queryByTestId("scribe-link-dialog")).not.toBeInTheDocument());
        expect(onSaveContent).not.toHaveBeenCalled();
    });
});
