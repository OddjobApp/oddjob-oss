import { describe, it, expect } from "vitest";
import {
    decayVector,
    computePressure,
    toRuleFields,
    shrink,
    DEFAULT_HALF_LIFE_MS,
    type ScoreContribution,
} from "./score-vector.js";
import { BEHAVIORAL_SCORE_SCHEMA, ruleFieldName, SCORE_META_RULE_FIELDS } from "@shared/contracts/score-vector.js";

const decayBehavioral = (c: any, now: Date, o: any = {}) =>
    decayVector(c, now, { ...o, schema: BEHAVIORAL_SCORE_SCHEMA });

const T0 = new Date("2026-08-10T12:00:00.000Z");
const at = (minutesAgo: number) => new Date(T0.getTime() - minutesAgo * 60_000);
const contrib = (dimension: any, weight: number, minutesAgo: number): ScoreContribution =>
    ({ dimension, weight, at: at(minutesAgo) });

describe("decay", () => {
    it("returns a zero vector for no contributions", () => {
        const v = decayBehavioral([], T0);
        expect(v.values.symptom).toBe(0);
        expect(v.evidenceCount).toBe(0);
        expect(v.confidence).toBe(0);
    });

    it("applies a contribution at full weight when it just happened", () => {
        const v = decayBehavioral([contrib("symptom", 4, 0)], T0);
        expect(v.values.symptom).toBeCloseTo(4, 3);
    });

    it("halves a contribution after one half-life", () => {
        const halfLifeMinutes = DEFAULT_HALF_LIFE_MS / 60_000;
        const v = decayBehavioral([contrib("symptom", 4, halfLifeMinutes)], T0);
        expect(v.values.symptom).toBeCloseTo(2, 2);
    });

    it("fades stale evidence toward nothing", () => {
        // The core fix: struggle from long ago must stop counting as struggle now.
        const v = decayBehavioral([contrib("symptom", 10, 120)], T0);
        expect(v.values.symptom).toBeLessThan(0.1);
    });

    it("does not let a long session accumulate without bound", () => {
        // The old implementation summed monotonically and saturated at 10 per
        // dimension, so session length alone crossed the trigger.
        const many: ScoreContribution[] = [];
        for (let i = 0; i < 200; i++) many.push(contrib("symptom", 1, i));
        const v = decayBehavioral(many, T0);
        expect(v.values.symptom).toBeLessThanOrEqual(10);
        // Only the recent tail should carry weight.
        expect(v.values.symptom).toBeLessThan(20);
    });

    it("clamps a dimension at the configured maximum", () => {
        const spike = Array.from({ length: 50 }, () => contrib("symptom", 5, 0));
        expect(decayBehavioral(spike, T0).values.symptom).toBe(10);
    });

    it("keeps dimensions independent", () => {
        const v = decayBehavioral([contrib("symptom", 3, 0), contrib("resource", 2, 0)], T0);
        expect(v.values.symptom).toBeCloseTo(3, 3);
        expect(v.values.resource).toBeCloseTo(2, 3);
        expect(v.values.cause).toBe(0);
    });

    it("treats a future-dated contribution as current rather than amplifying it", () => {
        // A visitor's browser clock can run ahead; that must not inflate weight.
        const future: ScoreContribution = { dimension: "symptom", weight: 4, at: new Date(T0.getTime() + 600_000) };
        expect(decayBehavioral([future], T0).values.symptom).toBeCloseTo(4, 3);
    });

    it("ignores malformed contributions", () => {
        const bad: any[] = [
            { dimension: "nonsense", weight: 5, at: at(0) },
            { dimension: "symptom", weight: 0, at: at(0) },
            { dimension: "symptom", weight: -3, at: at(0) },
            { dimension: "symptom", weight: NaN, at: at(0) },
        ];
        const v = decayBehavioral(bad, T0);
        expect(v.values.symptom).toBe(0);
        expect(v.evidenceCount).toBe(0);
    });
});

describe("evidence confidence", () => {
    it("is low for a single event", () => {
        // One click must not be enough to interrupt a human.
        expect(decayBehavioral([contrib("symptom", 9, 0)], T0).confidence).toBeLessThan(0.3);
    });

    it("rises as evidence accumulates", () => {
        const few = decayBehavioral([contrib("symptom", 1, 0), contrib("symptom", 1, 0)], T0).confidence;
        const many = decayBehavioral(
            Array.from({ length: 30 }, () => contrib("symptom", 1, 0)),
            T0,
        ).confidence;
        expect(many).toBeGreaterThan(few);
        expect(many).toBeGreaterThan(0.85);
    });

    it("never reaches or exceeds 1", () => {
        const v = decayBehavioral(Array.from({ length: 500 }, () => contrib("cause", 1, 0)), T0);
        expect(v.confidence).toBeLessThan(1);
    });

    it("shrinks a value against thin evidence", () => {
        expect(shrink(10, 0.2)).toBeCloseTo(2, 3);
    });
});

describe("pressure", () => {
    it("treats a succeeding visitor as pressure to leave alone", () => {
        // Interrupting someone who is winning is the costliest false positive.
        const struggling = computePressure({ symptom: 8, cause: 0, outcome: 0, resource: 0, effect: 0 }, BEHAVIORAL_SCORE_SCHEMA);
        const succeeding = computePressure({ symptom: 0, cause: 0, outcome: 8, resource: 0, effect: 0 }, BEHAVIORAL_SCORE_SCHEMA);
        expect(struggling).toBeGreaterThan(0);
        expect(succeeding).toBeLessThan(0);
    });

    it("nets suppressing evidence against supporting evidence", () => {
        // The old design summed these, so struggle + success read as MORE
        // intent than struggle alone.
        const mixed = computePressure({ symptom: 8, cause: 0, outcome: 8, resource: 0, effect: 0 }, BEHAVIORAL_SCORE_SCHEMA);
        const strugglingOnly = computePressure({ symptom: 8, cause: 0, outcome: 0, resource: 0, effect: 0 }, BEHAVIORAL_SCORE_SCHEMA);
        expect(mixed).toBeLessThan(strugglingOnly);
    });
});

describe("rule field projection", () => {
    it("emits flat, top-level fields the rule engine can resolve", () => {
        const fields = toRuleFields(decayBehavioral([contrib("symptom", 6, 0)], T0), BEHAVIORAL_SCORE_SCHEMA);

        // Nested paths never resolve in the engine's flat lookup, so every
        // rule-visible value has to be top-level.
        for (const key of Object.keys(fields)) {
            expect(key).not.toContain(".");
        }
        expect(fields[ruleFieldName("symptom")]).toBeCloseTo(6, 3);
        expect(fields).toHaveProperty(SCORE_META_RULE_FIELDS.confidence);
        expect(fields).toHaveProperty(SCORE_META_RULE_FIELDS.pressure);
    });

    it("exposes every documented rule field", () => {
        const fields = toRuleFields(decayBehavioral([], T0), BEHAVIORAL_SCORE_SCHEMA);
        for (const name of Object.values(SCORE_META_RULE_FIELDS)) {
            expect(fields).toHaveProperty(name);
        }
    });
});
