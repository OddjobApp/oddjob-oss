import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BranchDiffViewer } from "./BranchDiffViewer";
import type { ScribeNode, ScribeBranch } from "@shared/schema/scribe";

describe("BranchDiffViewer Component", () => {
    const mockTrunkNode: ScribeNode = {
        id: 1,
        documentId: 10,
        branchId: 1,
        stationKey: "station-1",
        sortOrder: 1,
        title: "Services & SLA",
        content: "Customer agrees to subscribe to services as outlined in SLA terms.",
        contentRich: null,
        wordCount: 11,
        targetPercentage: 0.1,
        status: "draft",
        continuityNotes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const mockBranchNode: ScribeNode = {
        id: 2,
        documentId: 10,
        branchId: 2,
        stationKey: "station-1",
        sortOrder: 1,
        title: "Services & SLA",
        content: "Customer agrees to subscribe to Enterprise Premium services with 99.99% uptime guarantee.",
        contentRich: null,
        wordCount: 12,
        targetPercentage: 0.1,
        status: "in_review",
        continuityNotes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const mockBranch: ScribeBranch = {
        id: 2,
        documentId: 10,
        branchKey: "branch-b",
        parentBranchId: 1,
        breakoutSessionId: null,
        name: "Branch B: 99.99% SLA Upgrade",
        description: "Branch with 99.99% SLA",
        status: "active",
        divergedAtStationKey: "station-1",
        createdAt: new Date(),
    };

    it("renders side-by-side branch comparison diff", () => {
        const onClose = vi.fn();
        render(
            <BranchDiffViewer
                stationTitle="Services & SLA"
                stationKey="station-1"
                trunkNode={mockTrunkNode}
                branchNode={mockBranchNode}
                activeBranch={mockBranch}
                onClose={onClose}
            />
        );

        expect(screen.getByTestId("branch-diff-viewer-modal")).toBeDefined();
        expect(screen.getByText(/Branch Comparison Diff/i)).toBeDefined();
        expect(screen.getByText(/Branch B: 99.99% SLA Upgrade/i)).toBeDefined();
        expect(screen.getByText(/Customer agrees to subscribe to services as outlined in SLA terms./i)).toBeDefined();
        expect(screen.getByText(/Enterprise Premium services with 99.99% uptime guarantee/i)).toBeDefined();
    });

    it("calls onApplyBranchToTrunk when clicking Apply Branch to Trunk", () => {
        const onClose = vi.fn();
        const onApply = vi.fn();
        render(
            <BranchDiffViewer
                stationTitle="Services & SLA"
                stationKey="station-1"
                trunkNode={mockTrunkNode}
                branchNode={mockBranchNode}
                activeBranch={mockBranch}
                onClose={onClose}
                onApplyBranchToTrunk={onApply}
            />
        );

        const applyBtn = screen.getByText(/Apply Branch to Trunk/i);
        fireEvent.click(applyBtn);

        expect(onApply).toHaveBeenCalledWith(mockBranchNode.content);
        expect(onClose).toHaveBeenCalled();
    });
});
