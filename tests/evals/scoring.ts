import type {
    EvalScenario,
    EvalSubject,
    EvalBaseline,
    SubjectPassRate,
} from "@shared/contracts/index.js";

/**
 * Pure scoring & gate logic for the eval measurement spine. No I/O, no live
 * mission execution — everything here is deterministic given its inputs, which
 * is what makes the trust currency itself testable.
 */

export function subjectKey(s: EvalSubject): string {
    return `${s.kind}:${s.ref}`;
}

export interface CriterionOutcome {
    type: string;
    value: string;
    weight: number;
    passed: boolean;
}

export interface RepeatOutcome {
    /** Weighted score for this single run, in [0,1]. */
    score: number;
    criteria: CriterionOutcome[];
}

export interface ScenarioResult {
    scenarioId: string;
    subject: EvalSubject;
    subjectKey: string;
    repeats: number;
    /** Mean weighted score across repeats — folds partial credit and jitter. */
    passRate: number;
    threshold: number;
    passed: boolean;
    /** Population variance of the per-repeat scores. */
    variance: number;
    repeatOutcomes: RepeatOutcome[];
}

/**
 * Weighted score for one run: Σ(weight·passed) / Σ(weight). Returns a value in
 * [0,1]. A run with no criteria scores 0.
 */
export function scoreRepeat(
    criteria: EvalScenario["criteria"],
    passedFlags: boolean[],
): RepeatOutcome {
    if (criteria.length !== passedFlags.length) {
        throw new Error(
            `scoreRepeat: ${criteria.length} criteria but ${passedFlags.length} outcomes`,
        );
    }
    let weightSum = 0;
    let hit = 0;
    const outcomes: CriterionOutcome[] = criteria.map((c, i) => {
        const passed = passedFlags[i];
        weightSum += c.weight;
        if (passed) hit += c.weight;
        return { type: c.type, value: c.value, weight: c.weight, passed };
    });
    return { score: weightSum > 0 ? hit / weightSum : 0, criteria: outcomes };
}

function mean(xs: number[]): number {
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function variance(xs: number[]): number {
    if (xs.length < 2) return 0;
    const m = mean(xs);
    return mean(xs.map((x) => (x - m) ** 2));
}

/**
 * Aggregate repeat outcomes for one scenario into a pass-rate. `passRate` is the
 * mean weighted score across repeats; the scenario `passed` iff that meets its
 * threshold.
 */
export function scoreScenario(
    scenario: EvalScenario,
    repeatOutcomes: RepeatOutcome[],
): ScenarioResult {
    const scores = repeatOutcomes.map((r) => r.score);
    const passRate = mean(scores);
    return {
        scenarioId: scenario.id,
        subject: scenario.subject,
        subjectKey: subjectKey(scenario.subject),
        repeats: scenario.repeats,
        passRate,
        threshold: scenario.threshold,
        passed: passRate >= scenario.threshold,
        variance: variance(scores),
        repeatOutcomes,
    };
}

/**
 * Roll scenario results up to one pass-rate per subject (mean across the
 * subject's scenarios).
 */
export function aggregateSubjects(results: ScenarioResult[]): SubjectPassRate[] {
    const byKey = new Map<string, ScenarioResult[]>();
    for (const r of results) {
        const list = byKey.get(r.subjectKey) ?? [];
        list.push(r);
        byKey.set(r.subjectKey, list);
    }
    return [...byKey.entries()].map(([subjectKey, rs]) => ({
        subjectKey,
        subject: rs[0].subject,
        passRate: mean(rs.map((r) => r.passRate)),
        scenarioCount: rs.length,
    }));
}

export type GateFindingKind = "regression" | "below_threshold" | "not_measured";

export interface GateFinding {
    subjectKey: string;
    kind: GateFindingKind;
    current: number;
    baseline?: number;
    threshold?: number;
    delta?: number;
}

export interface GateReport {
    ok: boolean;
    findings: GateFinding[];
    checked: number;
}

/**
 * Compare current per-subject pass-rates against the committed baseline. Fails
 * (ok=false) when any subject drops more than `regressionDelta` below its
 * baseline, or falls below its threshold. Subjects with no baseline entry are
 * held to `defaultThreshold` but cannot regress (nothing to regress from).
 */
export function evaluateGate(
    current: SubjectPassRate[],
    baseline: EvalBaseline,
): GateReport {
    const byKey = new Map(baseline.subjects.map((s) => [s.subjectKey, s]));
    const findings: GateFinding[] = [];

    for (const subj of current) {
        const base = byKey.get(subj.subjectKey);
        const threshold = base?.threshold ?? baseline.defaultThreshold;

        if (subj.passRate < threshold) {
            findings.push({
                subjectKey: subj.subjectKey,
                kind: "below_threshold",
                current: subj.passRate,
                threshold,
            });
        }

        if (base && subj.passRate < base.passRate - baseline.regressionDelta) {
            findings.push({
                subjectKey: subj.subjectKey,
                kind: "regression",
                current: subj.passRate,
                baseline: base.passRate,
                delta: base.passRate - subj.passRate,
            });
        }
    }

    // A subject the baseline declares but the run never produced is a failure,
    // not an absence of evidence.
    //
    // Every scenario can throw — no LLM key, database down, orchestrator broken
    // — and the runner still writes an empty result set, because it collects
    // only the runs that returned something. The gate then checked zero
    // subjects, found zero findings and reported "PASS", so a nightly job that
    // measured nothing at all went green. A regression gate has to be able to
    // tell "nothing regressed" apart from "nothing ran".
    const measured = new Set(current.map((s) => s.subjectKey));
    for (const base of baseline.subjects) {
        if (!measured.has(base.subjectKey)) {
            findings.push({
                subjectKey: base.subjectKey,
                kind: "not_measured",
                current: 0,
                baseline: base.passRate,
                threshold: base.threshold ?? baseline.defaultThreshold,
            });
        }
    }

    return { ok: findings.length === 0, findings, checked: current.length };
}
