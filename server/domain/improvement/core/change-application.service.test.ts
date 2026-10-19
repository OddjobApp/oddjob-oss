import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The apply pipeline's guarantees, tested as behaviour rather than structure.
 *
 * The ones that matter most, and that a refactor could quietly lose:
 *   - disabled means REFUSE, never fall through to a direct mutation;
 *   - no mutator registered means nothing is mutable;
 *   - the target is never touched until both gates pass;
 *   - a failed verification rolls back, and a failed ROLLBACK leaves the target
 *     paused rather than resumed.
 */

const changeSets: any[] = [];
const versions: any[] = [];

/** `where()` receives either an `and(...)` array or a bare `eq(...)`. */
function asConditions(conds: any): any[] {
    return Array.isArray(conds) ? conds : conds ? [conds] : [];
}

function matches(row: any, conds: any): boolean {
    return asConditions(conds).every(c => row[c.field] === c.value);
}

vi.mock("drizzle-orm", () => ({
    and: (...c: any[]) => c.filter(Boolean),
    eq: (col: any, value: any) => ({ field: col.__name, value }),
    desc: (c: any) => c,
    isNotNull: (col: any) => ({ field: col.__name, notNull: true }),
}));

vi.mock("@shared/schema/improvement/index.js", () => {
    const col = (name: string) => ({ __name: name });
    return {
        improvementChangeSets: {
            __table: "changeSets",
            id: col("id"), organizationId: col("organizationId"), status: col("status"),
        },
        improvementTargetVersions: {
            __table: "versions",
            id: col("id"), organizationId: col("organizationId"), targetType: col("targetType"),
            targetId: col("targetId"), versionNumber: col("versionNumber"), verifiedAt: col("verifiedAt"),
        },
    };
});

vi.mock("@server/database_service.js", () => {
    const tableOf = (t: any) => (t.__table === "versions" ? versions : changeSets);
    let nextId = 1;
    return {
        db: {
            select: () => ({
                from: (t: any) => ({
                    where: (raw: any) => {
                        const conds = asConditions(raw);
                        const plain = conds.filter((c: any) => !c.notNull);
                        const notNulls = conds.filter((c: any) => c.notNull);
                        const rows = tableOf(t).filter(r =>
                            matches(r, plain) && notNulls.every((c: any) => r[c.field] != null));
                        const p: any = Promise.resolve(rows);
                        p.orderBy = () => {
                            const sorted = [...rows].sort((a, b) => (b.versionNumber ?? 0) - (a.versionNumber ?? 0));
                            const q: any = Promise.resolve(sorted);
                            q.limit = () => Promise.resolve(sorted);
                            return q;
                        };
                        p.limit = () => Promise.resolve(rows);
                        return p;
                    },
                }),
            }),
            insert: (t: any) => ({
                values: (v: any) => ({
                    returning: async () => { const row = { id: 200 + nextId++, ...v }; tableOf(t).push(row); return [row]; },
                }),
            }),
            update: (t: any) => ({
                set: (patch: any) => ({
                    where: (conds: any[]) => {
                        const rows = tableOf(t).filter(r => matches(r, conds));
                        rows.forEach(r => Object.assign(r, patch));
                        const p: any = Promise.resolve(rows);
                        p.returning = async () => rows;
                        return p;
                    },
                }),
            }),
        },
    };
});

const {
    changeApplicationService, registerTargetMutator, clearTargetMutators,
    registeredMutatorTypes, changeSetsEnabled,
} = await import("./change-application.service.js");
const { computeChangeSetHash } = await import("./change-approval-integrity.service.js");

const OPERATIONS = [{ kind: "remove_mission" as const, payload: { missionId: "notify" } }];
const HASH = computeChangeSetHash({
    targetType: "cycle_blueprint", targetId: "c1", expectedVersion: "v1", operations: OPERATIONS,
});

