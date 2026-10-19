/**
 * Inserting an agent's answer into the station the author is typing in.
 *
 * The canvas debounces saves by 800ms. The insert path writes immediately, so
 * for most of a second the two race: the pending timer still holds the text as
 * it was BEFORE the insert, and letting it fire silently overwrites the
 * inserted passage. The author sees the text appear and then vanish, with
 * nothing logged anywhere.
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, act } from "@testing-library/react";
import { LivingDocumentCanvas } from "./LivingDocumentCanvas";

const node = {
    id: 7,
    title: "Overview",
    stationKey: "overview",
    content: "Original.",
    sortOrder: 1,
    wordCount: 1,
    status: "draft",
} as any;

describe("inserting agent text into the active station", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("does not let a pending autosave overwrite an insert", () => {
        const onSaveContent = vi.fn();
        render(
            <LivingDocumentCanvas activeNode={node} documentTitle="Agreement" onSaveContent={onSaveContent} />,
        );

        // Author types — this arms the 800ms autosave holding "Typed by hand."
        fireEvent.change(screen.getByRole("textbox"), { target: { value: "Typed by hand." } });

        // Before it fires, an agent answer is inserted from the chat rail.
        act(() => {
            window.dispatchEvent(
                new CustomEvent("scribe:insert-text", { detail: { text: "Inserted from chat." } }),
            );
        });

        // Let the autosave window pass.
        act(() => {
            vi.advanceTimersByTime(1500);
        });

        const lastSaved = onSaveContent.mock.calls.at(-1)?.[1];
        expect(lastSaved).toContain("Inserted from chat.");
        // The whole point: the pre-insert text must not be the last word.
        expect(lastSaved).not.toBe("Typed by hand.");
        expect(screen.getByRole("textbox")).toHaveValue(
            "Typed by hand.\n\nInserted from chat.",
        );
    });

    it("appends to what is already there rather than replacing it", () => {
        const onSaveContent = vi.fn();
        render(
            <LivingDocumentCanvas activeNode={node} documentTitle="Agreement" onSaveContent={onSaveContent} />,
        );

        act(() => {
            window.dispatchEvent(
                new CustomEvent("scribe:insert-text", { detail: { text: "Second paragraph." } }),
            );
        });

        expect(onSaveContent).toHaveBeenCalledWith(7, "Original.\n\nSecond paragraph.");
    });

    it("ignores an insert with no text", () => {
        const onSaveContent = vi.fn();
        render(
            <LivingDocumentCanvas activeNode={node} documentTitle="Agreement" onSaveContent={onSaveContent} />,
        );

        act(() => {
            window.dispatchEvent(new CustomEvent("scribe:insert-text", { detail: {} }));
        });

        expect(onSaveContent).not.toHaveBeenCalled();
    });

    it("rewrites targeted excerpt within the document when excerpt is provided", () => {
        const onSaveContent = vi.fn();
        const excerptNode = {
            ...node,
            content: "Before clause. Target excerpt to rewrite. After clause.",
        };
        render(
            <LivingDocumentCanvas activeNode={excerptNode} documentTitle="Agreement" onSaveContent={onSaveContent} />,
        );

        act(() => {
            window.dispatchEvent(
                new CustomEvent("scribe:insert-text", {
                    detail: {
                        text: "Polished rewritten manuscript prose.",
                        excerpt: "Target excerpt to rewrite.",
                        nodeId: node.id,
                    },
                }),
            );
        });

        expect(onSaveContent).toHaveBeenCalledWith(
            node.id,
            "Before clause. Polished rewritten manuscript prose. After clause.",
        );
    });

    it("replaces initial scaffolding placeholder when inserting draft into unwritten station", () => {
        const onSaveContent = vi.fn();
        const scaffoldingNode = {
            ...node,
            content: "Open with the strategic imperative, then frame the problem in business terms. Identify the key stakeholders and the decision this document supports.",
            wordCount: 0,
        };
        render(
            <LivingDocumentCanvas activeNode={scaffoldingNode} documentTitle="Agreement" onSaveContent={onSaveContent} />,
        );

        act(() => {
            window.dispatchEvent(
                new CustomEvent("scribe:insert-text", {
                    detail: {
                        text: "Shelfie is an intelligent inventory management platform.",
                    },
                }),
            );
        });

        expect(onSaveContent).toHaveBeenCalledWith(
            node.id,
            "Shelfie is an intelligent inventory management platform.",
        );
    });

    it("ignores insert targeted at a different nodeId", () => {
        const onSaveContent = vi.fn();
        render(
            <LivingDocumentCanvas activeNode={node} documentTitle="Agreement" onSaveContent={onSaveContent} />,
        );

        act(() => {
            window.dispatchEvent(
                new CustomEvent("scribe:insert-text", {
                    detail: {
                        text: "For another node",
                        nodeId: 999,
                    },
                }),
            );
        });

        expect(onSaveContent).not.toHaveBeenCalled();
    });

    it("inserts at top immediately beneath heading anchor when placement is top", () => {
        const onSaveContent = vi.fn();
        const titledNode = {
            ...node,
            content: "# Station 1\n\nExisting body paragraph.",
        };
        render(
            <LivingDocumentCanvas activeNode={titledNode} documentTitle="Agreement" onSaveContent={onSaveContent} />,
        );

        act(() => {
            window.dispatchEvent(
                new CustomEvent("scribe:insert-text", {
                    detail: {
                        text: "*Disclaimer: Confidential and proprietary.*",
                        placement: "top",
                        nodeId: node.id,
                    },
                }),
            );
        });

        expect(onSaveContent).toHaveBeenCalledWith(
            node.id,
            "# Station 1\n\n*Disclaimer: Confidential and proprietary.*\n\nExisting body paragraph.",
        );
    });

    it("surgically replaces excerpt even when quote characters or whitespace have slight drift", () => {
        const onSaveContent = vi.fn();
        const driftedNode = {
            ...node,
            content: 'Section 1. “Original quoted passage” with details.',
        };
        render(
            <LivingDocumentCanvas activeNode={driftedNode} documentTitle="Agreement" onSaveContent={onSaveContent} />,
        );

        act(() => {
            window.dispatchEvent(
                new CustomEvent("scribe:insert-text", {
                    detail: {
                        text: '"Polished replacement passage"',
                        excerpt: '"Original quoted passage"',
                        nodeId: node.id,
                    },
                }),
            );
        });

        expect(onSaveContent).toHaveBeenCalledWith(
            node.id,
            'Section 1. "Polished replacement passage" with details.',
        );
    });
});
