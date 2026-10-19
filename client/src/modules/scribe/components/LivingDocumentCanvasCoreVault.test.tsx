import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LivingDocumentCanvas } from "./LivingDocumentCanvas";
import type { ScribeNode } from "@shared/schema/scribe";

describe("LivingDocumentCanvas - CORE Vault & Safe Mode", () => {
    const mockNode: ScribeNode = {
        id: 101,
        documentId: 1,
        title: "Confidential Scene",
        stationKey: "st-101",
        content: '# Confidential Scene\n\nBefore the scene.\n:::sandbox id="s1" type="adult" mode="static_reinsert" summary="Passionate moment"\nHe held her close in the moonlight.\n:::\nAfter the scene.',
        sortOrder: 1,
        status: "draft",
        organizationId: 1,
        pacingScore: 80,
        continuityStatus: "clean",
        wordCount: 30,
        createdAt: new Date(),
        updatedAt: new Date(),
    } as any;

    it("renders Safe Mode toggle and toggles scribe-safe-mode class", () => {
        const { container } = render(
            <LivingDocumentCanvas
                activeNode={mockNode}
                documentTitle="Manuscript 1"
                onSaveContent={vi.fn()}
            />
        );

        const safeModeToggle = screen.getByTestId("scribe-safe-mode-toggle");
        expect(safeModeToggle).toBeInTheDocument();
        expect(safeModeToggle).toHaveTextContent("Safe Mode");

        // Before click, no scribe-safe-mode on paper container
        expect(container.querySelector(".scribe-safe-mode")).toBeNull();

        // Click toggle to turn Safe Mode ON
        fireEvent.click(safeModeToggle);
        expect(safeModeToggle).toHaveTextContent("Safe Mode ON");
        expect(container.querySelector(".scribe-safe-mode")).not.toBeNull();

        // Click again to turn Safe Mode OFF
        fireEvent.click(safeModeToggle);
        expect(safeModeToggle).toHaveTextContent("Safe Mode");
        expect(container.querySelector(".scribe-safe-mode")).toBeNull();
    });

    it("renders Egress Inspector button and opens inspector dialog with sanitized payload preview", () => {
        render(
            <LivingDocumentCanvas
                activeNode={mockNode}
                documentTitle="Manuscript 1"
                onSaveContent={vi.fn()}
            />
        );

        const egressToggle = screen.getByTestId("scribe-egress-inspector-toggle");
        expect(egressToggle).toBeInTheDocument();

        // Click to open inspector
        fireEvent.click(egressToggle);

        const inspectorDialog = screen.getByTestId("scribe-egress-inspector");
        expect(inspectorDialog).toBeInTheDocument();
        expect(screen.getByText("Confidential Egress Inspector")).toBeInTheDocument();
        expect(screen.getByText(/Zero-Egress Guarantee: ACTIVE/)).toBeInTheDocument();
        expect(screen.getByText(/1 Confidential Block\(s\) Protected/)).toBeInTheDocument();

        // Check that sanitized preview has surrogate marker and NO sensitive text
        expect(screen.getByText(/\[SCENE_BEAT: Passionate moment\] <<ODDJOB_MASK:/)).toBeInTheDocument();
    });

    it("renders Vault block insertion macro button and opens menu", () => {
        render(
            <LivingDocumentCanvas
                activeNode={mockNode}
                documentTitle="Manuscript 1"
                onSaveContent={vi.fn()}
            />
        );

        const vaultMacroBtn = screen.getByTestId("scribe-insert-sandbox");
        expect(vaultMacroBtn).toBeInTheDocument();

        fireEvent.mouseDown(vaultMacroBtn);

        expect(screen.getByText("Confidential Vault Type")).toBeInTheDocument();
        expect(screen.getByText("Adult / Romance")).toBeInTheDocument();
        expect(screen.getByText("Action / Forensic")).toBeInTheDocument();
    });
});
