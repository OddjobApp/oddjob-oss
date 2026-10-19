/**
 * Tier 2 ambient review: the model-backed pass, on the save boundary.
 *
 * Tier 1 is rules and runs per keystroke because it costs nothing. This tier
 * costs a model call, so where it runs is the entire design.
 *
 * From the load simulation (tests/authoring-load.sim.test.ts): a deliberate
 * author — 500ms between keystrokes, which is the contract-drafting profile —
 * produces 800 deltas against 20 saves in a session. Three sentinels on every
 * delta is 2,400 calls; the same sentinels on the save boundary is 60, and the
 * author receives the feedback at the same moment either way, because they are
 * pausing to think when it lands.
 *
 * Even 60 is worth guarding. `shouldReviewOnSave` is pure and does the
 * refusing: too short, too soon, or not meaningfully changed. It is separated
 * from the call itself so the spend policy can be tested exhaustively without a
 * model, which is the only way to be sure a guard actually holds.
 */

import type { ScribeArchetypeMode, ScribeLensType } from "@shared/schema/scribe.js";
import type { AmbientInsight } from "./ambient-sentinel.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ScribeAmbientTier2");

/** A station is not worth a model call until it holds a real paragraph. */
export const MIN_REVIEW_CHARS = 200;
/** Two saves inside this window review once. Authors save far faster than they rewrite. */
export const REVIEW_COOLDOWN_MS = 60_000;
/** Below this many changed characters the text has not moved enough to re-judge. */
export const MIN_CHANGED_CHARS = 80;

export interface ReviewState {
    /** Text as it stood at the last review, for measuring the change since. */
    lastReviewedText: string;
    lastReviewedAt: number;
}

export interface ReviewDecision {
    review: boolean;
    /** Why, in a word — logged, and asserted on in tests. */
    reason: "first_review" | "changed_enough" | "too_short" | "cooling_down" | "unchanged";
}

/** Characters differing between two texts, cheaply: good enough to gate spend. */
export function changedChars(before: string, after: string): number {
    if (before === after) return 0;
    // Trim the shared head and tail, then take the larger remaining side. An
    // insertion in the middle of a paragraph reads as its own length rather
    // than as the whole rest of the text shifting.
    let head = 0;
    const max = Math.min(before.length, after.length);
    while (head < max && before[head] === after[head]) head++;

    let tail = 0;
    while (
        tail < max - head &&
        before[before.length - 1 - tail] === after[after.length - 1 - tail]
    ) {
        tail++;
    }

    return Math.max(before.length - head - tail, after.length - head - tail);
}

/**
 * Whether this save earns a model call.
 *
 * Pure: same inputs, same answer. `now` is a parameter rather than a clock read
 * so the cooldown is testable without waiting a minute.
 */
export function shouldReviewOnSave(input: {
    text: string;
    state?: ReviewState;
    now: number;
    minChars?: number;
    cooldownMs?: number;
    minChangedChars?: number;
}): ReviewDecision {
    const minChars = input.minChars ?? MIN_REVIEW_CHARS;
    const cooldownMs = input.cooldownMs ?? REVIEW_COOLDOWN_MS;
    const minChanged = input.minChangedChars ?? MIN_CHANGED_CHARS;

    const text = input.text ?? "";
    if (text.trim().length < minChars) {
        return { review: false, reason: "too_short" };
    }

    if (!input.state) {
        return { review: true, reason: "first_review" };
    }

    // Cooldown is checked before the diff: a rapid save cycle on a heavily
    // edited paragraph is exactly the case that would otherwise spend most.
    if (input.now - input.state.lastReviewedAt < cooldownMs) {
        return { review: false, reason: "cooling_down" };
    }

    if (changedChars(input.state.lastReviewedText, text) < minChanged) {
        return { review: false, reason: "unchanged" };
    }

    return { review: true, reason: "changed_enough" };
}

/** Which lenses a document's archetype should be read through. */
export function lensesForArchetype(archetype: ScribeArchetypeMode): ScribeLensType[] {
    switch (archetype) {
        case "saas_msa":
        case "harvard_batna":
        case "ai_system_governance":
        case "bias_mitigation_strategy":
            return ["legal", "devils_advocate", "fact_check"];
        case "data_lineage_narrative":
            return ["fact_check", "legal"];
        case "heros_journey":
        case "story_circle":
        case "save_the_cat":
            return ["pacing", "stylistic"];
        case "imrad_paper":
            return ["fact_check", "stylistic"];
        default:
            return ["stylistic", "devils_advocate"];
    }
}

