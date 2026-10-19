import { describe, it, expect } from "vitest";

import type { ImprovementExperiment } from "@shared/schema/improvement/index.js";
import {
    validatePreRegistration,
    assertPreRegistered,
    PreRegistrationError,
    evaluateExperiment,
    computeGuardrailOutcome,
    type ExperimentCriteria,
    type MeasuredOutcome,
} from "./experiment-criteria.service.js";

function fullExperiment(): Partial<ImprovementExperiment> {
    return {
        hypothesisId: 1,
        baselineDefinition: "median wait time over the prior 30 days",
        baselineWindowStart: new Date("2026-07-01"),
        baselineWindowEnd: new Date("2026-07-31"),
        intervention: "route low-risk cases directly to fulfilment",
        startsAt: new Date("2026-08-01"),
        endsAt: new Date("2026-08-15"),
        primaryMetric: "wait_duration_ms",
        primaryMetricDirection: "decrease",
        minimumEffect: 500,
        minimumSampleSize: 20,
        guardrails: [{ metric: "rework_rate", degradesWhen: "increase", maxDegradation: 2 }],
        stopConditions: { haltOnGuardrailBreach: true, manual: [] },
        rollbackPlan: "restore the prior routing rule",
        requiredApproverRole: "operations_owner",
        boundaries: {
            maxCases: 20,
            maxBudgetUsd: 50,
            permittedExternalActions: ["none"],
            permittedTools: ["read_workflow_events"],
            permittedDatasets: ["workflow_events"],
        },
    };
}

const criteria: ExperimentCriteria = {
    primaryMetric: "wait_duration_ms",
    primaryMetricDirection: "decrease",
    minimumEffect: 500,
    minimumSampleSize: 20,
    guardrails: [{ metric: "rework_rate", degradesWhen: "increase", maxDegradation: 2 }],
};

function measured(overrides: Partial<MeasuredOutcome> = {}): MeasuredOutcome {
    return {
        ran: true,
        baselineValue: 5000,
        baselineSampleCount: 100,
        interventionValue: 4000,
        interventionSampleCount: 25,
        executionFailureCount: 0,
        policyStopCount: 0,
        guardrailMeasurements: { rework_rate: { baseline: 10, intervention: 10 } },
        ...overrides,
    };
}

describe("validatePreRegistration", () => {
    it("accepts a fully declared experiment", () => {
        expect(validatePreRegistration(fullExperiment()).ok).toBe(true);
    });

    it.each([
        ["hypothesisId", "hypothesisId"],
        ["baselineDefinition", "baselineDefinition"],
        ["primaryMetric", "primaryMetric"],
        ["requiredApproverRole", "requiredApproverRole"],
        ["rollbackPlan", "rollbackPlan"],
        ["stopConditions", "stopConditions"],
    ])("refuses an experiment missing %s", (field) => {
        const exp = fullExperiment();
        delete (exp as any)[field];
        const r = validatePreRegistration(exp);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.issues.map(i => i.field)).toContain(field);
    });

    it("requires at least one guardrail", () => {
        const r = validatePreRegistration({ ...fullExperiment(), guardrails: [] });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.issues.map(i => i.field)).toContain("guardrails");
    });

    // Without a threshold there is no honest way to call anything inconclusive.
    it("requires a positive minimum sample size", () => {
        const r = validatePreRegistration({ ...fullExperiment(), minimumSampleSize: 0 });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.issues.map(i => i.field)).toContain("minimumSampleSize");
    });

    // Silence must never read as permission.
    it("rejects an empty external-action list in favour of an explicit ['none']", () => {
        const exp = fullExperiment();
        exp.boundaries = { ...exp.boundaries!, permittedExternalActions: [] };
        const r = validatePreRegistration(exp);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.issues.map(i => i.field)).toContain("boundaries.permittedExternalActions");
    });

    it("rejects an end that precedes its start", () => {
        const r = validatePreRegistration({ ...fullExperiment(), endsAt: new Date("2026-07-01") });
        expect(r.ok).toBe(false);
    });

    it("throws a typed error listing every missing field", () => {
        try {
            assertPreRegistered({});
            throw new Error("expected a refusal");
        } catch (err) {
            expect(err).toBeInstanceOf(PreRegistrationError);
            expect((err as PreRegistrationError).issues.length).toBeGreaterThan(5);
        }
    });
});

