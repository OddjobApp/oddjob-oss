/**
 * Tier 1 ambient review: what can be said about a paragraph without asking a
 * model.
 *
 * The point of tiering is spend. A load simulation of a real drafting session
 * (server/domain/scribe/tests/authoring-load.sim.test.ts) put a deliberate
 * author — 500ms between keystrokes, which is the contract-drafting profile —
 * at 800 deltas against 20 saves. Three model-backed sentinels on each of those
 * is 2,400 calls for twenty bursts of typing. So Tier 1 is rules only: it can
 * run on every delta because it costs nothing, and it carries the alerts that
 * are objective anyway.
 *
 * Tier 2 (the model-backed critics) settles on the save boundary instead, where
 * the author is already pausing and the count is bounded by saves.
 *
 * Everything here is a pure function over text. No database, no network, no
 * clock — so it is cheap to run per keystroke and cheap to test exhaustively.
 */

import type { ScribeArchetypeMode, ScribeAnnotationSeverity, ScribeLensType } from "@shared/schema/scribe.js";
import { findUndefinedTerms, findTermDrift } from "./defined-terms.service.js";
import { findFigureConflicts, findDataTetherConflicts, type DataTether } from "./figures.service.js";

/**
 * One ambient finding. Deliberately shaped like a scribe annotation — same lens
 * and severity vocabulary — so promoting an insight into a real margin
 * annotation is a write, not a translation.
 */
export interface AmbientInsight {
    ruleId: string;
    lensType: ScribeLensType;
    severity: ScribeAnnotationSeverity;
    title: string;
    detail: string;
    /** Character offsets into the analysed text, for gutter placement. */
    start: number;
    end: number;
    /** The matched text, so the client can show what it caught. */
    excerpt: string;
    /**
     * For term_drift: the form the document defined. The client needs it and
     * the variant separately to offer "always allow this spelling" — reading
     * either back out of the title would be parsing prose.
     */
    canonical?: string;
}

interface Rule {
    id: string;
    lensType: ScribeLensType;
    severity: ScribeAnnotationSeverity;
    title: string;
    detail: string;
    /**
     * Most rules are a pattern. Some need to weigh context on both sides of a
     * match, which one regex does badly — see sla_without_unit, whose first
     * attempt flagged "99.9% uptime" and missed "response time of 4".
     */
    pattern?: RegExp;
    detect?: (text: string) => Array<{ start: number; end: number }>;
    /** Restrict to archetypes where the rule is meaningful; omit for all. */
    archetypes?: ScribeArchetypeMode[];
}

const SLA_NOUNS = /\b(uptime|availability|response time|resolution time)\b/gi;
/**
 * A figure carrying a unit is measurable; a bare one is not.
 *
 * The word boundary applies only to the alphabetic units. Trailing it after the
 * whole alternation silently excluded "%", because `%` and the space after it
 * are both non-word characters and \b can never hold between them — so
 * "99.9% uptime" read as unitless and got flagged.
 */
const NUMBER_WITH_UNIT = /\b\d+(?:\.\d+)?\s*(?:%|(?:ms|s|sec|secs|seconds|min|mins|minutes|hours?|hrs?|days?)\b)/i;
const BARE_NUMBER = /\b\d+(?:\.\d+)?\b/;

/**
 * A service level is unmeasurable when the figure beside it carries no unit.
 *
 * Both orderings occur in real contracts — "99.9 uptime" and "response time of
 * 4" — so a window either side of the noun is examined, and a unit anywhere in
 * it clears the clause. A noun with no figure at all is prose, not an SLA.
 */
function detectUnmeasurableSla(text: string): Array<{ start: number; end: number }> {
    const hits: Array<{ start: number; end: number }> = [];
    const re = new RegExp(SLA_NOUNS.source, SLA_NOUNS.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const from = Math.max(0, m.index - 40);
        const to = Math.min(text.length, m.index + m[0].length + 40);
        const window = text.slice(from, to);

        if (NUMBER_WITH_UNIT.test(window)) continue;
        if (!BARE_NUMBER.test(window)) continue;
        hits.push({ start: m.index, end: m.index + m[0].length });
    }
    return hits;
}