/**
 * One prompt covering every active lens.
 *
 * runCriticEvaluation asks per lens, which is right for an explicit audit the
 * author asked for and wrong here: it would multiply an already-bounded budget
 * by the lens count on every save.
 */
export function buildAmbientPrompt(
    text: string,
    stationTitle: string,
    lenses: ScribeLensType[],
): string {
    return `You are reviewing one section of a working draft, mid-edit. The author is still writing.

SECTION: "${stationTitle}"
"""
${text}
"""

Review it through these lenses only: ${lenses.join(", ")}.

- "legal": uncapped liability, missing remedies, vague definitions, compliance gaps.
- "devils_advocate": logical gaps, unstated assumptions, loopholes.
- "fact_check": numbers that contradict each other, unsupported claims.
- "pacing": tension, momentum, scenes that stall.
- "stylistic": passive voice, bloat, tonal drift.

Report at most 3 findings, and only ones that matter. Silence is a valid answer
for a section that reads well — do not invent problems to fill the list.

Return ONLY a JSON array:
[
  {
    "lens": "one of the lenses above",
    "severity": "info" | "suggestion" | "warning" | "critical_conflict",
    "title": "short label",
    "detail": "what is wrong and why it matters",
    "excerpt": "the exact phrase from the section this refers to, or null",
    "replacement": "a concrete rewrite of that phrase, or null"
  }
]`;
}

interface RawFinding {
    lens?: string;
    severity?: string;
    title?: string;
    detail?: string;
    excerpt?: string | null;
    replacement?: string | null;
}

const SEVERITIES = new Set(["info", "suggestion", "warning", "critical_conflict"]);

/**
 * Parse the model's reply into insights, discarding anything malformed.
 *
 * A model that returns prose, a truncated array, or a finding with no title is
 * a normal occurrence, not an error worth failing a save over — the author gets
 * fewer markers, and nothing else changes.
 */
export function parseAmbientFindings(
    raw: string | null | undefined,
    text: string,
    lenses: ScribeLensType[],
): AmbientInsight[] {
    if (!raw) return [];
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];

    let parsed: RawFinding[];
    try {
        parsed = JSON.parse(match[0]);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) return [];

    const allowed = new Set<string>(lenses);
    const out: AmbientInsight[] = [];

    for (const f of parsed.slice(0, 3)) {
        if (!f?.title || !f?.detail) continue;

        const lens = allowed.has(String(f.lens)) ? (f.lens as ScribeLensType) : lenses[0];
        const severity = SEVERITIES.has(String(f.severity)) ? f.severity! : "suggestion";

        // Anchor to the real text where possible so the gutter marker lands on
        // the phrase. A model quoting something it did not write gets no anchor
        // rather than a wrong one.
        const excerpt = f.excerpt ?? "";
        const start = excerpt ? text.indexOf(excerpt) : -1;

        out.push({
            ruleId: `tier2:${lens}`,
            lensType: lens,
            severity: severity as AmbientInsight["severity"],
            title: String(f.title).slice(0, 120),
            detail: String(f.detail).slice(0, 600),
            start: start >= 0 ? start : 0,
            end: start >= 0 ? start + excerpt.length : 0,
            excerpt: start >= 0 ? excerpt : "",
            ...(f.replacement ? { replacement: String(f.replacement) } : {}),
        } as AmbientInsight & { replacement?: string });
    }

    return out;
}

/** In-process review state. Best-effort: a restart or a second process re-reviews once. */
const reviewState = new Map<number, ReviewState>();

export function getReviewState(nodeId: number): ReviewState | undefined {
    return reviewState.get(nodeId);
}

export function recordReview(nodeId: number, text: string, now: number): void {
    reviewState.set(nodeId, { lastReviewedText: text, lastReviewedAt: now });
}

/** Testing seam — the map is process-global. */
export function resetReviewState(): void {
    reviewState.clear();
}

export function logSkip(nodeId: number, reason: ReviewDecision["reason"]): void {
    logger.debug(`[Tier2] Skipped station ${nodeId}: ${reason}`);
}
