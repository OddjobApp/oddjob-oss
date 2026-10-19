/**
 * Codegen Pipeline Workbench — component unit tests (plan task 12.2).
 *
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom";

import { StatusBadge } from "@domain-ui/sdlc-pipeline/ui/modules/components/StatusBadge.js";
import { PhaseProgressStepper } from "@domain-ui/sdlc-pipeline/ui/modules/components/PhaseProgressStepper.js";
import { SessionTable } from "@domain-ui/sdlc-pipeline/ui/modules/components/SessionTable.js";
import { VerificationTimeline } from "@domain-ui/sdlc-pipeline/ui/modules/components/VerificationTimeline.js";
import { QualityGatePanel } from "@domain-ui/sdlc-pipeline/ui/modules/components/QualityGatePanel.js";
import type { PhaseStatus, SessionListItem, VerificationEvent, QualityGateResult, PRResult } from "@domain-ui/sdlc-pipeline/ui/modules/types/index.js";

function phase(overrides: Partial<PhaseStatus> = {}): PhaseStatus {
  return { phase: "planning", status: "pending", startedAt: null, completedAt: null, artifactCount: 0, costUsd: 0, ...overrides };
}
function listItem(overrides: Partial<SessionListItem> = {}): SessionListItem {
  return { id: "sess-abcdef123", templateId: "tpl", status: "active", currentPhase: "planning", phases: [], totalCostUsd: 1.5, startedAt: new Date().toISOString(), completedAt: null, ...overrides };
}

describe("StatusBadge", () => {
  it("renders the label for a status", () => {
    render(<StatusBadge status="completed" />);
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });
  it("shows attempt number and elapsed time for active sessions", () => {
    render(<StatusBadge status="active" attemptNumber={2} elapsedMs={5000} />);
    expect(screen.getByText(/attempt 2/)).toBeInTheDocument();
    expect(screen.getByText(/5s/)).toBeInTheDocument();
  });
  it("renders a blocked badge (with reason available for tooltip)", () => {
    render(<StatusBadge status="blocked" blockedReason="Quality gate failed" />);
    expect(screen.getByText("Blocked")).toBeInTheDocument();
  });
});

describe("PhaseProgressStepper", () => {
  it("shows cost and artifact count for completed phases", () => {
    render(<PhaseProgressStepper phases={[phase({ phase: "planning", status: "completed", costUsd: 0.25, artifactCount: 2 })]} />);
    expect(screen.getByText(/\$0\.25/)).toBeInTheDocument();
    expect(screen.getByText(/2 artifacts/)).toBeInTheDocument();
  });
  it("renders a Retry button for a failed phase and fires the callback", () => {
    const onRetry = vi.fn();
    render(<PhaseProgressStepper phases={[phase({ phase: "test_loop", status: "failed" })]} onRetryPhase={onRetry} />);
    fireEvent.click(screen.getByTestId("retry-phase-test_loop"));
    expect(onRetry).toHaveBeenCalledWith("test_loop");
  });
  it("shows an empty message with no phases", () => {
    render(<PhaseProgressStepper phases={[]} />);
    expect(screen.getByText(/No phases recorded/)).toBeInTheDocument();
  });
});

describe("SessionTable", () => {
  it("sorts blocked sessions before active and others (default sort)", () => {
    const sessions = [
      listItem({ id: "active-1", status: "active" }),
      listItem({ id: "blocked-1", status: "blocked" }),
      listItem({ id: "completed-1", status: "completed" }),
    ];
    render(<SessionTable sessions={sessions} />);
    const rows = screen.getAllByTestId(/^session-row-/);
    expect(rows[0]).toHaveAttribute("data-testid", "session-row-blocked-1");
  });
  it("renders an empty state when there are no sessions", () => {
    render(<SessionTable sessions={[]} />);
    expect(screen.getByTestId("session-table-empty")).toBeInTheDocument();
  });
  it("invokes onRowClick with the session id", () => {
    const onClick = vi.fn();
    render(<SessionTable sessions={[listItem({ id: "sess-x" })]} onRowClick={onClick} />);
    fireEvent.click(screen.getByTestId("session-row-sess-x"));
    expect(onClick).toHaveBeenCalledWith("sess-x");
  });
});

describe("VerificationTimeline", () => {
  const events: VerificationEvent[] = [
    { timestamp: new Date(), type: "step_check", status: "passed", details: {}, duration: 10 },
    { timestamp: new Date(), type: "fix_attempt", status: "failed", details: { diagnosis: "null deref" }, duration: 50 },
  ];
  it("renders a placeholder when there is no report", () => {
    render(<VerificationTimeline events={[]} />);
    expect(screen.getByText(/No verification report/)).toBeInTheDocument();
  });
  it("renders events and expands a fix attempt on click", () => {
    render(<VerificationTimeline events={events} />);
    expect(screen.getByText("step check")).toBeInTheDocument();
    fireEvent.click(screen.getByText("fix attempt"));
    expect(screen.getByText(/null deref/)).toBeInTheDocument();
  });
});

describe("QualityGatePanel", () => {
  const failing: QualityGateResult = {
    passed: false,
    evaluatedAt: new Date(),
    checks: [{ name: "tests", description: "all tests pass", passed: false, details: "2 failing" }],
    blockingFailures: [{ check: "tests", reason: "2 tests failing" }],
  };
  const passing: QualityGateResult = { passed: true, evaluatedAt: new Date(), checks: [{ name: "tests", description: "", passed: true }], blockingFailures: [] };
  const pr: PRResult = { branchName: "codegen/x", commitSha: "abcdef123456", prUrl: "http://pr", prNumber: 7, description: "", testEvidence: { totalTests: 10, passingTests: 10, fixAttempts: 1, verificationTimeline: "" } };

  it("shows failed state with blocking failures and a review action", () => {
    const onReview = vi.fn();
    render(<QualityGatePanel result={failing} onRequestReview={onReview} />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText(/2 tests failing/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("request-review"));
    expect(onReview).toHaveBeenCalled();
  });
  it("shows the PR result when the gate passed", () => {
    render(<QualityGatePanel result={passing} prResult={pr} />);
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getByText(/PR #7/)).toBeInTheDocument();
  });
});
