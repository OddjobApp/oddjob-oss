/**
 * Keeping a critic from writing terms the author never agreed to.
 *
 * The critic pass asks a model to "find uncapped liability, missing remedies,
 * non-compliance risks" and to return a "replacement text proposal". Nothing
 * stopped it inventing the missing part: a liability cap of its own choosing, a
 * remedy nobody negotiated, an obligation to comply with a standard the
 * document never mentions. Those arrived looking exactly like the sound
 * critiques, and proposedDiff is one click from being written into the clause.
 *
 * The prompt now tells the model not to. This is the part that does not depend
 * on it having listened.
 *
 * Two kinds of invention, handled differently, because they fail differently:
 *
 *   A figure the document does not contain is a guess at a term whose *shape*
 *   is right — the clause should have a cap, the model just picked the number.
 *   That is repairable: blank the number and let the author fill it. The blank
 *   is deliberately bracketed, so Tier 1's bracketed_blank rule picks it up and
 *   the open decision is tracked rather than forgotten.
 *
 *   A named standard the document does not mention is different. "The vendor
 *   shall maintain SOC 2 Type II certification" is not a clause with a gap in
 *   it, it is an obligation the model decided applied. There is nothing to
 *   blank out, so the proposal is dropped and only the observation survives.
 *
 * The critique itself is never suppressed. "Liability here is uncapped" is
 * worth saying even when the model's proposed cap is not worth applying.
 */

import { parseFigures } from "./figures.service.js";

export interface ScreenedProposal {
    /** What to store. Null when the proposal could not be made safe. */
    proposedDiff: string | null;
    /** Plain-language notes for the author, empty when nothing was changed. */
    redactions: string[];
}

/**
 * Regimes a critic reaches for when asked about "non-compliance risks".
 *
 * Naming one the document never mentions invents an obligation: whether SOC 2
 * or HIPAA applies to an engagement is a question about the parties and the
 * data, which the reviewer cannot see and the model cannot infer from prose.
 */
const NAMED_STANDARDS =
    /\b(GDPR|UK GDPR|CCPA|CPRA|HIPAA|SOC\s?2(?:\s?Type\s?I{1,2})?|ISO[\s-]?\d{4,5}(?:[:-]\d{4})?|PCI[\s-]?DSS|SOX|Sarbanes[\s-]?Oxley|NIST(?:\s?\d+(?:-\d+)?)?|FedRAMP|FISMA|COPPA|GLBA|DORA|NIS\s?2|EU\s?AI\s?Act|CMMC|HITRUST|FERPA)\b/gi;

/**
 * Figures worth screening.
 *
 * Anything carrying a currency or a percent is a commercial term. A bare number
 * is screened from 10 upward, which catches notice periods, terms and
 * thresholds while leaving list numbering and "the 3 parties" alone —
 * over-redaction would put brackets through ordinary prose and teach the author
 * to ignore them.
 */
function isSubstantive(figure: { unit: string | null; value: number }): boolean {
    return figure.unit !== null || figure.value >= 10;
}

/** What to leave in the text in place of a number the model chose. */
function blankFor(unit: string | null): string {
    if (unit === "%") return "[PERCENTAGE — to be agreed]";
    if (unit) return "[AMOUNT — to be agreed]";
    return "[NUMBER — to be agreed]";
}

/**
 * Screen a proposed replacement against what the document actually says.
 *
 * `known` should be the whole document, not the station being reviewed: a cap
 * defined in the payment terms is not invented because the indemnity clause is
 * the one under review.
 */
export function screenProposal(
    proposedDiff: string | null | undefined,
    known: string,
): ScreenedProposal {
    const proposal = typeof proposedDiff === "string" ? proposedDiff.trim() : "";
    if (!proposal) return { proposedDiff: null, redactions: [] };

    // An obligation cannot be repaired by blanking part of it.
    const inventedStandards = [
        ...new Set(
            (proposal.match(NAMED_STANDARDS) ?? []).filter(
                (name) => !new RegExp(escapeRegExp(name), "i").test(known),
            ),
        ),
    ];
    if (inventedStandards.length > 0) {
        return {
            proposedDiff: null,
            redactions: [
                `The suggested wording required compliance with ${inventedStandards.join(", ")}, ` +
                `which this document does not mention. Whether that applies is yours to decide, ` +
                `so the wording was not offered for insertion.`,
            ],
        };
    }

    const knownValues = new Set(parseFigures(known).map((f) => f.value));
    const invented = parseFigures(proposal).filter(
        (f) => isSubstantive(f) && !knownValues.has(f.value),
    );
    if (invented.length === 0) return { proposedDiff: proposal, redactions: [] };

    // Right to left, so an earlier replacement does not shift a later offset.
    let redacted = proposal;
    for (const figure of [...invented].sort((a, b) => b.start - a.start)) {
        redacted = redacted.slice(0, figure.start) + blankFor(figure.unit) + redacted.slice(figure.end);
    }

    return {
        proposedDiff: redacted,
        redactions: [
            `The suggested wording named ${invented.map((f) => f.raw).join(", ")}, which ` +
            `${invented.length === 1 ? "does" : "do"} not appear anywhere in this document. ` +
            `${invented.length === 1 ? "It has" : "They have"} been left blank for you to fill in.`,
        ],
    };
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
