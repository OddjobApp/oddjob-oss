import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LivingDocumentCanvas } from "./LivingDocumentCanvas";

describe("LivingDocumentCanvas", () => {
    it("shows externally applied critic content on the active node", () => {
        const node = { id: 7, content: "Original passive sentence", title: "Overview", sortOrder: 1 } as any;
        const { rerender } = render(
            <LivingDocumentCanvas activeNode={node} documentTitle="Agreement" onSaveContent={vi.fn()} />,
        );

        expect(screen.getByRole("textbox")).toHaveValue("Original passive sentence");

        rerender(
            <LivingDocumentCanvas
                activeNode={{ ...node, content: "Active proposed replacement" }}
                documentTitle="Agreement"
                onSaveContent={vi.fn()}
            />,
        );

        expect(screen.getByRole("textbox")).toHaveValue("Active proposed replacement");
    });

    /**
     * The <mark> test above is why rehype-raw is in the pipeline at all, and
     * rehype-raw alone would render every other tag in the manuscript too.
     * Station content is written by agents, so this pins the other half: the
     * formatting survives, the executable markup does not.
     */
    it("renders manuscript HTML without the markup that executes", () => {
        const node = {
            id: 9,
            content:
                'Intro. <img src="x" onerror="window.__scribeXss = true">' +
                '<script>window.__scribeXss = true;</script>' +
                '<iframe src="https://evil.example"></iframe>' +
                '<mark class="bg-amber-300/40">kept</mark>',
            title: "Overview",
            sortOrder: 1,
        } as any;

        const { container } = render(
            <LivingDocumentCanvas
                activeNode={node}
                documentTitle="PRD"
                defaultMode="rendered"
                onSaveContent={vi.fn()}
            />,
        );

        expect(container.querySelector("script")).toBeNull();
        expect(container.querySelector("iframe")).toBeNull();
        expect(container.querySelector("img[onerror]")).toBeNull();
        expect((window as any).__scribeXss).toBeUndefined();

        // ...while the highlight the editor writes still renders.
        expect(container.querySelector("mark")?.textContent).toBe("kept");
        expect(container.textContent).toContain("Intro.");
    });

    it("renders <mark> highlights as styled mark elements in rendered mode rather than raw HTML strings", () => {
        const node = {
            id: 8,
            content: '<mark class="bg-amber-300/40 text-foreground px-1 py-0.5 rounded">Map the current-state process</mark>',
            title: "Operating Model",
            sortOrder: 2,
        } as any;

        const { container } = render(
            <LivingDocumentCanvas
                activeNode={node}
                documentTitle="PRD"
                defaultMode="rendered"
                onSaveContent={vi.fn()}
            />
        );

        // It must render as an actual <mark> DOM element
        const markElement = container.querySelector("mark");
        expect(markElement).not.toBeNull();
        expect(markElement?.textContent).toBe("Map the current-state process");
        expect(markElement?.className).toContain("bg-amber-300/40");

        // The raw HTML tag string must NOT be visible as plain text in the prose container
        const proseContainer = container.querySelector('[title="Double-click to edit prose"]');
        expect(proseContainer?.textContent).not.toContain("<mark");
        expect(proseContainer?.textContent).toContain("Map the current-state process");
    });
});
