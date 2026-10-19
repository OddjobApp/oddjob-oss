import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LivingDocumentCanvas } from "./LivingDocumentCanvas";

const node = {
    id: 10,
    title: "Executive Summary",
    stationKey: "exec_summary",
    content: "# Executive Summary\n\nThis is **bold** text and a table:\n\n| Col 1 | Col 2 |\n|---|---|\n| A | B |\n",
    sortOrder: 1,
    wordCount: 15,
    status: "draft",
} as any;

describe("LivingDocumentCanvas Rich HTML & Copy as Markdown", () => {
    beforeEach(() => {
        Object.assign(navigator, {
            clipboard: {
                writeText: vi.fn().mockResolvedValue(undefined),
            },
        });
    });

    it("renders rich editor mode by default and supports mode switching", () => {
        render(
            <LivingDocumentCanvas
                activeNode={node}
                documentTitle="Project Proposal"
                onSaveContent={vi.fn()}
            />
        );

        // Verify rich editor button and canvas exist
        expect(screen.getByRole("button", { name: "Rich HTML Editor" })).toBeInTheDocument();
        expect(screen.getByTestId("scribe-rich-editor")).toBeInTheDocument();

        // Switch to Rendered mode
        fireEvent.click(screen.getByRole("button", { name: "Rendered Preview" }));
        expect(screen.queryByTestId("scribe-rich-editor")).not.toBeInTheDocument();

        // Switch to Raw Markdown mode
        fireEvent.click(screen.getByRole("button", { name: "Raw Markdown" }));
        const textarea = screen.getByRole("textbox");
        expect(textarea).toBeVisible();
    });

    it("copies markdown to clipboard on clicking Copy as Markdown", async () => {
        render(
            <LivingDocumentCanvas
                activeNode={node}
                documentTitle="Project Proposal"
                onSaveContent={vi.fn()}
            />
        );

        const copyBtn = screen.getByRole("button", { name: "Copy as Markdown" });
        expect(copyBtn).toBeInTheDocument();

        await fireEvent.click(copyBtn);

        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(node.content);
        expect(await screen.findByText("Copied!")).toBeInTheDocument();
    });

    it("provides rich HTML formatting tools in the floating ribbon", () => {
        render(
            <LivingDocumentCanvas
                activeNode={node}
                documentTitle="Project Proposal"
                onSaveContent={vi.fn()}
            />
        );

        expect(screen.getByRole("button", { name: "Heading 1" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Heading 2" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Heading 3" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Italic" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Underline" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Strikethrough" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Insert Table" })).toBeInTheDocument();
    });
});