function seedChangeSet(over: any = {}) {
    changeSets.push({
        id: 1, organizationId: 42, projectId: null, opportunityId: null,
        targetType: "cycle_blueprint", targetId: "c1", expectedVersion: "v1",
        reason: "r", evidenceIds: [], operations: OPERATIONS,
        validationPlan: {}, rolloutPlan: {}, rollbackPlan: {},
        status: "approved", contentHash: HASH,
        approvalRequestId: 7, approvedContentHash: HASH, approvedBy: "u", approvedAt: new Date(),
        approvalExpiresAt: null, selectedRemediation: null,
        appliedAt: null, verifiedAt: null, rolledBackAt: null, failureReason: null,
        createdBy: "t", createdAt: new Date(), updatedAt: new Date(),
        ...over,
    });
}

function seedVersion(verified = true) {
    versions.push({
        id: 100, organizationId: 42, targetType: "cycle_blueprint", targetId: "c1",
        versionNumber: 1, contentHash: "h", snapshot: { missions: [{ id: "notify", role: "work" }] },
        source: "runtime_customization", producedByChangeSetId: null,
        verifiedAt: verified ? new Date() : null, createdBy: "t", createdAt: new Date(),
    });
}

const approval = () => ({
    id: 7, organizationId: 42, projectId: null, approvedContentHash: HASH,
    decision: "approved" as const, decidedAt: new Date(), approverId: "u",
    approverHasAuthority: true, expiresAt: null, revokedAt: null, selectedRemediation: null,
});

function fakeMutator(over: Record<string, unknown> = {}) {
    return {
        targetType: "cycle_blueprint" as const,
        snapshot: vi.fn(async () => ({ missions: [{ id: "notify", role: "work" as const }] })),
        runtimeState: vi.fn(async () => ({ activeMissionIds: [], hasActiveExecution: false })),
        quiesce: vi.fn(async () => true),
        apply: vi.fn(async () => {}),
        verify: vi.fn(async () => true),
        restore: vi.fn(async () => {}),
        resume: vi.fn(async () => {}),
        ...over,
    };
}

const run = () => changeApplicationService.apply({
    organizationId: 42, changeSetId: 1, resolveApproval: async () => approval() as any,
});

beforeEach(() => {
    changeSets.length = 0;
    versions.length = 0;
    clearTargetMutators();
    process.env.IMPROVEMENT_CHANGE_SETS_ENABLED = "true";
});

afterEach(() => {
    delete process.env.IMPROVEMENT_CHANGE_SETS_ENABLED;
});

describe("the flag defaults off and refuses", () => {
    it.each(["false", "1", "yes", "TRUE"])("is disabled when the flag is '%s'", (v) => {
        process.env.IMPROVEMENT_CHANGE_SETS_ENABLED = v;
        expect(changeSetsEnabled()).toBe(false);
    });

    it("is disabled when the flag is unset", () => {
        delete process.env.IMPROVEMENT_CHANGE_SETS_ENABLED;
        expect(changeSetsEnabled()).toBe(false);
    });

    it("is enabled only for the exact string 'true'", () => {
        process.env.IMPROVEMENT_CHANGE_SETS_ENABLED = "true";
        expect(changeSetsEnabled()).toBe(true);
    });

    // The disabled path must not degrade into the unguarded version.
    it("refuses without touching the target", async () => {
        delete process.env.IMPROVEMENT_CHANGE_SETS_ENABLED;
        seedChangeSet();
        const mutator = fakeMutator();
        registerTargetMutator(mutator as any);

        const out = await run();
        expect(out).toMatchObject({ status: "refused", code: "FEATURE_DISABLED" });
        expect(mutator.apply).not.toHaveBeenCalled();
        expect(mutator.quiesce).not.toHaveBeenCalled();
    });
});

describe("nothing is mutable until a mutator is registered", () => {
    it("ships with an empty registry", () => {
        expect(registeredMutatorTypes()).toEqual([]);
    });

    it("refuses with NO_MUTATOR", async () => {
        seedChangeSet();
        const out = await run();
        expect(out).toMatchObject({ status: "refused", code: "NO_MUTATOR" });
    });
});

