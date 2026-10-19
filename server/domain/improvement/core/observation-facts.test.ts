import { describe, it, expect } from "vitest";

import {
    validateObservationFacts,
    assertObservationFacts,
    computeObservationContentHash,
    ObservationFactsError,
} from "./observation-facts.js";

describe("validateObservationFacts", () => {
    // The spec's own example: measurements are observations, conclusions are not.
    it("accepts measurements", () => {
        expect(validateObservationFacts({ wait_duration_ms: 4200, handoff_count: 3 }).ok).toBe(true);
    });

    it("accepts sequence facts that only look causal", () => {
        expect(validateObservationFacts({ followed_by_rework: true, preceded_by: "step_3" }).ok).toBe(true);
    });

    it("rejects a causal label", () => {
        const r = validateObservationFacts({ caused_delay: true });
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.violations[0].key).toBe("caused_delay");
            expect(r.violations[0].reason).toMatch(/wait_duration_ms/);
        }
    });

    it.each([
        "caused_delay",
        "causedDelay",
        "Caused-Delay",
        "root_cause",
        "due_to_backlog",
        "reason_for_failure",
        "led_to_rework",
        "responsible_for_outage",
        "why_it_failed",
    ])("rejects '%s' regardless of casing or separators", (key) => {
        expect(validateObservationFacts({ [key]: "x" }).ok).toBe(false);
    });

    // Burying it one level down reaches the same reader.
    it("walks nested objects", () => {
        const r = validateObservationFacts({ step: { detail: { caused_by: "db" } } });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.violations[0].key).toBe("step.detail.caused_by");
    });

    it("reports every violation, not just the first", () => {
        const r = validateObservationFacts({ caused_delay: 1, root_cause: "x", wait_duration_ms: 5 });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.violations).toHaveLength(2);
    });

    it("throws a typed error carrying the violations", () => {
        try {
            assertObservationFacts({ caused_delay: true });
            throw new Error("expected a refusal");
        } catch (err) {
            expect(err).toBeInstanceOf(ObservationFactsError);
            expect((err as ObservationFactsError).violations).toHaveLength(1);
        }
    });
});

describe("computeObservationContentHash", () => {
    const base = {
        sourceType: "workflow_event",
        sourceId: "case-1:step-2",
        observedAt: "2026-08-25T10:00:00.000Z",
        facts: { wait_duration_ms: 4200, handoff_count: 3 },
    };

    it("is stable across calls", () => {
        expect(computeObservationContentHash(base)).toBe(computeObservationContentHash(base));
    });

    // Re-ingest must be a no-op against the unique index, not a duplicate that
    // inflates every frequency count built on top.
    it("ignores key order in facts", () => {
        const reordered = { ...base, facts: { handoff_count: 3, wait_duration_ms: 4200 } };
        expect(computeObservationContentHash(reordered)).toBe(computeObservationContentHash(base));
    });

    it("treats a Date and its ISO string as the same instant", () => {
        expect(computeObservationContentHash({ ...base, observedAt: new Date(base.observedAt) }))
            .toBe(computeObservationContentHash(base));
    });

    it("changes when a fact value changes", () => {
        const changed = { ...base, facts: { ...base.facts, wait_duration_ms: 4201 } };
        expect(computeObservationContentHash(changed)).not.toBe(computeObservationContentHash(base));
    });

    it("distinguishes different sources reporting identical facts", () => {
        expect(computeObservationContentHash({ ...base, sourceId: "case-2:step-2" }))
            .not.toBe(computeObservationContentHash(base));
        expect(computeObservationContentHash({ ...base, sourceType: "mission_event" }))
            .not.toBe(computeObservationContentHash(base));
    });

    it("distinguishes the same event observed at different times", () => {
        expect(computeObservationContentHash({ ...base, observedAt: "2026-08-25T11:00:00.000Z" }))
            .not.toBe(computeObservationContentHash(base));
    });

    it("handles nested facts deterministically", () => {
        const a = { ...base, facts: { outer: { b: 1, a: 2 } } };
        const b = { ...base, facts: { outer: { a: 2, b: 1 } } };
        expect(computeObservationContentHash(a)).toBe(computeObservationContentHash(b));
    });
});
