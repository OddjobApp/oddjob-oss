/**
 * §6.3 priority scoring, v2.
 *
 * Every component is computed from displayed records, so a reviewer can redo
 * the arithmetic by hand. That is the whole requirement: "every priority score
 * can be recalculated from displayed records".
 *
 * ── The rule that decides what to do about a missing input ──────────────────
 *
 * v1 failed because a missing input scored as zero, and a zero PENALTY inflates
 * (F9: a duplicate proposal scored clean exactly when deduplication was down).
 * The fix is not "withhold whenever anything is missing" — that withholds
 * everything forever, since two of §6.3's terms have no data source on day one.
 * The distinction that matters is which direction the gap pushes the score:
 *
 *   - A missing POSITIVE term can only DEFLATE. Safe: rank on what is known,
 *     mark the score `provisional`, and name what is outstanding.
 *   - A missing PENALTY can only INFLATE. Unsafe: either apply it
 *     conservatively, or withhold.
 *
 * The two penalties are handled differently, on purpose:
 *
 *   - `duplicate_penalty` depends on a MACHINE input that should be available.
 *     Its absence is a system fault, so the score is withheld and the fault is
 *     surfaced — matching §27.2 and the v1 fix already shipped.
 *   - `risk_penalty` depends on a HUMAN review that is legitimately pending.
 *     Unreviewed risk is treated AS risk and the penalty applies, the same way
 *     an unmeasured guardrail counts as breached in the experiment evaluator.
 *     It deflates, so it is safe, and reviewing removes it.
 *
 * ── Departure from the specification ────────────────────────────────────────
 *
 * §6.3 lists `workaround_cost_score` over `median_workaround_minutes`. Nothing
 * in the platform measures workaround time, so that term is permanently
 * `unavailable` until something does. It is kept in the output as an explicit
 * unavailable component rather than dropped, so the score visibly reports what
 * it could not include instead of quietly redefining itself.
 */

import type { AggregatedGap } from "./capability-gap-normalizer.service.js";

export type ComponentState = "measured" | "unavailable";

export interface ScoreComponent {
    id: string;
    /** Points contributed. `0` for an unavailable component. */
    points: number;
    max: number;
    state: ComponentState;
    /** The arithmetic, in words, so the number can be checked by hand. */
    detail: string;
}

/**
 * `final`       — every component known.
 * `provisional` — only positive terms missing, so the score can only be an
 *                 understatement. Rankable, not promotable.
 * `withheld`    — a penalty input was unavailable, so any number would be an
 *                 overstatement. Not rankable.
 */
export type ScoreState = "final" | "provisional" | "withheld";

export interface PrioritizedGap {
    key: string;
    organizationId: number;
    intendedOutcome: string;
    score: number | null;
    scoreState: ScoreState;
    components: ScoreComponent[];
    penalties: ScoreComponent[];
    /** What must be supplied to reach `final`. */
    outstanding: string[];
    reasons: string[];
}

/** Similarity to existing capabilities. Mirrors the registry's three-state contract. */
export interface SimilarityInput {
    status: "available" | "unavailable";
    /** Highest similarity to an existing capability, 0-1. */
    maxScore?: number;
}

export interface HumanInput {
    /** 0-15, assigned by a named person. */
    strategicScore?: number;
    strategicScoreBy?: string;
    /** A human has looked for security or authority concerns. */
    riskReviewed?: boolean;
    /** A concern was found and is unresolved. */
    unresolvedRiskQuestion?: boolean;
}

export interface WorkaroundInput {
    medianMinutes?: number;
}

const DUPLICATE_THRESHOLD = 0.85;

function round1(n: number): number {
    return Math.round(n * 10) / 10;
}

