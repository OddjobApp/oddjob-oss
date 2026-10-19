/**
 * Fact validation and identity for immutable observations.
 *
 * The rule this enforces (§4.2): an observation records what was seen, never
 * why it happened. `wait_duration_ms` and `followed_by_rework` are observations.
 * `caused_delay` is a conclusion wearing an observation's clothes — and once one
 * is stored as a fact, every downstream claim that cites it inherits a causal
 * assertion nobody established.
 *
 * This is a keyword guard, and keyword guards are heuristics. It reliably
 * catches the obvious phrasings and cannot prove a key is causally neutral;
 * treat a pass as "not obviously a conclusion", not as a semantic guarantee.
 */

import { createHash } from "node:crypto";

/**
 * Key fragments that assert causation, attribution, or blame.
 *
 * Matched against a normalized key (lowercased, separators stripped) so
 * `caused_delay`, `causedDelay` and `Caused-Delay` are all caught.
 */
const CAUSAL_KEY_FRAGMENTS: readonly string[] = [
    "caused",
    "causes",
    "causing",
    "causal",
    "rootcause",
    "becauseof",
    "dueto",
    "reasonfor",
    "leadsto",
    "ledto",
    "resultsin",
    "resultedin",
    "responsiblefor",
    "attributableto",
    "blamedon",
    "blamefor",
    "drivenby",
    "triggeredby",
    "explains",
    "explanation",
    "why",
];

/**
 * Fragments that look causal but are legitimate observations, checked first.
 *
 * `followed_by_*` is sequence, not causation, and the spec names it explicitly.
 */
const SEQUENCE_ALLOWLIST: readonly string[] = [
    "followedby",
    "precededby",
];

function normalizeKey(key: string): string {
    return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface FactViolation {
    key: string;
    matched: string;
    reason: string;
}

export type FactValidationResult =
    | { ok: true }
    | { ok: false; violations: FactViolation[] };

/**
 * Reject facts whose keys assert causation.
 *
 * Nested objects are walked, because burying `caused_delay` one level down
 * evades a shallow check while reaching the same reader.
 */
export function validateObservationFacts(facts: Record<string, unknown>): FactValidationResult {
    const violations: FactViolation[] = [];

    const walk = (value: unknown, path: string[]): void => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return;
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            const normalized = normalizeKey(key);
            const fullPath = [...path, key].join(".");

            const allowed = SEQUENCE_ALLOWLIST.some(frag => normalized.includes(frag));
            if (!allowed) {
                const matched = CAUSAL_KEY_FRAGMENTS.find(frag => normalized.includes(frag));
                if (matched) {
                    violations.push({
                        key: fullPath,
                        matched,
                        reason: `'${fullPath}' asserts causation ('${matched}'). An observation records what was seen; record the measurement instead — e.g. 'wait_duration_ms' rather than 'caused_delay'.`,
                    });
                }
            }
            walk(child, [...path, key]);
        }
    };

    walk(facts, []);
    return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

export class ObservationFactsError extends Error {
    constructor(readonly violations: FactViolation[]) {
        super(`Observation facts contain unsupported causal labels: ${violations.map(v => v.key).join(", ")}`);
        this.name = "ObservationFactsError";
    }
}

export function assertObservationFacts(facts: Record<string, unknown>): void {
    const result = validateObservationFacts(facts);
    if (!result.ok) throw new ObservationFactsError(result.violations);
}

/** Canonical JSON: object keys sorted at every depth, so key order cannot change identity. */
function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
        return Object.keys(value as Record<string, unknown>)
            .sort()
            .reduce<Record<string, unknown>>((acc, key) => {
                acc[key] = canonicalize((value as Record<string, unknown>)[key]);
                return acc;
            }, {});
    }
    return value;
}

export interface ObservationIdentityInput {
    sourceType: string;
    sourceId: string;
    observedAt: Date | string;
    facts: Record<string, unknown>;
}

/**
 * Deterministic identity for an observation.
 *
 * Deliberately excludes `ingestedAt` and any surrogate id: re-ingesting the same
 * source event must produce the same hash so the unique index deduplicates it,
 * rather than accumulating duplicates that inflate every frequency count built
 * on top. `observedAt` is normalized to an ISO instant so a Date and its string
 * form agree.
 */
export function computeObservationContentHash(input: ObservationIdentityInput): string {
    const observedAt =
        input.observedAt instanceof Date ? input.observedAt.toISOString() : new Date(input.observedAt).toISOString();

    const canonical = JSON.stringify(
        canonicalize({
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            observedAt,
            facts: input.facts,
        }),
    );

    return createHash("sha256").update(canonical).digest("hex");
}
