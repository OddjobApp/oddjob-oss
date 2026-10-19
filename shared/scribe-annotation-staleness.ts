/**
 * Whether a critique is still about text that exists.
 *
 * Nothing has ever invalidated an annotation. updateNodeContent rewrites a
 * station and leaves every finding against it sitting at status "open", so a
 * critique of a paragraph the author deleted an hour ago still shows in the
 * margin, still drags down the Health Index, and still offers "Apply Proposed
 * Fix" — a replacement written for text that is gone.
 *
 * paragraphAnchor is what makes this answerable without a model. The critic
 * pass only stores an anchor it verified was present in the station at the
 * time (see anchorFor), so the anchor's absence now is evidence the passage
 * changed, not evidence the model misquoted.
 *
 * Lives in shared/ because both sides need the same answer: the server derives
 * it for the initial payload, and the client re-derives it as the author types.
 * A flag computed once on the server is wrong the moment they edit a station,
 * which is precisely the moment it matters.
 *
 * The bias is deliberate and one-directional: when in doubt, current. Marking a
 * live critique stale hides a real finding, which is a worse failure than
 * leaving a dead one on screen — that is merely the situation today.
 */

import type { ScribeAnnotation, ScribeNode } from "./schema/scribe.js";

export type StaleReason =
    /** The anchored passage is no longer in the station. */
    | "text_changed"
    /** The annotation belongs to a node outside the branch being viewed. */
    | "other_branch";

export type AnnotationView = ScribeAnnotation & {
    isStale: boolean;
    staleReason?: StaleReason;
};

/**
 * Collapse runs of whitespace so a reflowed paragraph does not read as a
 * rewritten one. An author who rewraps a line has not invalidated the critique,
 * and calling that stale would train them to ignore the flag.
 */
function normalise(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

/** Whether the passage a critique points at is still in the station. */
export function anchorSurvives(anchor: string, content: string): boolean {
    const needle = normalise(anchor);
    if (!needle) return true; // nothing to look for; not evidence of change
    return normalise(content).includes(needle);
}

/**
 * Tag each annotation with whether it still applies.
 *
 * `nodes` is the branch currently in view. An annotation against a node outside
 * it is not wrong, just not about what is on screen — it should not be counted
 * in a score describing this branch.
 */
export function markStaleness(
    annotations: ScribeAnnotation[],
    nodes: Pick<ScribeNode, "id" | "content">[],
): AnnotationView[] {
    const contentByNode = new Map(nodes.map((n) => [n.id, n.content ?? ""]));

    return annotations.map((annotation) => {
        // A settled annotation is a record of a decision, not an open finding.
        // Re-judging it would relabel the author's own accept or reject.
        if (annotation.status !== "open") return { ...annotation, isStale: false };

        const content = contentByNode.get(annotation.nodeId);
        if (content === undefined) {
            return { ...annotation, isStale: true, staleReason: "other_branch" as const };
        }

        // No anchor means the critique was about the section as a whole, or was
        // written by hand. There is nothing to check it against, so it stands.
        if (!annotation.paragraphAnchor) return { ...annotation, isStale: false };

        return anchorSurvives(annotation.paragraphAnchor, content)
            ? { ...annotation, isStale: false }
            : { ...annotation, isStale: true, staleReason: "text_changed" as const };
    });
}

/**
 * The findings a quality score should be computed from.
 *
 * Both exclusions matter for the same reason: a score is a claim about the
 * document as it stands, and a critique of deleted text says nothing about it.
 */
export function scorableAnnotations(annotations: AnnotationView[]): AnnotationView[] {
    return annotations.filter((a) => !a.isStale);
}
