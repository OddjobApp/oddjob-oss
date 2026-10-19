/**
 * Time-decayed, evidence-weighted score computation.
 *
 * Generic over a `ScoreSchema`: the arithmetic here (decay, shrinkage,
 * pressure, clamping) is subject-agnostic, so a spatial asset or a content
 * source can reuse it by registering its own dimensions. Only the vocabulary
 * is per-subject.
 *
 * Replaces monotonic accumulation. The previous implementation only ever added
 * (`newScore[v] = min(10, newScore[v] + weight)`) and thresholded on the SUM of
 * all dimensions, so nothing faded and the trigger became a proxy for session
 * length rather than intent.
 *
 * TIMESTAMPS COME FROM THE EVENT, NEVER FROM `Date.now()` AT PROCESSING TIME —
 * events are scored by a worker off the request path, so decaying against
 * processing time lets queue backlog silently rewrite history.
 */

import {
    PROSPECT_SCORE_SCHEMA,
    activeDimensions,
    ruleFieldName,
    SCORE_META_RULE_FIELDS,
    type ScoreSchema,
} from "@shared/contracts/score-vector.js";

/** One piece of scored evidence, located in time. */
export interface ScoreContribution {
    /** Dimension key from the subject's schema. */
    dimension: string;
    /** Positive magnitude before decay. */
    weight: number;
    /** When the underlying event OCCURRED, not when it was processed. */
    at: Date;
}

export interface DecayedScoreVector {
    /** Per-dimension decayed values, keyed by schema dimension key. */
    values: Record<string, number>;
    /** Contributions that still carry meaningful weight. */
    evidenceCount: number;
    /** 0..1 — how far to trust the vector given how little evidence backs it. */
    confidence: number;
    /** Supporting dimensions minus suppressing ones. */
    pressure: number;
}

export interface DecayOptions {
    schema?: ScoreSchema;
    /** Time for a contribution to lose half its weight. Default 8 minutes. */
    halfLifeMs?: number;
    /** Confidence is n/(n+k); at k contributions the vector is half-trusted. */
    shrinkageK?: number;
    /** Contributions decayed below this are dropped. */
    epsilon?: number;
}

export const DEFAULT_HALF_LIFE_MS = 8 * 60 * 1000;
export const DEFAULT_SHRINKAGE_K = 4;
export const DEFAULT_EPSILON = 0.01;

export function decayVector(
    contributions: ScoreContribution[],
    now: Date,
    options: DecayOptions = {},
): DecayedScoreVector {
    const schema = options.schema ?? PROSPECT_SCORE_SCHEMA;
    const halfLifeMs = options.halfLifeMs ?? DEFAULT_HALF_LIFE_MS;
    const shrinkageK = options.shrinkageK ?? DEFAULT_SHRINKAGE_K;
    const epsilon = options.epsilon ?? DEFAULT_EPSILON;

    const known = new Set(schema.dimensions.map(d => d.key));
    const values: Record<string, number> = {};
    for (const d of schema.dimensions) values[d.key] = 0;

    let evidenceCount = 0;

    for (const c of contributions) {
        // Closed schemas reject unknown keys — an unrecognised dimension is a
        // rule authoring error and must not silently create a phantom score.
        // Open-vocabulary schemas (theme, topic, concept, semantic) have no
        // declared keys at all: the key space IS the data, so every key is
        // admitted and the dimension is created on first sight.
        if (!schema.openVocabulary && !known.has(c.dimension)) continue;
        if (!c.dimension) continue;
        if (!Number.isFinite(c.weight) || c.weight <= 0) continue;
        if (values[c.dimension] === undefined) values[c.dimension] = 0;

        // Clamp negative age: a visitor's clock running ahead of the server must
        // not produce a contribution worth MORE than its nominal weight.
        const ageMs = Math.max(0, now.getTime() - c.at.getTime());
        const decayed = c.weight * Math.pow(2, -ageMs / halfLifeMs);
        if (decayed < epsilon) continue;

        values[c.dimension] += decayed;
        evidenceCount++;
    }

    for (const key of Object.keys(values)) {
        values[key] = round(Math.min(schema.max, values[key]));
    }

    return {
        values,
        evidenceCount,
        confidence: round(evidenceCount / (evidenceCount + shrinkageK)),
        pressure: computePressure(values, schema),
    };
}

/**
 * Net pressure to act.
 *
 * Dimensions combine by their declared sense rather than being summed blindly.
 * A schema may declare no suppressing dimension at all — prospect scoring does
 * not, because every BANT dimension is a buying signal.
 */
export function computePressure(
    values: Record<string, number>,
    schema: ScoreSchema = PROSPECT_SCORE_SCHEMA,
): number {
    let pressure = 0;
    for (const d of activeDimensions(schema)) {
        const v = values[d.key] ?? 0;
        pressure += d.interventionSense === "suppresses" ? -v : v;
    }
    return round(pressure);
}

/**
 * Project a vector into the flat fields the subscription rule engine reads.
 * Nested paths never resolve there, so every rule-visible value is top-level.
 */
export function toRuleFields(
    vector: DecayedScoreVector,
    schema: ScoreSchema = PROSPECT_SCORE_SCHEMA,
    options: { keyThreshold?: number; topN?: number } = {},
): Record<string, unknown> {
    const fields: Record<string, unknown> = {};

    if (schema.openVocabulary) {
        // An unbounded key space cannot become one field per key — there is no
        // finite set of names to emit, and the rule engine has no nested-path
        // lookup. Instead expose a LIST of keys above threshold (matchable with
        // the engine's `contains` / `in` / `not_in` operators) plus scalar
        // aggregates for magnitude and breadth.
        const threshold = options.keyThreshold ?? 1;
        const topN = options.topN ?? 10;

        const ranked = Object.entries(vector.values)
            .filter(([, v]) => v >= threshold)
            .sort((a, b) => b[1] - a[1]);

        fields.scoreKeys = ranked.slice(0, topN).map(([k]) => k);
        fields.scoreTopKey = ranked[0]?.[0] ?? null;
        fields.scoreTopValue = ranked[0]?.[1] ?? 0;
        fields.scoreKeyCount = ranked.length;
    } else {
        for (const d of schema.dimensions) {
            fields[ruleFieldName(d.key)] = vector.values[d.key] ?? 0;
        }
    }

    fields[SCORE_META_RULE_FIELDS.evidenceCount] = vector.evidenceCount;
    fields[SCORE_META_RULE_FIELDS.confidence] = vector.confidence;
    fields[SCORE_META_RULE_FIELDS.pressure] = vector.pressure;
    return fields;
}

/** Apply evidence shrinkage where a decision must not rest on thin evidence. */
export function shrink(value: number, confidence: number): number {
    return round(value * confidence);
}

function round(n: number): number {
    return Math.round(n * 1000) / 1000;
}
