/**
 * Scoring schemas.
 *
 * A scored subject's DIMENSIONS are specific to what it is; the scoring
 * MECHANISM (decay, evidence shrinkage, thresholds, cooldowns, actions) is not.
 * A GPS asset has no Budget, an article has no Authority-to-purchase, and a
 * prospect has no velocity — so there is no universal vector, and a dimension
 * set must be declared per subject type rather than baked into the engine.
 *
 * This file declares the schema shape plus the prospect schema. Additional
 * subject types (spatial assets, content sources) register their own and reuse
 * the same engine.
 */

export type InterventionSense = "supports" | "suppresses";

export interface ScoreDimensionDef {
    /** Stable machine key, used in contributions and rule fields. */
    key: string;
    /** Single letter used by legacy `{ S, C, O, R, E }` storage, where applicable. */
    code?: string;
    label: string;
    /** Written for an LLM prompt — what evidence moves this dimension. */
    description: string;
    /**
     * Whether a high value argues FOR acting on the subject, or against it.
     * Not every schema has a suppressing dimension; prospect scoring has none,
     * because every BANT dimension is a buying signal.
     */
    interventionSense: InterventionSense;
    /** Declared but never scored. Retained for storage compatibility only. */
    legacy?: boolean;
}

export interface ScoreSchema {
    subjectType: string;
    /**
     * Declared dimensions. Empty for open-vocabulary schemas, where the
     * dimensions ARE the data (themes, topics, concepts) and cannot be
     * enumerated in advance.
     */
    dimensions: ScoreDimensionDef[];
    /** Per-dimension ceiling, so one noisy signal cannot dominate. */
    max: number;
    /**
     * Open-vocabulary schemas score an unbounded, data-driven key space —
     * one score per theme, topic or concept encountered.
     *
     * This changes how rules can address them. A closed schema projects each
     * dimension to a flat field (`scoreBudget`) that the subscription rule
     * engine resolves with a direct property read. An unbounded key space
     * cannot do that: there is no finite set of field names to emit, and the
     * engine does not support nested paths.
     *
     * Rules over open vocabularies must therefore use the engine's set
     * operators (`contains`, `in`, `not_in`) against a projected list of keys
     * above threshold, plus aggregate fields (top key, top value, breadth),
     * rather than one field per key.
     */
    openVocabulary?: boolean;
}

/**
 * PROSPECT SCORING IS BANT.
 *
 * The letters are stored as S/C/O/R/E, but `bant-scoring-template.ts` — the
 * rules that actually generate every score — maps them to BANT:
 *
 *     S → Budget          (pricing page dwell,        weight 2.0)
 *     C → Authority       (enterprise docs search,    weight 2.5)
 *     O → Need            (contact sales / demo,      weight 5.0)
 *     R → Timeline        (ROI calculator usage,      weight 3.0)
 *
 * Two other vocabularies exist for these same letters and are BOTH wrong here:
 * the docs call them Symptom/Cause/Outcome/Resource/Effect, and an earlier LLM
 * prompt called them Status/Challenge/Outcome/Risk/Engagement. The templates
 * win — they are what the numbers are actually built from.
 *
 * This matters beyond naming: reading O as "Outcome" invites treating it as
 * "the visitor is succeeding, leave them alone", when it is in fact the
 * STRONGEST buying signal in the system. Every BANT dimension supports acting.
 */
