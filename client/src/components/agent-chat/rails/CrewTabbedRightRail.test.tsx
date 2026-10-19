import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CrewTabbedRightRail } from "./CrewTabbedRightRail";

const mockTurns = [
    {
        id: "turn-1",
        artifacts: [
            {
                tool: "propose_decision_matrix",
                payload: {
                    type: "crew_decision_matrix_pod",
                    topic: "Database Architecture Selection",
                    candidates: [
                        { id: "opt-1", name: "Spanner", scores: { perf: 9 }, overallScore: 9 },
                        { id: "opt-2", name: "Postgres", scores: { perf: 7 }, overallScore: 7 },
                    ],
                    criteria: [{ key: "perf", label: "Performance", weight: 1 }],
                },
            },
            {
                tool: "request_governance_approval",
                payload: {
                    type: "crew_governance_gate_pod",
                    checkpoint: {
                        id: "cp-1",
                        actionKey: "run_migration",
                        actionTitle: "Run DB Migration",
                        riskTier: "high",
                        requestedBy: "DBAdmin",
                        blastRadius: { estimatedCostUsd: 50 },
                        executionPayload: {},
                        status: "pending",
                        requestedAt: "2026-08-28T07:00:00Z",
                    },
                },
            },
            {
                tool: "pin_forensic_event",
                payload: {
                    type: "crew_forensic_timeline_pod",
                    event: {
                        id: "fe-1",
                        description: "Security Token Rotated",
                        severity: "info",
                        source: "AuthService",
                        timestamp: "2026-08-28T07:15:00Z",
                    },
                },
            },
        ],
    },
];

describe("CrewTabbedRightRail", () => {
    it("renders all 3 navigation tabs and defaults to the Supervisor", () => {
        render(
            <CrewTabbedRightRail
                turns={mockTurns}
                supervisorRail={<div data-testid="supervisor-content">Supervisor Content</div>}
                blackboardRail={<div data-testid="blackboard-content">Blackboard Content</div>}
                puzzleRail={<div data-testid="puzzle-content">Assembler Content</div>}
                isCollapsed={false}
                onToggleCollapse={() => {}}
            />
        );

        expect(screen.getByTestId("tab-supervisor")).toHaveTextContent("Supervisor");
        expect(screen.getByTestId("tab-blackboard")).toHaveTextContent("Blackboard");
        expect(screen.getByTestId("tab-puzzle-rail")).toHaveTextContent("Assembler");
        expect(screen.queryByTestId("tab-decision-matrix")).not.toBeInTheDocument();
        expect(screen.queryByTestId("tab-governance")).not.toBeInTheDocument();
        expect(screen.queryByTestId("tab-forensics")).not.toBeInTheDocument();
        expect(screen.getByTestId("supervisor-content")).toBeInTheDocument();

        fireEvent.click(screen.getByTestId("tab-blackboard"));
        expect(screen.getByTestId("blackboard-content")).toBeInTheDocument();

        fireEvent.click(screen.getByTestId("tab-puzzle-rail"));
        expect(screen.getByTestId("puzzle-content")).toBeInTheDocument();
    });

    it("renders the Decision Matrix within Blackboard", () => {
        const onSendMessage = vi.fn();
        render(
            <CrewTabbedRightRail
                turns={mockTurns}
                blackboardRail={<div>Blackboard records</div>}
                puzzleRail={<div>Assembler</div>}
                isCollapsed={false}
                onToggleCollapse={() => {}}
                onSendMessage={onSendMessage}
            />
        );

        fireEvent.click(screen.getByTestId("tab-blackboard"));
        expect(screen.getByTestId("blackboard-decision-matrix")).toBeInTheDocument();
        expect(screen.getByText("Blackboard records")).toBeInTheDocument();
        expect(screen.getByText("Spanner")).toBeInTheDocument();
        expect(screen.getByText("Postgres")).toBeInTheDocument();
    });

    it("renders Governance within Supervisor and allows approval", () => {
        const onSendMessage = vi.fn();
        render(
            <CrewTabbedRightRail
                turns={mockTurns}
                supervisorRail={<div>Supervisor direction</div>}
                puzzleRail={<div>Assembler</div>}
                isCollapsed={false}
                onToggleCollapse={() => {}}
                onSendMessage={onSendMessage}
            />
        );

        expect(screen.getByTestId("supervisor-governance")).toBeInTheDocument();
        expect(screen.getByText("Supervisor direction")).toBeInTheDocument();
        expect(screen.getAllByText("Run DB Migration").length).toBeGreaterThanOrEqual(1);

        const approveBtn = screen.getByRole("button", { name: /Approve/i });
        fireEvent.click(approveBtn);
        expect(onSendMessage).toHaveBeenCalledWith(expect.stringContaining("Approved governance action"));
    });

    it("renders Forensics within Blackboard", () => {
        render(
            <CrewTabbedRightRail
                turns={mockTurns}
                blackboardRail={<div>Blackboard records</div>}
                puzzleRail={<div>Assembler</div>}
                isCollapsed={false}
                onToggleCollapse={() => {}}
            />
        );

        fireEvent.click(screen.getByTestId("tab-blackboard"));
        expect(screen.getByTestId("blackboard-forensics")).toBeInTheDocument();
        expect(screen.getByText("Blackboard records")).toBeInTheDocument();
        expect(screen.getAllByText("Security Token Rotated").length).toBeGreaterThanOrEqual(1);
    });

    it("renders collapsed view when isCollapsed is true and triggers onToggleCollapse", () => {
        const onToggle = vi.fn();
        render(
            <CrewTabbedRightRail
                turns={mockTurns}
                puzzleRail={<div>Assembler</div>}
                isCollapsed={true}
                onToggleCollapse={onToggle}
            />
        );

        const collapsedRail = screen.getByTestId("crew-tabbed-rail-collapsed");
        expect(collapsedRail).toBeInTheDocument();

        fireEvent.click(collapsedRail);
        expect(onToggle).toHaveBeenCalled();
    });

    it("renders friendly empty states when no artifacts exist", () => {
        render(
            <CrewTabbedRightRail
                turns={[]}
                puzzleRail={<div>Empty Assembler</div>}
                isCollapsed={false}
                onToggleCollapse={() => {}}
            />
        );

        expect(screen.queryByTestId("tab-decision-matrix")).not.toBeInTheDocument();
        expect(screen.queryByTestId("tab-governance")).not.toBeInTheDocument();
        expect(screen.queryByTestId("tab-forensics")).not.toBeInTheDocument();
        expect(screen.getByText(/No governance checkpoints pending/i)).toBeInTheDocument();

        fireEvent.click(screen.getByTestId("tab-blackboard"));
        expect(screen.getByText(/No forensic events recorded/i)).toBeInTheDocument();
    });
});
