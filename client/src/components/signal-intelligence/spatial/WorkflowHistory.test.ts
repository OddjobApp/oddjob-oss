import { describe, it, expect, beforeEach } from "vitest";
import { getWorkflowHistory, getWorkflowById, saveWorkflowOutput } from "./WorkflowHistory";
import type { WorkflowOutput } from "./WorkflowHistory";

/**
 * Workflow history must contain only what the user actually did.
 *
 * It used to seed itself on first read with INITIAL_WORKFLOWS — fabricated
 * records ("Geofence Intrusion & Anomaly Detection", score 0.92, duration 45s,
 * Sector 7-A, completed) — and, because the seed was WRITTEN to localStorage
 * during that read, they stopped looking like defaults and started looking like
 * the user's own history.
 */

const KEY = "oddjob:spatial:workflow-history";

const real = (over: Partial<WorkflowOutput> = {}): WorkflowOutput => ({
    id: "wf-real-1",
    timestamp: new Date().toISOString(),
    signal: {
        id: "sig-real",
        title: "Vendor invoice anomaly",
        kind: "threat",
        severity: "HIGH",
        targetSector: "Finance",
        jurisdiction: "EU",
        eventType: "ANOMALY",
    },
    action: { type: "subscription", impact: "High", description: "Route to triage" },
    completed: true,
    ...over,
});

beforeEach(() => localStorage.clear());

describe("getWorkflowHistory", () => {
    it("starts empty rather than seeding invented records", () => {
        expect(getWorkflowHistory()).toEqual([]);
    });

    it("writes nothing to storage just by being read", () => {
        getWorkflowHistory();
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("never returns the fabricated seed content", () => {
        const serialised = JSON.stringify(getWorkflowHistory());
        expect(serialised).not.toContain("Geofence");
        expect(serialised).not.toContain("Sector 7-A");
    });

    it("returns a stored empty array as empty instead of re-seeding", () => {
        localStorage.setItem(KEY, JSON.stringify([]));
        expect(getWorkflowHistory()).toEqual([]);
    });

    it("returns what the user actually saved", () => {
        saveWorkflowOutput(real());
        const history = getWorkflowHistory();
        expect(history).toHaveLength(1);
        expect(history[0].signal.title).toBe("Vendor invoice anomaly");
    });

    it("records no duration or score for a workflow that has not run", () => {
        saveWorkflowOutput(real());
        const [saved] = getWorkflowHistory();
        expect(saved.duration).toBeUndefined();
        expect(saved.signal.score).toBeUndefined();
        expect(saved.signal.confidence).toBeUndefined();
    });

    it("returns null for an unknown id rather than inventing a workflow", () => {
        expect(getWorkflowById("wf-spatial-001")).toBeNull();
    });
});