export const PROSPECT_SCORE_SCHEMA: ScoreSchema = {
    subjectType: "prospect",
    max: 10,
    dimensions: [
        {
            key: "budget",
            code: "S",
            label: "Budget",
            description: "Pricing and packaging interest — evidence the visitor is sizing cost.",
            interventionSense: "supports",
        },
        {
            key: "authority",
            code: "C",
            label: "Authority",
            description: "Evaluation depth typical of a decision maker or their proxy.",
            interventionSense: "supports",
        },
        {
            key: "need",
            code: "O",
            label: "Need",
            description: "Explicit demand — contacting sales, requesting a demo. The strongest buying signal.",
            interventionSense: "supports",
        },
        {
            key: "timeline",
            code: "R",
            label: "Timeline",
            description: "Urgency and planning behaviour — ROI modelling, implementation research.",
            interventionSense: "supports",
        },
        {
            key: "engagement",
            code: "E",
            label: "Engagement",
            description: "Unused. No scoring template assigns this dimension.",
            interventionSense: "supports",
            legacy: true,
        },
    ],
};

/**
 * BEHAVIORAL SCORING — the S.C.O.R.E. framework proper.
 *
 * The other model a prospect can be scored under, and the one the docs
 * describe. It measures *state* ("is this person struggling right now?")
 * rather than *fit*, and drives in-app guidance: `ruleType: 'ui_interaction'`,
 * tooltips, guide prompts, concierge offers.
 *
 * NOTE THE SIGN DIFFERENCE FROM BANT. Here `outcome` SUPPRESSES — a visitor
 * who is visibly succeeding is the one you must not interrupt. Under BANT the
 * same stored letter `O` is Need, the strongest reason TO act. The two models
 * share letter storage and mean opposite things by it, so a vector is only
 * interpretable alongside the schema it was scored under.
 */
export const BEHAVIORAL_SCORE_SCHEMA: ScoreSchema = {
    subjectType: "behavioral",
    max: 10,
    dimensions: [
        {
            key: "symptom",
            code: "S",
            label: "Symptom",
            description: "Negative feelings or confusion indicators — evidence the visitor is struggling.",
            interventionSense: "supports",
        },
        {
            key: "cause",
            code: "C",
            label: "Cause",
            description: "Root source identification — evidence the visitor is diagnosing a specific problem.",
            interventionSense: "supports",
        },
        {
            key: "outcome",
            code: "O",
            label: "Outcome",
            description: "Positive results and goal achievement — evidence the visitor is succeeding unaided.",
            interventionSense: "suppresses",
        },
        {
            key: "resource",
            code: "R",
            label: "Resource",
            description: "Tools and documentation usage — evidence the visitor is self-serving answers.",
            interventionSense: "supports",
        },
        {
            key: "effect",
            code: "E",
            label: "Effect",
            description: "Side effects and consequences — evidence the problem is spreading or compounding.",
            interventionSense: "supports",
        },
    ],
};

/**
 * OPEN-VOCABULARY SCHEMAS — semantic, topic, and concept/theme scoring.
 *
 * These score an unbounded key space rather than fixed dimensions: one value
 * per theme, topic or concept a subject engages with. The keys come from data
 * already flowing through the system — the embed attaches a `themes` array to
 * every event, and profiles carry `attributedThemes` / `attributedConcepts`.
 *
 * The decay and shrinkage mechanism applies unchanged; only the key space
 * differs. What changes is addressability: see `openVocabulary` above for why
 * these cannot be projected to one rule field per key.
 */
export const THEME_SCORE_SCHEMA: ScoreSchema = {
    subjectType: "theme",
    max: 10,
    dimensions: [],
    openVocabulary: true,
};

export const TOPIC_SCORE_SCHEMA: ScoreSchema = {
    subjectType: "topic",
    max: 10,
    dimensions: [],
    openVocabulary: true,
};

export const CONCEPT_SCORE_SCHEMA: ScoreSchema = {
    subjectType: "concept",
    max: 10,
    dimensions: [],
    openVocabulary: true,
};

/**
 * Semantic similarity scoring — an unbounded space keyed by matched
 * embedding/cluster rather than by a curated label.
 */
export const SEMANTIC_SCORE_SCHEMA: ScoreSchema = {
    subjectType: "semantic",
    max: 10,
    dimensions: [],
    openVocabulary: true,
};

