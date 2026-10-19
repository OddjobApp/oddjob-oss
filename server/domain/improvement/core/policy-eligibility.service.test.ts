import { describe, it, expect } from "vitest";

import {
    evaluatePolicyEligibility,
    LIVE_AUTO_APPROVAL_PATTERNS,
    DEFAULT_ELIGIBILITY_THRESHOLDS,
    type ApprovalRecord,
    type PatternDescriptor,
} from "./policy-eligibility.service.js";

function records(n: number, opts: Partial<ApprovalRecord> & { spanDays?: number } = {}): ApprovalRecord[] {
    const span = opts.spanDays ?? 30;
    const start = new Date("2026-06-01T00:00:00Z").getTime();
    return Array.from({ length: n }, (_, i) => ({
        toolName: "some_tool",
        status: opts.status ?? "approved",
        createdAt: new Date(start + (i * span * 86_400_000) / Math.max(n - 1, 1)),
        remediated: opts.remediated,
        organizationId: 42,
    }));
}

function goodDescriptor(over: Partial<PatternDescriptor> = {}): PatternDescriptor {
    return {
        key: "candidate",
        actionClasses: ["read_report"],
        unboundedActionClass: false,
        parameterBoundsExpressible: true,
        ownerId: "ops-owner",
        ...over,
    };
}

function verdict(result: ReturnType<typeof evaluatePolicyEligibility>, id: string) {
    return result.criteria.find(c => c.id === id)!;
}

describe("evaluatePolicyEligibility", () => {
    it("passes a pattern that meets every criterion", () => {
        const mixed = [...records(40, { spanDays: 30 })];
        mixed[0].status = "rejected";
        mixed.forEach(r => (r.remediated = false));

        const result = evaluatePolicyEligibility(
            goodDescriptor(),
            mixed,
            { checked: true, unresolvedCriticalCount: 0 },
        );
        expect(result.eligible).toBe(true);
        expect(result.blockers).toEqual([]);
    });

    it("fails below the volume threshold", () => {
        const r = evaluatePolicyEligibility(goodDescriptor(), records(29), { checked: true, unresolvedCriticalCount: 0 });
        expect(verdict(r, "minimum_resolved_requests").verdict).toBe("fail");
        expect(r.eligible).toBe(false);
    });

    it("fails below the observation window", () => {
        const r = evaluatePolicyEligibility(goodDescriptor(), records(40, { spanDays: 5 }), { checked: true });
        expect(verdict(r, "minimum_observation_window").verdict).toBe("fail");
    });

    describe("unavailable never counts as a pass", () => {
        // A gate that opens on missing information is not a gate.
        it("marks unchecked incidents unavailable, not clear", () => {
            const r = evaluatePolicyEligibility(goodDescriptor(), records(40), { checked: false });
            expect(verdict(r, "no_unresolved_critical_incident").verdict).toBe("unavailable");
            expect(r.eligible).toBe(false);
            expect(r.blockers).toContain("no_unresolved_critical_incident");
        });

        it("marks remediation unavailable when nothing distinguishes it", () => {
            const r = evaluatePolicyEligibility(goodDescriptor(), records(40), { checked: true });
            expect(verdict(r, "remediation_separated").verdict).toBe("unavailable");
        });
    });

    describe("discriminative power", () => {
        // The finding that reshaped M4: an approval rate over a set with no
        // rejections is 1.0 by construction.
        it("fails when nothing was ever rejected", () => {
            const r = evaluatePolicyEligibility(goodDescriptor(), records(200), { checked: true, unresolvedCriticalCount: 0 });
            const d = verdict(r, "discriminative_power");
            expect(d.verdict).toBe("fail");
            expect(d.detail).toMatch(/1\.0 by construction/);
        });

        it("passes once the decision set contains a rejection", () => {
            const mixed = records(40);
            mixed[3].status = "rejected";
            const r = evaluatePolicyEligibility(goodDescriptor(), mixed, { checked: true });
            expect(verdict(r, "discriminative_power").verdict).toBe("pass");
        });

        it("does not let sheer volume substitute for variation", () => {
            const r = evaluatePolicyEligibility(goodDescriptor(), records(5000), { checked: true, unresolvedCriticalCount: 0 });
            expect(r.eligible).toBe(false);
            expect(r.blockers).toContain("discriminative_power");
        });
    });

    it("flags an unbounded action class", () => {
        const r = evaluatePolicyEligibility(
            goodDescriptor({ unboundedActionClass: true, actionClasses: [] }),
            records(40),
            { checked: true },
        );
        expect(verdict(r, "narrow_action_class").verdict).toBe("fail");
    });

    it("flags scope pinned in code", () => {
        const r = evaluatePolicyEligibility(
            goodDescriptor({ hardcodedScope: "organizationId === 291" }),
            records(40),
            { checked: true },
        );
        expect(verdict(r, "scope_declared_not_hardcoded").verdict).toBe("fail");
    });

    it("says so plainly when a pattern has no decision record at all", () => {
        const r = evaluatePolicyEligibility(goodDescriptor(), [], { checked: true });
        expect(verdict(r, "minimum_resolved_requests").detail).toMatch(/stopped producing one/);
    });
});

