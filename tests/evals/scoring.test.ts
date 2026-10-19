import { describe, it, expect } from "vitest";
import { evalScenarioSchema, evalBaselineSchema } from "@shared/contracts/index.js";
import {
    subjectKey,
    scoreRepeat,
    scoreScenario,
    aggregateSubjects,
    evaluateGate,
    type ScenarioResult,
} from "./scoring.js";

const scenario = (over: Record<string, any> = {}) =>
    evalScenarioSchema.parse({
        id: "s1",
        name: "S1",
        prompt: "do the thing",
        subject: { kind: "capability", ref: "write_file" },
        criteria: [
            { type: "tool_used", value: "write_file", weight: 3 },
            { type: "final_output_contains", value: "done", weight: 1 },
        ],
        ...over,
    });

describe("evalScenarioSchema", () => {
    it("is backward compatible with legacy expected_criteria + no subject", () => {
        const s = evalScenarioSchema.parse({
            id: "legacy",
            name: "Legacy",
            prompt: "p",
            expected_criteria: [{ type: "tool_used", value: "google_search" }],
        });
        expect(s.subject).toEqual({ kind: "mission-type", ref: "legacy" });
        expect(s.repeats).toBe(1);
        expect(s.threshold).toBe(1);
        expect(s.criteria[0].weight).toBe(1); // default
    });

    it("rejects a scenario with no criteria", () => {
        expect(() => evalScenarioSchema.parse({ id: "x", name: "x", prompt: "p" })).toThrow();
    });
});

describe("scoreRepeat", () => {
    it("computes a weighted score", () => {
        const s = scenario();
        // tool_used (w3) passed, output_contains (w1) failed => 3/4
        expect(scoreRepeat(s.criteria, [true, false]).score).toBeCloseTo(0.75);
    });

    it("is 1 when all pass and 0 when all fail", () => {
        const s = scenario();
        expect(scoreRepeat(s.criteria, [true, true]).score).toBe(1);
        expect(scoreRepeat(s.criteria, [false, false]).score).toBe(0);
    });

    it("throws on outcome/criteria length mismatch", () => {
        const s = scenario();
        expect(() => scoreRepeat(s.criteria, [true])).toThrow();
    });
});

describe("scoreScenario", () => {
    it("averages repeat scores into a pass-rate and reports variance", () => {
        const s = scenario({ repeats: 2, threshold: 0.8 });
        const r = scoreScenario(s, [
            { score: 1, criteria: [] },
            { score: 0.5, criteria: [] },
        ]);
        expect(r.passRate).toBeCloseTo(0.75);
        expect(r.passed).toBe(false); // 0.75 < 0.8
        expect(r.variance).toBeGreaterThan(0);
        expect(r.subjectKey).toBe("capability:write_file");
    });

    it("legacy threshold of 1 means all criteria must pass", () => {
        const s = scenario({ threshold: 1 });
        expect(scoreScenario(s, [{ score: 1, criteria: [] }]).passed).toBe(true);
        expect(scoreScenario(s, [{ score: 0.75, criteria: [] }]).passed).toBe(false);
    });
});

describe("aggregateSubjects", () => {
    it("means scenario pass-rates per subject", () => {
        const mk = (key: string, ref: string, pr: number): ScenarioResult => ({
            scenarioId: key,
            subject: { kind: "capability", ref },
            subjectKey: `capability:${ref}`,
            repeats: 1,
            passRate: pr,
            threshold: 0.8,
            passed: pr >= 0.8,
            variance: 0,
            repeatOutcomes: [],
        });
        const agg = aggregateSubjects([
            mk("a", "write_file", 1),
            mk("b", "write_file", 0.5),
            mk("c", "github_pr", 0.9),
        ]);
        const wf = agg.find((a) => a.subjectKey === "capability:write_file")!;
        expect(wf.passRate).toBeCloseTo(0.75);
        expect(wf.scenarioCount).toBe(2);
        expect(agg).toHaveLength(2);
    });
});