/**
 * Scoring model a rule or property is using. A property may run several at
 * once — BANT qualifies who they are, behavioral decides when to act, and the
 * open-vocabulary models describe what they care about.
 */
export type ScoringModel = "bant" | "behavioral" | "theme" | "topic" | "concept" | "semantic";

export function schemaForModel(model: ScoringModel): ScoreSchema {
    switch (model) {
        case "behavioral": return BEHAVIORAL_SCORE_SCHEMA;
        case "theme": return THEME_SCORE_SCHEMA;
        case "topic": return TOPIC_SCORE_SCHEMA;
        case "concept": return CONCEPT_SCORE_SCHEMA;
        case "semantic": return SEMANTIC_SCORE_SCHEMA;
        case "bant":
        default: return PROSPECT_SCORE_SCHEMA;
    }
}

/** Map a `scoring_rules.ruleType` onto the model it scores under. */
export function modelForRuleType(ruleType: string | null | undefined): ScoringModel {
    return ruleType === "prospecting" ? "bant" : "behavioral";
}

const SCHEMA_REGISTRY = new Map<string, ScoreSchema>([
    [PROSPECT_SCORE_SCHEMA.subjectType, PROSPECT_SCORE_SCHEMA],
    [BEHAVIORAL_SCORE_SCHEMA.subjectType, BEHAVIORAL_SCORE_SCHEMA],
]);

export function registerScoreSchema(schema: ScoreSchema): void {
    SCHEMA_REGISTRY.set(schema.subjectType, schema);
}

export function getScoreSchema(subjectType: string): ScoreSchema | undefined {
    return SCHEMA_REGISTRY.get(subjectType);
}

/** Dimensions that are actually scored — excludes legacy placeholders. */
export function activeDimensions(schema: ScoreSchema): ScoreDimensionDef[] {
    return schema.dimensions.filter(d => !d.legacy);
}

export function dimensionByCode(schema: ScoreSchema, code: string): ScoreDimensionDef | undefined {
    return schema.dimensions.find(d => d.code === code);
}

/**
 * Flat field name exposed to the subscription rule engine.
 *
 * The engine resolves `cond.field` with a flat property read, so nested paths
 * never match and rule-visible values must be top-level.
 */
export function ruleFieldName(dimensionKey: string): string {
    return `score${dimensionKey.charAt(0).toUpperCase()}${dimensionKey.slice(1)}`;
}

/** Rule fields that exist for every schema, alongside the per-dimension ones. */
export const SCORE_META_RULE_FIELDS = {
    evidenceCount: "scoreEvidenceCount",
    confidence: "scoreConfidence",
    pressure: "scorePressure",
} as const;

export type LegacyScoreVector = Record<string, number>;

export function toLegacyVector(
    values: Record<string, number>,
    schema: ScoreSchema = PROSPECT_SCORE_SCHEMA,
): LegacyScoreVector {
    const out: LegacyScoreVector = {};
    for (const d of schema.dimensions) {
        if (d.code) out[d.code] = values[d.key] ?? 0;
    }
    return out;
}

export function fromLegacyVector(
    legacy: Record<string, number> | null | undefined,
    schema: ScoreSchema = PROSPECT_SCORE_SCHEMA,
): Record<string, number> {
    const out: Record<string, number> = {};
    for (const d of schema.dimensions) {
        out[d.key] = (d.code ? legacy?.[d.code] : undefined) ?? 0;
    }
    return out;
}

/**
 * Render a vector for an LLM prompt using the schema's labels. Callers must not
 * restate dimension names themselves — that is how the drift happened.
 */
export function describeScoreVector(
    legacy: Record<string, number> | null | undefined,
    schema: ScoreSchema = PROSPECT_SCORE_SCHEMA,
): string {
    const values = fromLegacyVector(legacy, schema);
    return activeDimensions(schema)
        .map(d => `${d.label}:${values[d.key] ?? 0}`)
        .join(", ");
}
