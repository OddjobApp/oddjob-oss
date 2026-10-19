import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LivingDocumentCanvas } from "./LivingDocumentCanvas";

/**
 * What the footer is allowed to claim, and what a pending edit is owed.
 *
 * The indicator was a boolean: anything that was not "saving" rendered a green
 * "Synced" check, including before the first save and after a failed one. And
 * the debounce was cancelled on unmount rather than flushed, so leaving a
 * station within 800ms of typing dropped that edit without a word.
 */
const node = {
    id: 7,
    documentId: 3,
    stationKey: "overview",
    title: "Overview",
    content: "Existing prose.",
    wordCount: 2,
    sortOrder: 1,
    status: "draft",
} as any;

const type = (value: string) => {
    const box = screen.getByRole("textbox", { name: "Manuscript Prose" });
    fireEvent.change(box, { target: { value } });
};

describe("autosave reports what actually happened", () => {
    it("does not claim a save before one has happened", () => {
        render(<LivingDocumentCanvas activeNode={node} documentTitle="Doc" defaultMode="raw" onSaveContent={vi.fn()} />);

        expect(screen.queryByTestId("scribe-save-synced")).not.toBeInTheDocument();
        expect(screen.getByText(/no changes/i)).toBeInTheDocument();
    });

    it("waits for the write to resolve before saying Synced", async () => {
        vi.useFakeTimers();
        let resolveSave: () => void = () => {};
        const onSaveContent = vi.fn(() => new Promise<void>((r) => (resolveSave = r)));

        render(<LivingDocumentCanvas activeNode={node} documentTitle="Doc" defaultMode="raw" onSaveContent={onSaveContent} />);
        type("New prose the author typed.");

        await vi.advanceTimersByTimeAsync(900);
        expect(onSaveContent).toHaveBeenCalled();
        // In flight: the old code had already rendered "Synced" by this point.
        expect(screen.queryByTestId("scribe-save-synced")).not.toBeInTheDocument();

        resolveSave();
        vi.useRealTimers();
        await waitFor(() => expect(screen.getByTestId("scribe-save-synced")).toBeInTheDocument());
    });

    it("says the change was not saved when the write fails", async () => {
        vi.useFakeTimers();
        const onSaveContent = vi.fn(() => Promise.reject(new Error("Storage quota exceeded")));

        render(<LivingDocumentCanvas activeNode={node} documentTitle="Doc" defaultMode="raw" onSaveContent={onSaveContent} />);
        type("Text that will not persist.");
        await vi.advanceTimersByTimeAsync(900);
        vi.useRealTimers();

        const failed = await screen.findByTestId("scribe-save-failed");
        expect(failed).toBeInTheDocument();
        expect(failed).toHaveAttribute("title", "Storage quota exceeded");
        expect(screen.queryByTestId("scribe-save-synced")).not.toBeInTheDocument();
    });

    it("retries the failed write when the author asks", async () => {
        vi.useFakeTimers();
        const onSaveContent = vi
            .fn()
            .mockRejectedValueOnce(new Error("network"))
            .mockResolvedValueOnce(undefined);

        render(<LivingDocumentCanvas activeNode={node} documentTitle="Doc" defaultMode="raw" onSaveContent={onSaveContent} />);
        type("Worth keeping.");
        await vi.advanceTimersByTimeAsync(900);
        vi.useRealTimers();

        fireEvent.click(await screen.findByTestId("scribe-save-failed"));

        await waitFor(() => expect(screen.getByTestId("scribe-save-synced")).toBeInTheDocument());
        expect(onSaveContent).toHaveBeenCalledTimes(2);
    });

    it("sends a debounced edit when the station changes instead of dropping it", async () => {
        vi.useFakeTimers();
        const onSaveContent = vi.fn(() => Promise.resolve());

        const { rerender } = render(
            <LivingDocumentCanvas activeNode={node} documentTitle="Doc" defaultMode="raw" onSaveContent={onSaveContent} />,
        );
        type("A sentence typed just before switching away.");

        // Well inside the 800ms debounce: the old cleanup cleared this timer.
        await vi.advanceTimersByTimeAsync(100);
        expect(onSaveContent).not.toHaveBeenCalled();

        rerender(
            <LivingDocumentCanvas
                activeNode={{ ...node, id: 8, stationKey: "next", content: "Other" }}
                documentTitle="Doc"
                defaultMode="raw"
                onSaveContent={onSaveContent}
            />,
        );
        vi.useRealTimers();

        await waitFor(() =>
            expect(onSaveContent).toHaveBeenCalledWith(7, "A sentence typed just before switching away."),
        );
    });

    it("sends a debounced edit when the studio closes", async () => {
        vi.useFakeTimers();
        const onSaveContent = vi.fn(() => Promise.resolve());

        const { unmount } = render(
            <LivingDocumentCanvas activeNode={node} documentTitle="Doc" defaultMode="raw" onSaveContent={onSaveContent} />,
        );
        type("Typed, then the pod closed.");
        await vi.advanceTimersByTimeAsync(100);

        unmount();
        vi.useRealTimers();

        await waitFor(() => expect(onSaveContent).toHaveBeenCalledWith(7, "Typed, then the pod closed."));
    });
});