const AVAILABILITY_TARGET = /\b(?:uptime|availability)\b|\b\d{2}\.\d+\s*%/gi;
const REMEDY_LANGUAGE = /\b(service credit|credits?|remedy|remedies|refund|corrective action|maintenance window|penalt)/i;

/**
 * An availability commitment with nothing that happens when it is missed.
 *
 * A target is only a target if breaching it costs something. This is the
 * omission a customer's counsel finds first, and it is objective enough to
 * catch without a model: the clause names an availability figure and nowhere
 * near it says what follows from failing it.
 */
function detectSlaWithoutRemedy(text: string): Array<{ start: number; end: number }> {
    // Remedy language anywhere in the station clears the whole station: the
    // credit is routinely defined a sentence or two below the target, and
    // flagging that would be noise.
    if (REMEDY_LANGUAGE.test(text)) return [];

    const re = new RegExp(AVAILABILITY_TARGET.source, AVAILABILITY_TARGET.flags);
    const m = re.exec(text);
    // One marker per station. A clause mentioning uptime four times has one
    // missing remedy, not four.
    return m ? [{ start: m.index, end: m.index + m[0].length }] : [];
}

/**
 * A sentence long enough that a reader loses the thread.
 *
 * Thirty-eight words is the threshold the earlier implementation used and it
 * is a reasonable one for contract and executive prose. Reported once per
 * station rather than per sentence, so a dense paragraph raises one marker.
 */
function detectOverlongSentence(text: string): Array<{ start: number; end: number }> {
    let cursor = 0;
    for (const part of text.split(/(?<=[.!?])\s+/)) {
        const words = part.trim().split(/\s+/).filter(Boolean).length;
        if (words > 38) {
            const start = text.indexOf(part, cursor);
            if (start >= 0) return [{ start, end: start + part.length }];
        }
        cursor += part.length;
    }
    return [];
}

/** Contract-shaped archetypes, where legal precision rules apply. */
const LEGAL_ARCHETYPES: ScribeArchetypeMode[] = ["saas_msa", "harvard_batna"];

/**
 * Rules run in order and every match is reported, so a sentence can raise more
 * than one. Each pattern is global — findings are per occurrence, not per rule,
 * because an author wants the gutter marker next to the actual phrase.
 */