describe("evaluateGate", () => {
    const baseline = evalBaselineSchema.parse({
        regressionDelta: 0.05,
        defaultThreshold: 0.8,
        subjects: [{ subjectKey: "capability:write_file", passRate: 0.9, threshold: 0.8 }],
    });

    it("passes when current holds steady", () => {
        const report = evaluateGate(
            [{ subjectKey: "capability:write_file", subject: { kind: "capability", ref: "write_file" }, passRate: 0.9, scenarioCount: 2 }],
            baseline,
        );
        expect(report.ok).toBe(true);
        expect(report.findings).toHaveLength(0);
    });

    it("flags a regression beyond delta", () => {
        const report = evaluateGate(
            [{ subjectKey: "capability:write_file", subject: { kind: "capability", ref: "write_file" }, passRate: 0.80, scenarioCount: 2 }],
            baseline,
        );
        // 0.80 is >= threshold 0.8 (no below_threshold) but 0.90-0.80=0.10 > delta 0.05 => regression
        expect(report.ok).toBe(false);
        expect(report.findings.some((f) => f.kind === "regression")).toBe(true);
    });

    it("flags below-threshold for a new subject with no baseline", () => {
        const report = evaluateGate(
            [{ subjectKey: "capability:github_pr", subject: { kind: "capability", ref: "github_pr" }, passRate: 0.5, scenarioCount: 1 }],
            baseline,
        );
        expect(report.ok).toBe(false);
        expect(report.findings[0].kind).toBe("below_threshold");
    });

    it("allows a small dip within delta and above threshold", () => {
        const report = evaluateGate(
            [{ subjectKey: "capability:write_file", subject: { kind: "capability", ref: "write_file" }, passRate: 0.87, scenarioCount: 2 }],
            baseline,
        );
        expect(report.ok).toBe(true);
    });
});

describe("subjectKey", () => {
    it("formats kind:ref", () => {
        expect(subjectKey({ kind: "skill", ref: "youtube_research" })).toBe("skill:youtube_research");
    });
});

describe("evaluateGate — coverage", () => {
    const baseline = {
        updatedAt: "2026-08-28",
        commit: "test",
        regressionDelta: 0.05,
        defaultThreshold: 0.8,
        subjects: [
            { subjectKey: "capability:write_file", passRate: 0.9, threshold: 0.8 },
            { subjectKey: "capability:generate_pdf", passRate: 0.9, threshold: 0.8 },
        ],
    } as any;

    it("fails when the run produced no results at all", () => {
        // Every scenario throwing writes an empty result set. This used to
        // report "Subjects checked: 0 — PASS", so a nightly that measured
        // nothing went green.
        const report = evaluateGate([], baseline);

        expect(report.ok).toBe(false);
        expect(report.findings).toHaveLength(2);
        expect(report.findings.every((f) => f.kind === "not_measured")).toBe(true);
    });

    it("fails when one baseline subject is missing from the results", () => {
        const report = evaluateGate(
            [{ subjectKey: "capability:write_file", passRate: 0.95, total: 20, passed: 19 } as any],
            baseline,
        );

        expect(report.ok).toBe(false);
        const missing = report.findings.filter((f) => f.kind === "not_measured");
        expect(missing.map((f) => f.subjectKey)).toEqual(["capability:generate_pdf"]);
    });

    it("passes when every baseline subject was measured and healthy", () => {
        const report = evaluateGate(
            [
                { subjectKey: "capability:write_file", passRate: 0.95, total: 20, passed: 19 } as any,
                { subjectKey: "capability:generate_pdf", passRate: 0.9, total: 20, passed: 18 } as any,
            ],
            baseline,
        );

        expect(report.ok).toBe(true);
        expect(report.findings).toHaveLength(0);
    });

    it("does not require a baseline entry for a newly added subject", () => {
        const report = evaluateGate(
            [
                { subjectKey: "capability:write_file", passRate: 0.95, total: 20, passed: 19 } as any,
                { subjectKey: "capability:generate_pdf", passRate: 0.9, total: 20, passed: 18 } as any,
                { subjectKey: "capability:brand_new", passRate: 0.85, total: 20, passed: 17 } as any,
            ],
            baseline,
        );

        // A new subject is held to defaultThreshold, but its absence from the
        // baseline is not itself a failure.
        expect(report.ok).toBe(true);
    });
});