describe("gates run before the target is touched", () => {
    it("refuses on approval integrity and never quiesces", async () => {
        seedChangeSet();
        const mutator = fakeMutator();
        registerTargetMutator(mutator as any);

        const out = await changeApplicationService.apply({
            organizationId: 42, changeSetId: 1, resolveApproval: async () => null,
        });
        expect(out).toMatchObject({ status: "refused", code: "APPROVAL_INTEGRITY" });
        expect(mutator.quiesce).not.toHaveBeenCalled();
        expect(mutator.apply).not.toHaveBeenCalled();
    });

    it("refuses on structural validation and never applies", async () => {
        seedChangeSet();
        seedVersion();
        const mutator = fakeMutator({
            snapshot: vi.fn(async () => ({ missions: [{ id: "notify", role: "approval" as const }] })),
        });
        registerTargetMutator(mutator as any);

        const out = await run();
        expect(out).toMatchObject({ status: "refused", code: "STRUCTURAL_VALIDATION" });
        expect(mutator.apply).not.toHaveBeenCalled();
    });

    it("refuses when the target cannot be quiesced", async () => {
        seedChangeSet();
        seedVersion();
        const mutator = fakeMutator({ quiesce: vi.fn(async () => false) });
        registerTargetMutator(mutator as any);

        const out = await run();
        expect(out).toMatchObject({ status: "refused", code: "QUIESCE_FAILED" });
        expect(mutator.apply).not.toHaveBeenCalled();
    });
});

describe("the happy path", () => {
    it("quiesces, applies, verifies and resumes", async () => {
        seedChangeSet();
        seedVersion();
        const mutator = fakeMutator();
        registerTargetMutator(mutator as any);

        const out = await run();
        expect(out.status).toBe("verified");
        expect(mutator.quiesce).toHaveBeenCalled();
        expect(mutator.apply).toHaveBeenCalledWith(42, "c1", OPERATIONS);
        expect(mutator.verify).toHaveBeenCalled();
        expect(mutator.resume).toHaveBeenCalled();
        expect(changeSets[0].status).toBe("verified");
    });
});

describe("failure leaves the system safe, not resumed", () => {
    it("rolls back when verification fails", async () => {
        seedChangeSet();
        seedVersion(true);
        const mutator = fakeMutator({ verify: vi.fn(async () => false) });
        registerTargetMutator(mutator as any);

        const out = await run();
        expect(out.status).toBe("rolled_back");
        expect(mutator.restore).toHaveBeenCalled();
        expect(changeSets[0].status).toBe("rolled_back");
    });

    it("rolls back when apply itself throws", async () => {
        seedChangeSet();
        seedVersion(true);
        const mutator = fakeMutator({ apply: vi.fn(async () => { throw new Error("boom"); }) });
        registerTargetMutator(mutator as any);

        const out = await run();
        expect(out.status).toBe("rolled_back");
        if (out.status === "rolled_back") expect(out.reason).toMatch(/boom/);
    });

    // A probe that dies is not a pass.
    it("treats a throwing verify as a failure", async () => {
        seedChangeSet();
        seedVersion(true);
        const mutator = fakeMutator({ verify: vi.fn(async () => { throw new Error("probe died"); }) });
        registerTargetMutator(mutator as any);

        expect((await run()).status).toBe("rolled_back");
    });

    // §9.8: paused until rollback succeeds or a human intervenes.
    it("leaves the target PAUSED when rollback itself fails", async () => {
        seedChangeSet();
        seedVersion(true);
        const mutator = fakeMutator({
            verify: vi.fn(async () => false),
            restore: vi.fn(async () => { throw new Error("restore failed"); }),
        });
        registerTargetMutator(mutator as any);

        const out = await run();
        expect(out.status).toBe("paused_for_human");
        expect(mutator.resume).not.toHaveBeenCalled();
        expect(changeSets[0].status).toBe("failed");
    });

    it("only ever restores a version marked verified", async () => {
        seedChangeSet();
        seedVersion(true);
        const mutator = fakeMutator({ verify: vi.fn(async () => false) });
        registerTargetMutator(mutator as any);

        const out = await run();
        if (out.status === "rolled_back") {
            const restored = versions.find(v => v.id === out.restoredVersionId);
            expect(restored.verifiedAt).not.toBeNull();
        }
    });
});