export function prioritizeGap(
    gap: AggregatedGap,
    similarity: SimilarityInput,
    human: HumanInput = {},
    workaround: WorkaroundInput = {},
): PrioritizedGap {
    const components: ScoreComponent[] = [];
    const penalties: ScoreComponent[] = [];
    const outstanding: string[] = [];
    const reasons: string[] = [];

    // ── positive components ────────────────────────────────────────────────
    const frequency = round1(Math.min(gap.uniqueAffectedRuns / 10, 1) * 25);
    components.push({
        id: "frequency_score",
        points: frequency,
        max: 25,
        state: "measured",
        detail: `min(${gap.uniqueAffectedRuns} affected runs / 10, 1) * 25 = ${frequency}`,
    });

    // No recorded actor at all is "unknown", not "nobody".
    if (gap.uniqueAffectedUsers === 0 && gap.eventsWithoutActor === gap.eventCount) {
        components.push({
            id: "user_impact_score",
            points: 0,
            max: 15,
            state: "unavailable",
            detail: `No event carried an actor, so the number of affected people is unknown (not zero).`,
        });
        outstanding.push("user_impact_score");
    } else {
        const userImpact = round1(Math.min(gap.uniqueAffectedUsers / 5, 1) * 15);
        components.push({
            id: "user_impact_score",
            points: userImpact,
            max: 15,
            state: "measured",
            detail: `min(${gap.uniqueAffectedUsers} affected users / 5, 1) * 15 = ${userImpact}`,
        });
    }

    if (typeof workaround.medianMinutes === "number") {
        const cost = round1(Math.min(workaround.medianMinutes / 60, 1) * 15);
        components.push({
            id: "workaround_cost_score",
            points: cost,
            max: 15,
            state: "measured",
            detail: `min(${workaround.medianMinutes} min / 60, 1) * 15 = ${cost}`,
        });
    } else {
        components.push({
            id: "workaround_cost_score",
            points: 0,
            max: 15,
            state: "unavailable",
            detail: "Nothing in the platform measures workaround time, so this term cannot be computed.",
        });
        outstanding.push("workaround_cost_score");
    }

    if (typeof human.strategicScore === "number" && human.strategicScoreBy?.trim()) {
        const strategic = Math.max(0, Math.min(human.strategicScore, 15));
        components.push({
            id: "strategic_score",
            points: strategic,
            max: 15,
            state: "measured",
            detail: `${strategic} assigned by ${human.strategicScoreBy}.`,
        });
    } else {
        components.push({
            id: "strategic_score",
            points: 0,
            max: 15,
            state: "unavailable",
            // §6.3: "strategic_score requires a named human scorer."
            detail: "Requires a named human scorer; none recorded.",
        });
        outstanding.push("strategic_score");
    }

    // Evidence completeness — a meta-metric over the events themselves, so it
    // is always computable and rewards well-attributed evidence.
    const withRun = gap.eventCount - gap.eventsWithoutRunIdentity;
    const withActor = gap.eventCount - gap.eventsWithoutActor;
    const parsedNames = gap.unparsedToolNames.length === 0 ? 1 : 0;
    const completeness = gap.eventCount === 0
        ? 0
        : (withRun / gap.eventCount) * 0.5 + (withActor / gap.eventCount) * 0.3 + parsedNames * 0.2;
    const confidence = round1(completeness * 15);
    components.push({
        id: "confidence_score",
        points: confidence,
        max: 15,
        state: "measured",
        detail:
            `evidence completeness ${completeness.toFixed(2)} ` +
            `(${withRun}/${gap.eventCount} with run identity, ${withActor}/${gap.eventCount} with actor, ` +
            `${gap.unparsedToolNames.length === 0 ? "all" : "not all"} tool names parsed) * 15 = ${confidence}`,
    });

    // ── penalties ──────────────────────────────────────────────────────────
    let withheld = false;

    if (similarity.status === "unavailable") {
        // A machine input that should be available. Absence is a fault, and a
        // zero here would hand a duplicate a clean score (F9).
        penalties.push({
            id: "duplicate_penalty",
            points: 0,
            max: 20,
            state: "unavailable",
            detail: "Similarity search did not run, so it is unknown whether this duplicates an existing capability.",
        });
        outstanding.push("duplicate_penalty");
        withheld = true;
        reasons.push(
            "Score withheld: the duplicate check could not run, and scoring it as 'no duplicate' is exactly how a duplicate earns a clean result.",
        );
    } else {
        const isDuplicate = (similarity.maxScore ?? 0) >= DUPLICATE_THRESHOLD;
        penalties.push({
            id: "duplicate_penalty",
            points: isDuplicate ? 20 : 0,
            max: 20,
            state: "measured",
            detail: `max similarity ${(similarity.maxScore ?? 0).toFixed(2)} ${isDuplicate ? ">=" : "<"} ${DUPLICATE_THRESHOLD}.`,
        });
        if (isDuplicate) reasons.push("A registered capability is highly similar; review before building.");
    }

    // Unreviewed risk is treated AS risk — it deflates, so it is safe, and a
    // review removes it. Same rule as an unmeasured guardrail counting as
    // breached.
    const riskApplies = human.unresolvedRiskQuestion === true || human.riskReviewed !== true;
    penalties.push({
        id: "risk_penalty",
        points: riskApplies ? 20 : 0,
        max: 20,
        state: "measured",
        detail: human.riskReviewed !== true
            ? "No security or authority review recorded; an unreviewed risk is treated as an open one."
            : human.unresolvedRiskQuestion
                ? "An unresolved security or authority question is recorded."
                : "Reviewed, with no open security or authority question.",
    });
    if (human.riskReviewed !== true) outstanding.push("risk_review");

    // ── total ──────────────────────────────────────────────────────────────
    const positive = components.reduce((sum, c) => sum + c.points, 0);
    const deducted = penalties.reduce((sum, c) => sum + c.points, 0);
    const raw = Math.max(0, Math.min(round1(positive - deducted), 100));

    const missingPositives = components.filter(c => c.state === "unavailable");
    const scoreState: ScoreState = withheld
        ? "withheld"
        : missingPositives.length > 0
            ? "provisional"
            : "final";

    if (scoreState === "provisional") {
        reasons.push(
            `Provisional: ${missingPositives.map(c => c.id).join(", ")} could not be computed, so this score can only understate the priority.`,
        );
    }

    return {
        key: gap.key,
        organizationId: gap.organizationId,
        intendedOutcome: gap.signature.intendedOutcome,
        score: withheld ? null : raw,
        scoreState,
        components,
        penalties,
        outstanding: [...new Set(outstanding)],
        reasons,
    };
}

/**
 * Rank a set of gaps.
 *
 * Withheld candidates sort last: they are unranked, not low-ranked. A
 * provisional score outranks nothing it could not have outranked at full value,
 * because it can only be an understatement.
 */
export function prioritizeGaps(
    inputs: Array<{
        gap: AggregatedGap;
        similarity: SimilarityInput;
        human?: HumanInput;
        workaround?: WorkaroundInput;
    }>,
): PrioritizedGap[] {
    return inputs
        .map(i => prioritizeGap(i.gap, i.similarity, i.human, i.workaround))
        .sort((a, b) => {
            if (a.score === null && b.score === null) return 0;
            if (a.score === null) return 1;
            if (b.score === null) return -1;
            return b.score - a.score;
        });
}