/**
 * §7's actual first deliverable: run the seven live predicates through the gate.
 *
 * Every one is evaluated against an EMPTY decision set, because that is the
 * real state of the data — `approval_requests` holds no record for any tool
 * these predicates cover. Auto-approval removed the evidence needed to review
 * the auto-approval.
 */
describe("the live auto-approval predicates, re-derived under §7.2", () => {
    const noRecords: ApprovalRecord[] = [];

    it("covers all seven predicates", () => {
        expect(LIVE_AUTO_APPROVAL_PATTERNS).toHaveLength(7);
    });

    it.each(LIVE_AUTO_APPROVAL_PATTERNS.map(p => [p.key, p] as const))(
        "'%s' would not qualify today",
        (_key, pattern) => {
            const r = evaluatePolicyEligibility(pattern, noRecords, { checked: false });
            expect(r.eligible).toBe(false);
            // Every one fails the same two structural criteria, before any
            // argument about thresholds.
            expect(r.blockers).toContain("minimum_resolved_requests");
            expect(r.blockers).toContain("named_owner");
        },
    );

    // §7.2 requires ONE narrow action and resource class. Three of the seven
    // fail it: one fires on any action at all, and two more bundle five and
    // seven distinct tools into a single rule. (isErrorReview also fired on any
    // action until it was scoped to `error_escalation` in Sep 2026.)
    it("identifies every predicate that is not one narrow action class", () => {
        const notNarrow = LIVE_AUTO_APPROVAL_PATTERNS
            .filter(p => evaluatePolicyEligibility(p, noRecords).blockers.includes("narrow_action_class"))
            .map(p => p.key);
        expect(notNarrow.sort()).toEqual([
            "isLowRiskRoutineTool",
            "isReadOnlyFileTool",
            "isSupervisorJob",
        ]);
    });

    it("separates the unbounded ones from the merely broad ones", () => {
        const unbounded = LIVE_AUTO_APPROVAL_PATTERNS.filter(p => p.unboundedActionClass).map(p => p.key);
        expect(unbounded.sort()).toEqual(["isSupervisorJob"]);

        const broad = LIVE_AUTO_APPROVAL_PATTERNS
            .filter(p => !p.unboundedActionClass && p.actionClasses.length > 1)
            .map(p => `${p.key}(${p.actionClasses.length})`);
        expect(broad.sort()).toEqual(["isLowRiskRoutineTool(7)", "isReadOnlyFileTool(5)"]);
    });

    it("identifies the two predicates whose scope is pinned in code", () => {
        const pinned = LIVE_AUTO_APPROVAL_PATTERNS
            .filter(p => evaluatePolicyEligibility(p, noRecords).blockers.includes("scope_declared_not_hardcoded"))
            .map(p => p.key);
        expect(pinned.sort()).toEqual(["isAutoApprovedForgeBuild", "isSupervisorJob"]);
    });

    it("uses the spec's documented thresholds", () => {
        expect(DEFAULT_ELIGIBILITY_THRESHOLDS).toEqual({
            minResolvedRequests: 30,
            minObservationDays: 14,
        });
    });
});