const RULES: Rule[] = [
    {
        id: "placeholder_token",
        lensType: "todo",
        severity: "warning",
        title: "Unresolved placeholder",
        detail: "A placeholder is still in the text. These are the things that ship by accident.",
        pattern: /\b(TODO|TBD|FIXME|XXX|PLACEHOLDER)\b/gi,
    },
    {
        id: "bracketed_blank",
        lensType: "todo",
        severity: "warning",
        title: "Unfilled field",
        detail: "A bracketed blank has not been filled in.",
        // [PARTY NAME], [__], <INSERT DATE> — but not ordinary [1] citations.
        // Also a bare run of underscores used as a signature or fill-in line,
        // and a mixed-case [Insert ...], both of which the parallel
        // implementation caught and this one did not.
        pattern: /(\[[A-Za-z_ ]*(?:INSERT|Insert)[^\]]*\]|\[[A-Z_ ]{2,}\]|<[A-Z_ ]{2,}>|\[_+\]|_{3,})/g,
    },
    {
        id: "lorem_ipsum",
        lensType: "todo",
        severity: "critical_conflict",
        title: "Lorem ipsum in the manuscript",
        detail: "Filler text is still present.",
        pattern: /\blorem ipsum\b/gi,
    },
    {
        id: "vague_obligation",
        lensType: "legal",
        severity: "warning",
        title: "Unmeasurable obligation",
        detail:
            "This commits to a standard nobody can test. Give it a number, a deadline, or a named " +
            "benchmark.",
        pattern:
            /\b(reasonable efforts?|best efforts?|commercially reasonable|promptly|in a timely manner|as soon as (?:reasonably )?possible|from time to time|material(?:ly)?(?! breach))\b/gi,
        archetypes: LEGAL_ARCHETYPES,
    },
    {
        id: "unbounded_liability",
        lensType: "legal",
        severity: "critical_conflict",
        title: "Unbounded liability language",
        detail: "Liability is stated without a cap. Confirm a ceiling is defined elsewhere.",
        // "indemnify without limitation" came from the parallel implementation
        // this rule absorbed; it is the same defect worded as an indemnity.
        pattern: /\b(unlimited liability|without limitation of liability|no cap on liability|indemnif\w+ without limitation)\b/gi,
        archetypes: LEGAL_ARCHETYPES,
    },
    {
        id: "sla_without_unit",
        lensType: "fact_check",
        severity: "suggestion",
        title: "Metric without a unit",
        detail: "A service level with no unit or window cannot be measured or breached.",
        // "99.9 uptime" / "response time of 4" — a bare number next to an SLA
        // noun, with no unit following.
        detect: detectUnmeasurableSla,
        archetypes: LEGAL_ARCHETYPES,
    },
    {
        id: "sla_without_remedy",
        lensType: "legal",
        severity: "warning",
        title: "Availability target with no remedy",
        detail:
            "An availability figure is committed to without saying what happens when it is missed. " +
            "A target with no service credit or corrective action is not enforceable as one.",
        detect: detectSlaWithoutRemedy,
        archetypes: LEGAL_ARCHETYPES,
    },
    {
        id: "overlong_sentence",
        lensType: "stylistic",
        severity: "suggestion",
        title: "Sentence runs long",
        detail: "Over 38 words in one sentence. Splitting it usually costs nothing and reads better.",
        detect: detectOverlongSentence,
    },
    {
        id: "double_space_after_period",
        lensType: "stylistic",
        severity: "info",
        title: "Inconsistent sentence spacing",
        detail: "Two spaces after a full stop, where the rest of the document uses one.",
        pattern: /\.\s{2,}(?=[A-Z])/g,
    },
    {
        id: "duplicated_word",
        lensType: "stylistic",
        severity: "suggestion",
        title: "Repeated word",
        detail: "The same word appears twice in a row.",
        pattern: /\b(\w+)\s+\1\b/gi,
    },
];

/** Rules that apply to a document of this archetype. */
function rulesFor(archetype: ScribeArchetypeMode): Rule[] {
    return RULES.filter((r) => !r.archetypes || r.archetypes.includes(archetype));
}

/** Cap per delta: a paste of a placeholder-riddled draft must not flood the room. */
const MAX_INSIGHTS = 25;

/**
 * Evaluate one station's text. Pure: same text and archetype, same insights, in
 * document order.
 */
