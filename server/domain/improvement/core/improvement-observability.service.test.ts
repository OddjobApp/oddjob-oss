import { describe, it, expect } from "vitest";

import { detectDarkSubsystems, type ImprovementMetrics } from "./improvement-observability.service.js";

/**
 * The trust metrics are only worth having if "nothing measured" and "nothing
 * wrong" stay distinguishable. These tests pin that distinction, and the
 * dark-subsystem signals that depend on it.
 */

function trust(over: Partial<ImprovementMetrics["trust"]> = {}): ImprovementMetrics["trust"] {
    const full = (v: number | null, n = 1, d = 1) => ({ value: v, numerator: n, denominator: d });
    return {
        opportunitiesWithEvidence: full(1),
        hypothesesWithCounterEvidence: full(1),
        opportunitiesDeclaringLimitations: full(1),
        gapEventsWithRunIdentity: full(1),
        gapEventsWithActor: full(1),
        resultsWithPreRegisteredThreshold: full(1),
        resultsWithHumanDisposition: full(1),
        resultsInconclusiveFromMachinery: full(0, 0, 1),
        ...over,
    };
}

const healthy = {
    gapEventCount: 10,
    opportunityCount: 3,
    observationCount: 12,
    workflowEventCount: 40,
    experimentCount: 2,
    trust: trust(),
};

describe("detectDarkSubsystems", () => {
    it("is silent when everything is producing data", () => {
        expect(detectDarkSubsystems(healthy)).toEqual([]);
    });

    // The exact shape this platform repeats: a table that stays empty because
    // nothing reaches the writer, looking identical to genuine quiet.
    it("flags an empty gap-event table and says the two readings are indistinguishable", () => {
        const signals = detectDarkSubsystems({ ...healthy, gapEventCount: 0 });
        expect(signals.join(" ")).toMatch(/No capability-gap events/);
        expect(signals.join(" ")).toMatch(/look identical/);
    });

    it("flags candidates raised without any evidence", () => {
        const signals = detectDarkSubsystems({
            ...healthy,
            trust: trust({ opportunitiesWithEvidence: { value: 0, numerator: 0, denominator: 3 } }),
        });
        expect(signals.join(" ")).toMatch(/none cites an observation/);
    });

    it("flags a dark observation table", () => {
        const signals = detectDarkSubsystems({ ...healthy, observationCount: 0 });
        expect(signals.join(" ")).toMatch(/evidence table is dark/);
    });

    it("flags workflow measurement having no input", () => {
        const signals = detectDarkSubsystems({ ...healthy, workflowEventCount: 0 });
        expect(signals.join(" ")).toMatch(/No workflow events imported/);
    });

    it("flags opportunities that never became experiments", () => {
        const signals = detectDarkSubsystems({ ...healthy, experimentCount: 0 });
        expect(signals.join(" ")).toMatch(/no experiment has ever been created/);
    });

    it("flags gap events arriving without run identity", () => {
        const signals = detectDarkSubsystems({
            ...healthy,
            trust: trust({ gapEventsWithRunIdentity: { value: 0, numerator: 0, denominator: 10 } }),
        });
        expect(signals.join(" ")).toMatch(/without run identity/);
    });

    // A ratio over an empty denominator is null, and null must not read as a
    // problem — that would make an empty system look broken rather than empty.
    it("does not treat a null ratio as a failure", () => {
        const signals = detectDarkSubsystems({
            ...healthy,
            trust: trust({ opportunitiesWithEvidence: { value: null, numerator: 0, denominator: 0 } }),
        });
        expect(signals.join(" ")).not.toMatch(/none cites an observation/);
    });

    it("reports several signals at once for a wholly empty loop", () => {
        const signals = detectDarkSubsystems({
            gapEventCount: 0,
            opportunityCount: 0,
            observationCount: 0,
            workflowEventCount: 0,
            experimentCount: 0,
            trust: trust({
                opportunitiesWithEvidence: { value: null, numerator: 0, denominator: 0 },
                gapEventsWithRunIdentity: { value: null, numerator: 0, denominator: 0 },
            }),
        });
        // The two that are true of an empty system, and not the ones that would
        // only be true of a broken one.
        expect(signals).toHaveLength(2);
        expect(signals.join(" ")).toMatch(/No capability-gap events/);
        expect(signals.join(" ")).toMatch(/No workflow events/);
    });
});
