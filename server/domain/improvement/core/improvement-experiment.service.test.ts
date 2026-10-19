import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Behavioural tests over a small in-memory stand-in for the two tables.
 *
 * The point is the service's rules, not Drizzle: that approval binds to the
 * criteria approved, that a caller cannot assert its own verdict, and that a
 * disposition stays a human act.
 */

interface Row { [k: string]: any }

const experiments: Row[] = [];
const results: Row[] = [];
let nextId = 1;

function matches(row: Row, conditions: any[]): boolean {
    return conditions.every(c => row[c.field] === c.value);
}

/** Collects `eq(column, value)` calls into plain {field,value} pairs. */
vi.mock("drizzle-orm", () => ({
    and: (...conds: any[]) => conds.filter(Boolean),
    eq: (col: any, value: any) => ({ field: col.__name, value }),
    desc: (col: any) => col,
}));

vi.mock("@shared/schema/improvement/index.js", () => {
    const col = (name: string) => ({ __name: name });
    return {
        improvementExperiments: {
            __table: "experiments",
            id: col("id"), organizationId: col("organizationId"),
            opportunityId: col("opportunityId"), status: col("status"),
            createdAt: col("createdAt"),
        },
        improvementResults: {
            __table: "results",
            id: col("id"), organizationId: col("organizationId"),
            experimentId: col("experimentId"), computedAt: col("computedAt"),
        },
    };
});

vi.mock("@server/database_service.js", () => {
    const tableOf = (t: any) => (t.__table === "results" ? results : experiments);
    return {
        db: {
            select: () => ({
                from: (t: any) => ({
                    where: (conds: any[]) => {
                        const rows = tableOf(t).filter(r => matches(r, conds));
                        return Object.assign(Promise.resolve(rows), {
                            orderBy: () => Promise.resolve(rows),
                        });
                    },
                }),
            }),
            insert: (t: any) => ({
                values: (v: Row) => ({
                    returning: async () => {
                        const row = { id: nextId++, ...v };
                        tableOf(t).push(row);
                        return [row];
                    },
                }),
            }),
            update: (t: any) => ({
                set: (patch: Row) => ({
                    where: (conds: any[]) => {
                        const rows = tableOf(t).filter(r => matches(r, conds));
                        rows.forEach(r => Object.assign(r, patch));
                        return Object.assign(Promise.resolve(rows), {
                            returning: async () => rows,
                        });
                    },
                }),
            }),
        },
    };
});

const { improvementExperimentService } = await import("./improvement-experiment.service.js");

const human = { type: "user" as const, id: "u-1", hasApprovalAuthority: true };
const humanNoAuth = { type: "user" as const, id: "u-2" };
const agent = { type: "agent" as const, id: "a-1", hasApprovalAuthority: true };

function completeDraft() {
    return {
        opportunityId: 1,
        hypothesisId: 1,
        baselineDefinition: "median wait over 30 days",
        baselineWindowStart: new Date("2026-07-01"),
        baselineWindowEnd: new Date("2026-07-31"),
        intervention: "auto-route low-risk cases",
        startsAt: new Date("2026-08-01"),
        endsAt: new Date("2026-08-15"),
        primaryMetric: "wait_duration_ms",
        primaryMetricDirection: "decrease" as const,
        minimumEffect: 500,
        minimumSampleSize: 20,
        guardrails: [{ metric: "rework_rate", degradesWhen: "increase" as const, maxDegradation: 2 }],
        stopConditions: { haltOnGuardrailBreach: true, manual: [] },
        rollbackPlan: "restore prior routing",
        requiredApproverRole: "operations_owner",
        boundaries: {
            maxCases: 20, maxBudgetUsd: 50,
            permittedExternalActions: ["none"], permittedTools: [], permittedDatasets: [],
        },
    };
}

async function approvedExperiment() {
    const created = await improvementExperimentService.create(42, completeDraft() as any);
    await improvementExperimentService.requestApproval(42, created.id);
    return improvementExperimentService.approve(42, created.id, human);
}

beforeEach(() => {
    experiments.length = 0;
    results.length = 0;
    nextId = 1;
});

describe("approval", () => {
    it("refuses to approve a draft that never requested approval", async () => {
        const created = await improvementExperimentService.create(42, completeDraft() as any);
        await expect(improvementExperimentService.approve(42, created.id, human)).rejects.toThrow(
            /only a pending_approval experiment/i,
        );
    });

    it("refuses an incomplete experiment at the request step, listing every gap", async () => {
        const created = await improvementExperimentService.create(42, {
            opportunityId: 1, hypothesisId: 1,
            baselineDefinition: "x", intervention: "y",
            primaryMetric: "m", primaryMetricDirection: "decrease",
            requiredApproverRole: "role",
        } as any);
        await expect(improvementExperimentService.requestApproval(42, created.id)).rejects.toThrow(
            /not fully pre-registered/i,
        );
    });

    it("refuses an agent, even one claiming authority", async () => {
        const created = await improvementExperimentService.create(42, completeDraft() as any);
        await improvementExperimentService.requestApproval(42, created.id);
        await expect(improvementExperimentService.approve(42, created.id, agent)).rejects.toThrow(
            /reserved to an authorized human/i,
        );
    });

    it("refuses a human without authority", async () => {
        const created = await improvementExperimentService.create(42, completeDraft() as any);
        await improvementExperimentService.requestApproval(42, created.id);
        await expect(improvementExperimentService.approve(42, created.id, humanNoAuth)).rejects.toThrow(
            /does not hold the authority/i,
        );
    });

    it("records who approved it and when", async () => {
        const approved = await approvedExperiment();
        expect(approved.status).toBe("approved");
        expect(approved.approvedBy).toBe("u-1");
        expect(approved.approvedAt).toBeInstanceOf(Date);
    });
});