export function evaluateAmbient(
    text: string,
    archetype: ScribeArchetypeMode = "freeform",
    /**
     * The document's defined-term ledger and active data tethers. Without it
     * the term checks can only see this station, and live calculation tethers
     * cannot verify draft numbers.
     */
    ledger?: { terms: string[]; aliases: string[]; tethers?: DataTether[] },
): AmbientInsight[] {
    if (!text) return [];

    const found: AmbientInsight[] = [];

    // Term checks apply to contract-shaped documents only. A novel is full of
    // capitalised multi-word phrases — every character and place name — and
    // none of them is a defined term.
    if (ledger && LEGAL_ARCHETYPES.includes(archetype)) {
        for (const u of findUndefinedTerms(text, ledger.terms)) {
            found.push({
                ruleId: "undefined_term",
                lensType: "legal",
                severity: "warning",
                title: `"${u.term}" is not defined`,
                detail:
                    "This reads as a defined term but the document never defines it. An undefined " +
                    "term has no agreed meaning, and the clause turns on it.",
                start: u.start,
                end: u.end,
                excerpt: u.term,
            });
        }

        for (const d of findTermDrift(text, ledger.terms, ledger.aliases)) {
            found.push({
                ruleId: "term_drift",
                lensType: "legal",
                severity: "suggestion",
                title: `"${d.variant}" should be "${d.canonical}"`,
                detail:
                    `The document defines "${d.canonical}". Written another way it reads as a ` +
                    "second, undefined thing.",
                start: d.start,
                end: d.end,
                excerpt: d.variant,
                canonical: d.canonical,
            });
        }
    }

    // Live calculation and data tether checks: verifies that numeric commitments
    // in prose match the calculation engine's latest truth.
    if (ledger?.tethers && ledger.tethers.length > 0) {
        for (const tc of findDataTetherConflicts(text, ledger.tethers)) {
            found.push({
                ruleId: "tether_conflict",
                lensType: "fact_check",
                severity: "critical_conflict",
                title: `${tc.label} is ${tc.drafted.raw}, but tethered calculation resolves to ${tc.tetherRaw}`,
                detail:
                    `The document tethers "${tc.label}" to live calculation node #${tc.calculationNodeId ?? "N/A"} ` +
                    `(${tc.tetherRaw}). The draft currently states ${tc.drafted.raw}.`,
                start: tc.drafted.start,
                end: tc.drafted.end,
                excerpt: tc.drafted.raw,
                canonical: tc.tetherRaw,
            });
        }
    }

    // Numeric self-contradiction applies everywhere, not just to contracts. It
    // needs no ledger and no archetype gate: a figure stated one way and then
    // another is a defect in an agreement, a board paper or a chapter alike,
    // and the label has to be defined-term-shaped for it to fire at all.
    for (const c of findFigureConflicts(text)) {
        found.push({
            ruleId: "figure_conflict",
            lensType: "fact_check",
            severity: "critical_conflict",
            title: `${c.label} is stated as both ${c.first.raw} and ${c.second.raw}`,
            detail:
                `Earlier the document says ${c.first.raw}; here it says ${c.second.raw}. Both read ` +
                "as correct on their own, which is why a mismatch like this survives a read-through.",
            // Anchored at the later figure: that is the one on screen, and the
            // earlier one has already been read past.
            start: c.second.start,
            end: c.second.end,
            excerpt: c.second.raw,
        });
    }

    for (const rule of rulesFor(archetype)) {
        if (rule.detect) {
            for (const { start, end } of rule.detect(text)) {
                found.push({
                    ruleId: rule.id,
                    lensType: rule.lensType,
                    severity: rule.severity,
                    title: rule.title,
                    detail: rule.detail,
                    start,
                    end,
                    excerpt: text.slice(start, end),
                });
            }
            continue;
        }
        if (!rule.pattern) continue;

        // Fresh regex per call: a shared global RegExp carries lastIndex
        // between calls and silently skips matches on the second run.
        const re = new RegExp(rule.pattern.source, rule.pattern.flags);
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
            // A zero-width match would spin forever.
            if (m[0].length === 0) {
                re.lastIndex++;
                continue;
            }
            found.push({
                ruleId: rule.id,
                lensType: rule.lensType,
                severity: rule.severity,
                title: rule.title,
                detail: rule.detail,
                start: m.index,
                end: m.index + m[0].length,
                excerpt: m[0],
            });
        }
    }

    found.sort((a, b) => a.start - b.start || a.ruleId.localeCompare(b.ruleId));
    return found.slice(0, MAX_INSIGHTS);
}

/** Severity ranking, for the single gutter badge when a line has several. */
const SEVERITY_RANK: Record<ScribeAnnotationSeverity, number> = {
    info: 0,
    suggestion: 1,
    warning: 2,
    critical_conflict: 3,
};

/** The worst thing found, which is what the station marker should show. */
export function highestSeverity(insights: AmbientInsight[]): ScribeAnnotationSeverity | null {
    if (insights.length === 0) return null;
    return insights.reduce((worst, i) =>
        SEVERITY_RANK[i.severity] > SEVERITY_RANK[worst.severity] ? i : worst,
    ).severity;
}

/**
 * Whether a re-evaluation is worth broadcasting.
 *
 * An author typing inside a clean paragraph produces delta after delta with an
 * empty finding set. Publishing each one wakes every subscriber in the room to
 * tell them nothing changed, so only transitions are sent.
 */
export function insightsChanged(previous: AmbientInsight[], next: AmbientInsight[]): boolean {
    if (previous.length !== next.length) return true;
    const key = (i: AmbientInsight) => `${i.ruleId}:${i.start}:${i.end}`;
    const before = previous.map(key).join("|");
    const after = next.map(key).join("|");
    return before !== after;
}
