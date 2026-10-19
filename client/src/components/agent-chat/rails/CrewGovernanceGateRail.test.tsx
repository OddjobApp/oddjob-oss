import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CrewGovernanceGateRail, GovernanceCheckpoint } from "./CrewGovernanceGateRail";

const mockCheckpoints: GovernanceCheckpoint[] = [
    {
        id: "gov-test-1",
        actionKey: "migrate_db",
        actionTitle: "Run Schema Migration 0090",
        riskTier: "high",
        requestedBy: "DBAdmin",
        blastRadius: {
            affectedServices: ["auth", "billing"],
            dataDestructionRisk: false,
            estimatedCostUsd: 25,
            tenantsImpactedCount: 10,
        },
        executionPayload: { migration: "0090_add_retention_index" },
        status: "pending",
        requestedAt: "2026-08-28T05:00:00Z",
    },
];

describe("CrewGovernanceGateRail", () => {
    it("renders checkpoint queue, risk tier, and blast radius details", () => {
        render(<CrewGovernanceGateRail checkpoints={mockCheckpoints} />);

        expect(screen.getByTestId("crew-governance-gate-rail")).toBeInTheDocument();
        expect(screen.getAllByText("Run Schema Migration 0090").length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText(/high/i).length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText(/@DBAdmin/i)).toBeInTheDocument();
        expect(screen.getByText(/Cost: ~\$25/i)).toBeInTheDocument();
        expect(screen.getByText(/Tenants: 10/i)).toBeInTheDocument();
    });

    it("triggers onApprove when Approve & Execute is clicked", () => {
        const onApprove = vi.fn();
        render(<CrewGovernanceGateRail checkpoints={mockCheckpoints} onApprove={onApprove} />);

        const approveBtn = screen.getByRole("button", { name: /Approve & Execute/i });
        fireEvent.click(approveBtn);

        expect(onApprove).toHaveBeenCalledTimes(1);
        expect(onApprove).toHaveBeenCalledWith("gov-test-1");
    });

    it("allows entering a rejection reason and triggers onReject", () => {
        const onReject = vi.fn();
        render(<CrewGovernanceGateRail checkpoints={mockCheckpoints} onReject={onReject} />);

        const rejectBtn = screen.getByRole("button", { name: /^Reject$/i });
        fireEvent.click(rejectBtn);

        const input = screen.getByPlaceholderText(/Explain why this action cannot proceed/i);
        fireEvent.change(input, { target: { value: "Maintenance window is closed" } });

        const confirmRejectBtn = screen.getByRole("button", { name: /Confirm Reject/i });
        fireEvent.click(confirmRejectBtn);

        expect(onReject).toHaveBeenCalledTimes(1);
        expect(onReject).toHaveBeenCalledWith("gov-test-1", "Maintenance window is closed");
    });
});
