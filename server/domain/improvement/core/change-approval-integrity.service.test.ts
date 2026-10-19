import { describe, it, expect } from "vitest";

import type { ImprovementChangeSet } from "@shared/schema/improvement/index.js";
import {
    computeChangeSetHash,
    verifyApprovalIntegrity,
    assertApprovalIntegrity,
    ApprovalIntegrityError,
    type ResolvedApproval,
} from "./change-approval-integrity.service.js";

const OPERATIONS = [
    { kind: "update_recurrence" as const, path: "schedule", payload: { cron: "0 3 * * *" } },
];

function changeSet(over: Partial<ImprovementChangeSet> = {}): ImprovementChangeSet {
    const base = {
        targetType: "cycle_schedule" as const,
        targetId: "cycle-7",
        expectedVersion: "v3",
        operations: OPERATIONS,
    };
    return {
        id: 1,
        organizationId: 42,
        projectId: null,
        opportunityId: 1,
        ...base,
        reason: "reduce overlap with the nightly window",
        evidenceIds: [1, 2],
        validationPlan: {},
        rolloutPlan: {},
        rollbackPlan: { restore: "v3" },
        status: "approved",
        contentHash: computeChangeSetHash(base),
        approvalRequestId: 99,
        approvedContentHash: computeChangeSetHash(base),
        approvedBy: "u-7",
        approvedAt: new Date("2026-08-25T10:00:00Z"),
        approvalExpiresAt: null,
        selectedRemediation: null,
        appliedAt: null, verifiedAt: null, rolledBackAt: null, failureReason: null,
        createdBy: "agent-1",
        createdAt: new Date(), updatedAt: new Date(),
        ...over,
    } as ImprovementChangeSet;
}

function approval(over: Partial<ResolvedApproval> = {}): ResolvedApproval {
    return {
        id: 99,
        organizationId: 42,
        projectId: null,
        approvedContentHash: computeChangeSetHash({
            targetType: "cycle_schedule",
            targetId: "cycle-7",
            expectedVersion: "v3",
            operations: OPERATIONS,
        }),
        decision: "approved",
        decidedAt: new Date("2026-08-25T10:00:00Z"),
        approverId: "u-7",
        approverHasAuthority: true,
        expiresAt: null,
        revokedAt: null,
        selectedRemediation: null,
        ...over,
    };
}

function codes(result: ReturnType<typeof verifyApprovalIntegrity>) {
    return result.ok ? [] : result.failures.map(f => f.code);
}

describe("computeChangeSetHash", () => {
    it("is stable and order-independent", () => {
        const a = computeChangeSetHash({
            targetType: "cycle_schedule", targetId: "c", expectedVersion: "v1",
            operations: [{ kind: "update_limits", payload: { b: 2, a: 1 } }],
        });
        const b = computeChangeSetHash({
            targetType: "cycle_schedule", targetId: "c", expectedVersion: "v1",
            operations: [{ kind: "update_limits", payload: { a: 1, b: 2 } }],
        });
        expect(a).toBe(b);
    });

    it("changes when an operation changes", () => {
        const a = computeChangeSetHash({ targetType: "t", targetId: "c", expectedVersion: "v1", operations: OPERATIONS });
        const b = computeChangeSetHash({
            targetType: "t", targetId: "c", expectedVersion: "v1",
            operations: [{ kind: "update_recurrence", payload: { cron: "0 4 * * *" } }],
        });
        expect(a).not.toBe(b);
    });

    it("changes when the target or expected version changes", () => {
        const base = { targetType: "t", targetId: "c", expectedVersion: "v1", operations: OPERATIONS };
        expect(computeChangeSetHash(base)).not.toBe(computeChangeSetHash({ ...base, targetId: "d" }));
        expect(computeChangeSetHash(base)).not.toBe(computeChangeSetHash({ ...base, expectedVersion: "v2" }));
    });
});

