import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CrewForensicTimelineRail, ForensicEvent } from "./CrewForensicTimelineRail";

const mockEvents: ForensicEvent[] = [
    {
        id: "evt-1",
        timestamp: "08:12:00",
        severity: "critical",
        source: "AuthService",
        description: "Postgres connection pool exhausted (0/50 idle)",
        hypothesis: {
            statement: "Connection leak in JWT validator",
            confidence: "high",
            supportingAgents: ["SRE", "DBAdmin"],
        },
    },
    {
        id: "evt-2",
        timestamp: "08:14:30",
        severity: "warning",
        source: "IngestWorker",
        description: "Task retry queue backing up (> 500 items)",
    },
];

describe("CrewForensicTimelineRail", () => {
    it("renders incident title, events count, and event sequence", () => {
        render(
            <CrewForensicTimelineRail
                incidentTitle="Production Outage RCA"
                events={mockEvents}
            />
        );

        expect(screen.getByTestId("crew-forensic-timeline-rail")).toBeInTheDocument();
        expect(screen.getByText("Production Outage RCA")).toBeInTheDocument();
        expect(screen.getByText("2 Events")).toBeInTheDocument();
        expect(screen.getAllByText("08:12:00").length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText("AuthService")).toBeInTheDocument();
        expect(screen.getByText("08:14:30")).toBeInTheDocument();
        expect(screen.getByText("IngestWorker")).toBeInTheDocument();
    });

    it("renders root cause hypothesis cards and confidence badge", () => {
        render(<CrewForensicTimelineRail events={mockEvents} />);

        expect(screen.getByText(/Root Cause Hypotheses/i)).toBeInTheDocument();
        expect(screen.getByText("Connection leak in JWT validator")).toBeInTheDocument();
        expect(screen.getByText("High Prob")).toBeInTheDocument();
    });

    it("triggers onDiscussInChat when Investigate Event in Chat is clicked", () => {
        const onDiscuss = vi.fn();
        render(<CrewForensicTimelineRail events={mockEvents} onDiscussInChat={onDiscuss} />);

        const discussBtn = screen.getByRole("button", { name: /Investigate Event in Chat/i });
        fireEvent.click(discussBtn);

        expect(onDiscuss).toHaveBeenCalledTimes(1);
        expect(onDiscuss).toHaveBeenCalledWith(expect.stringContaining("Postgres connection pool"));
    });
});