describe("evaluateExperiment", () => {
    it("passes when the metric moves far enough in the declared direction", () => {
        const v = evaluateExperiment(criteria, measured());
        expect(v.outcome).toBe("passed");
        expect(v.classification).toBe("hypothesis_supported");
        expect(v.observedEffect).toBe(-1000);
    });

    it("fails when the movement falls short of the minimum effect", () => {
        const v = evaluateExperiment(criteria, measured({ interventionValue: 4900 }));
        expect(v.outcome).toBe("failed");
        expect(v.classification).toBe("hypothesis_not_supported");
    });

    it("fails when the metric moves the wrong way", () => {
        const v = evaluateExperiment(criteria, measured({ interventionValue: 6000 }));
        expect(v.outcome).toBe("failed");
        expect(v.classification).toBe("hypothesis_not_supported");
    });

    it("reports not_run when the experiment never started", () => {
        const v = evaluateExperiment(criteria, measured({ ran: false }));
        expect(v.outcome).toBe("not_run");
        expect(v.classification).toBe("not_run");
    });

    describe("machinery faults are never hypothesis evidence", () => {
        // The distinction this whole service exists to preserve.
        it("classifies a policy stop as inconclusive, not failed", () => {
            const v = evaluateExperiment(criteria, measured({ policyStopCount: 1 }));
            expect(v.outcome).toBe("inconclusive");
            expect(v.classification).toBe("policy_stop");
        });

        it("classifies execution failures that starve the sample as inconclusive", () => {
            const v = evaluateExperiment(
                criteria,
                measured({ executionFailureCount: 18, interventionSampleCount: 5 }),
            );
            expect(v.outcome).toBe("inconclusive");
            expect(v.classification).toBe("execution_failure");
            expect(v.reasons.join(" ")).toMatch(/not evidence against the hypothesis/i);
        });

        // Recovery is not success: failures that did NOT starve the sample still
        // leave a clean verdict, but they never turn a miss into a pass.
        it("does not let a recovered failure rescue a short effect", () => {
            const v = evaluateExperiment(
                criteria,
                measured({ executionFailureCount: 3, interventionValue: 4900 }),
            );
            expect(v.outcome).toBe("failed");
            expect(v.classification).toBe("hypothesis_not_supported");
        });

        it("puts a policy stop ahead of an execution failure", () => {
            const v = evaluateExperiment(
                criteria,
                measured({ policyStopCount: 1, executionFailureCount: 9, interventionSampleCount: 2 }),
            );
            expect(v.classification).toBe("policy_stop");
        });
    });

    describe("evidence thresholds", () => {
        it("is inconclusive below the pre-registered minimum sample size", () => {
            const v = evaluateExperiment(criteria, measured({ interventionSampleCount: 19 }));
            expect(v.outcome).toBe("inconclusive");
            expect(v.classification).toBe("insufficient_evidence");
        });

        it("is inconclusive when a required metric could not be computed", () => {
            const v = evaluateExperiment(criteria, measured({ interventionValue: null }));
            expect(v.outcome).toBe("inconclusive");
            expect(v.classification).toBe("insufficient_evidence");
        });

        it("never returns passed on insufficient evidence, however good the numbers look", () => {
            const v = evaluateExperiment(
                criteria,
                measured({ interventionSampleCount: 1, interventionValue: 10 }),
            );
            expect(v.outcome).not.toBe("passed");
        });
    });

    describe("guardrails", () => {
        it("fails on a breached guardrail even when the primary metric succeeded", () => {
            const v = evaluateExperiment(
                criteria,
                measured({ guardrailMeasurements: { rework_rate: { baseline: 10, intervention: 15 } } }),
            );
            expect(v.outcome).toBe("failed");
            expect(v.classification).toBe("guardrail_breach");
        });

        it("tolerates degradation within the declared bound", () => {
            const v = evaluateExperiment(
                criteria,
                measured({ guardrailMeasurements: { rework_rate: { baseline: 10, intervention: 12 } } }),
            );
            expect(v.outcome).toBe("passed");
        });

        it("allows a guardrail to improve", () => {
            const v = evaluateExperiment(
                criteria,
                measured({ guardrailMeasurements: { rework_rate: { baseline: 10, intervention: 4 } } }),
            );
            expect(v.outcome).toBe("passed");
        });

        // "No incident recorded" is not proof of no harm.
        it("treats an unmeasured guardrail as breached, not as safe", () => {
            const v = evaluateExperiment(criteria, measured({ guardrailMeasurements: {} }));
            expect(v.outcome).toBe("failed");
            expect(v.classification).toBe("guardrail_breach");
            expect(v.reasons.join(" ")).toMatch(/not measured/i);
        });

        it("honours degradesWhen for a decrease-is-worse metric", () => {
            const g = { metric: "quality_score", degradesWhen: "decrease" as const, maxDegradation: 1 };
            expect(computeGuardrailOutcome(g, { baseline: 90, intervention: 85 }).breached).toBe(true);
            expect(computeGuardrailOutcome(g, { baseline: 90, intervention: 95 }).breached).toBe(false);
        });
    });

    it("always returns a guardrail row per declared guardrail", () => {
        const v = evaluateExperiment(criteria, measured());
        expect(v.guardrailResults).toHaveLength(1);
        expect(v.guardrailResults[0].metric).toBe("rework_rate");
    });
});