describe("verifyApprovalIntegrity", () => {
    it("permits a fully valid apply", () => {
        const r = verifyApprovalIntegrity({
            changeSet: changeSet(), approval: approval(), currentTargetVersion: "v3",
        });
        expect(r.ok).toBe(true);
    });

    describe("the adversarial cases §17 names", () => {
        // "an approval timestamp is forged in an executor payload"
        it("refuses when no approval record resolves, however complete the payload looks", () => {
            const forged = changeSet({
                approvedBy: "super-admin",
                approvedAt: new Date(),
                approvedContentHash: computeChangeSetHash({
                    targetType: "cycle_schedule", targetId: "cycle-7", expectedVersion: "v3", operations: OPERATIONS,
                }),
            });
            const r = verifyApprovalIntegrity({ changeSet: forged, approval: null, currentTargetVersion: "v3" });
            expect(codes(r)).toContain("NO_APPROVAL_RECORD");
            if (!r.ok) {
                expect(r.failures.find(f => f.code === "NO_APPROVAL_RECORD")!.reason)
                    .toMatch(/is not authority/);
            }
        });

        // "a stale blueprint client overwrites a newer version"
        it("refuses a stale target version", () => {
            const r = verifyApprovalIntegrity({
                changeSet: changeSet(), approval: approval(), currentTargetVersion: "v4",
            });
            expect(codes(r)).toContain("STALE_TARGET_VERSION");
        });

        // Approval binds to a hash, so editing the operations voids it.
        it("refuses when the operations changed after approval", () => {
            const edited = changeSet({
                operations: [{ kind: "update_recurrence", payload: { cron: "*/5 * * * *" } }],
            });
            const r = verifyApprovalIntegrity({
                changeSet: edited, approval: approval(), currentTargetVersion: "v3",
            });
            expect(codes(r)).toContain("HASH_MISMATCH");
        });

        // The stored hash cannot vouch for itself.
        it("recomputes the hash rather than trusting the stored one", () => {
            const tampered = changeSet({
                operations: [{ kind: "remove_mission", payload: { missionId: 3 } }],
                // Stored hash still claims the original operations.
                contentHash: computeChangeSetHash({
                    targetType: "cycle_schedule", targetId: "cycle-7", expectedVersion: "v3", operations: OPERATIONS,
                }),
            });
            const r = verifyApprovalIntegrity({
                changeSet: tampered, approval: approval(), currentTargetVersion: "v3",
            });
            expect(codes(r)).toContain("HASH_MISMATCH");
        });

        // §9.2: applying the original after a remediation was chosen.
        it("refuses when the applied change is not the remediation that was selected", () => {
            const r = verifyApprovalIntegrity({
                changeSet: changeSet({ selectedRemediation: null }),
                approval: approval({ selectedRemediation: "narrow-to-low-risk-cases" }),
                currentTargetVersion: "v3",
            });
            expect(codes(r)).toContain("REMEDIATION_MISMATCH");
        });

        it("refuses a cross-organization approval", () => {
            const r = verifyApprovalIntegrity({
                changeSet: changeSet(), approval: approval({ organizationId: 99 }), currentTargetVersion: "v3",
            });
            expect(codes(r)).toContain("ORG_MISMATCH");
        });

        it("refuses a cross-project approval", () => {
            const r = verifyApprovalIntegrity({
                changeSet: changeSet({ projectId: 5 }), approval: approval({ projectId: 6 }), currentTargetVersion: "v3",
            });
            expect(codes(r)).toContain("PROJECT_MISMATCH");
        });
    });

    describe("decision state", () => {
        it.each(["pending", "rejected", "snoozed", "expired"])("refuses a '%s' decision", (decision) => {
            const r = verifyApprovalIntegrity({
                changeSet: changeSet(), approval: approval({ decision }), currentTargetVersion: "v3",
            });
            expect(codes(r)).toContain("NOT_TERMINAL_APPROVAL");
        });

        it("refuses an approval with no decision time", () => {
            const r = verifyApprovalIntegrity({
                changeSet: changeSet(), approval: approval({ decidedAt: null }), currentTargetVersion: "v3",
            });
            expect(codes(r)).toContain("NOT_TERMINAL_APPROVAL");
        });

        it("refuses a revoked approval", () => {
            const r = verifyApprovalIntegrity({
                changeSet: changeSet(),
                approval: approval({ revokedAt: new Date("2026-08-25T11:00:00Z") }),
                currentTargetVersion: "v3",
            });
            expect(codes(r)).toContain("APPROVAL_REVOKED");
        });

        it("refuses an expired approval", () => {
            const r = verifyApprovalIntegrity({
                changeSet: changeSet(),
                approval: approval({ expiresAt: new Date("2026-08-25T11:00:00Z") }),
                currentTargetVersion: "v3",
                now: new Date("2026-08-25T12:00:00Z"),
            });
            expect(codes(r)).toContain("APPROVAL_EXPIRED");
        });

        it("accepts an approval that has not yet expired", () => {
            const r = verifyApprovalIntegrity({
                changeSet: changeSet(),
                approval: approval({ expiresAt: new Date("2026-08-26T00:00:00Z") }),
                currentTargetVersion: "v3",
                now: new Date("2026-08-25T12:00:00Z"),
            });
            expect(r.ok).toBe(true);
        });

        it("refuses an approver without authority", () => {
            const r = verifyApprovalIntegrity({
                changeSet: changeSet(), approval: approval({ approverHasAuthority: false }), currentTargetVersion: "v3",
            });
            expect(codes(r)).toContain("APPROVER_LACKS_AUTHORITY");
        });

        it("refuses an approval that records no hash at all", () => {
            const r = verifyApprovalIntegrity({
                changeSet: changeSet(), approval: approval({ approvedContentHash: null }), currentTargetVersion: "v3",
            });
            expect(codes(r)).toContain("HASH_MISMATCH");
        });
    });

    describe("status", () => {
        it.each(["draft", "validated", "applied", "rolled_back", "failed"] as const)(
            "refuses to apply from '%s'",
            (status) => {
                const r = verifyApprovalIntegrity({
                    changeSet: changeSet({ status }), approval: approval(), currentTargetVersion: "v3",
                });
                expect(codes(r)).toContain("WRONG_STATUS");
            },
        );
    });

    it("reports every failure at once, not just the first", () => {
        const r = verifyApprovalIntegrity({
            changeSet: changeSet({ status: "draft", projectId: 1 }),
            approval: approval({ organizationId: 99, approverHasAuthority: false, decision: "pending" }),
            currentTargetVersion: "v9",
        });
        expect(codes(r).length).toBeGreaterThanOrEqual(5);
    });

    it("throws a typed error carrying the failures", () => {
        try {
            assertApprovalIntegrity({ changeSet: changeSet(), approval: null, currentTargetVersion: "v3" });
            throw new Error("expected a refusal");
        } catch (err) {
            expect(err).toBeInstanceOf(ApprovalIntegrityError);
            expect((err as ApprovalIntegrityError).failures.length).toBeGreaterThan(0);
        }
    });
});