describe("approval binds to the criteria that were approved", () => {
    // Consent attaches to what was reviewed, not to a row id.
    it("returns an approved experiment to draft when a criterion is edited", async () => {
        const approved = await approvedExperiment();
        const edited = await improvementExperimentService.update(42, approved.id, {
            minimumEffect: 1,
        } as any);

        expect(edited.status).toBe("draft");
        expect(edited.approvedBy).toBeNull();
        expect(edited.approvedAt).toBeNull();
    });

    it("leaves approval intact when a non-binding field changes", async () => {
        const approved = await approvedExperiment();
        const edited = await improvementExperimentService.update(42, approved.id, {
            missionId: 99,
        } as any);
        expect(edited.status).toBe("approved");
        expect(edited.approvedBy).toBe("u-1");
    });

    it("refuses to edit a running experiment at all", async () => {
        const approved = await approvedExperiment();
        await improvementExperimentService.launch(42, approved.id, 7);
        await expect(
            improvementExperimentService.update(42, approved.id, { minimumEffect: 1 } as any),
        ).rejects.toThrow(/fixed for the duration/i);
    });
});

describe("launch", () => {
    it("refuses to launch an unapproved experiment", async () => {
        const created = await improvementExperimentService.create(42, completeDraft() as any);
        await expect(improvementExperimentService.launch(42, created.id, 7)).rejects.toThrow(
            /only an approved experiment may launch/i,
        );
    });

    it("binds the run to its mission", async () => {
        const approved = await approvedExperiment();
        const running = await improvementExperimentService.launch(42, approved.id, 7, 8);
        expect(running.status).toBe("running");
        expect(running.missionId).toBe(7);
        expect(running.shadowMissionId).toBe(8);
    });
});

describe("results", () => {
    async function runningExperiment() {
        const approved = await approvedExperiment();
        return improvementExperimentService.launch(42, approved.id, 7);
    }

    const cleanPass = {
        ran: true,
        baselineValue: 5000, baselineSampleCount: 100,
        interventionValue: 4000, interventionSampleCount: 25,
        executionFailureCount: 0, policyStopCount: 0,
        guardrailMeasurements: { rework_rate: { baseline: 10, intervention: 10 } },
    };

    it("computes the verdict rather than accepting one", async () => {
        const running = await runningExperiment();
        const result = await improvementExperimentService.recordResult(42, running.id, cleanPass as any);
        expect(result.criterionOutcome).toBe("passed");
        expect(result.classification).toBe("hypothesis_supported");
        expect(result.verdictReasons.length).toBeGreaterThan(0);
    });

    // A caller supplies numbers, never an outcome.
    it("ignores any outcome a caller tries to supply", async () => {
        const running = await runningExperiment();
        const result = await improvementExperimentService.recordResult(42, running.id, {
            ...cleanPass,
            interventionValue: 4990,
            criterionOutcome: "passed",
            classification: "hypothesis_supported",
        } as any);
        expect(result.criterionOutcome).toBe("failed");
        expect(result.classification).toBe("hypothesis_not_supported");
    });

    it("keeps an execution failure out of the hypothesis verdict", async () => {
        const running = await runningExperiment();
        const result = await improvementExperimentService.recordResult(42, running.id, {
            ...cleanPass, executionFailureCount: 20, interventionSampleCount: 3,
        } as any);
        expect(result.criterionOutcome).toBe("inconclusive");
        expect(result.classification).toBe("execution_failure");
    });

    it("refuses results on an experiment that never ran", async () => {
        const created = await improvementExperimentService.create(42, completeDraft() as any);
        await expect(
            improvementExperimentService.recordResult(42, created.id, cleanPass as any),
        ).rejects.toThrow(/results attach to a run/i);
    });

    it("completes the experiment once a result is attached", async () => {
        const running = await runningExperiment();
        await improvementExperimentService.recordResult(42, running.id, cleanPass as any);
        expect((await improvementExperimentService.get(42, running.id)).status).toBe("completed");
    });
});

describe("disposition", () => {
    it("refuses an agent", async () => {
        results.push({ id: 500, organizationId: 42, experimentId: 1 });
        await expect(
            improvementExperimentService.setDisposition(42, 500, agent, "promote", "looks good"),
        ).rejects.toThrow(/human decision/i);
    });

    it("requires a rationale, not just a decision", async () => {
        results.push({ id: 501, organizationId: 42, experimentId: 1 });
        await expect(
            improvementExperimentService.setDisposition(42, 501, human, "promote", "   "),
        ).rejects.toThrow(/decision and a rationale/i);
    });

    // The record must show both what was measured and what was decided, even
    // when they disagree.
    it("records a human decision that departs from the verdict", async () => {
        results.push({
            id: 502, organizationId: 42, experimentId: 1,
            criterionOutcome: "failed", classification: "hypothesis_not_supported",
        });
        const row = await improvementExperimentService.setDisposition(
            42, 502, human, "revise", "effect was short but the direction is right",
        );
        expect(row.disposition).toBe("revise");
        expect(row.dispositionBy).toBe("u-1");
        expect(row.criterionOutcome).toBe("failed");
    });
});
