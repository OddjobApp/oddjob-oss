/**
 * What the progress footer reports.
 *
 * Two things were wrong with it.
 *
 * It was computed once, when getDocument built the payload, and never again.
 * Every later setDocView spreads the same telemetry object forward while
 * updating nodes, so the footer showed the word count as of page load for the
 * rest of the session — an author filled three stations and watched it sit at
 * "28 / 5000w, 1 / 3 Done" until publishing forced a reload.
 *
 * And a station counted as complete at 100 characters of content, while new
 * stations are seeded with their framework's suggestedScaffolding as content.
 * 18 of the 21 scaffolding strings are longer than 100 characters, so a
 * document reported most of its stations Done before the author typed a word.
 *
 * Pure, and in shared/, so the server can compute it for the payload and the
 * client can recompute it from the nodes it already has as the author types.
 */

import type { ScribeNode } from "./schema/scribe.js";

export interface DocumentTelemetry {
    totalWordCount: number;
    targetWordCount: number;
    completionPercentage: number;
    stationsComplete: number;
    totalStations: number;
    readabilityGrade: number;
    ekgPoints: Array<{ stationKey: string; score: number; label: string }>;
}

/** Used when a document carries no target of its own. */
export const DEFAULT_TARGET_WORD_COUNT = 10_000;

/** A station with no explicit allocation is assumed to be a tenth of the whole. */
const DEFAULT_STATION_SHARE = 0.1;

type TelemetryNode = Pick<
    ScribeNode,
    "stationKey" | "title" | "content" | "wordCount" | "status" | "targetPercentage"
>;

/**
 * Whether the author has actually drafted this station.
 *
 * wordCount is the honest signal, and the seed proves why: createOrGetDocument
 * inserts scaffolding as content with wordCount 0, so character length counts
 * prose the author never wrote while word count does not. The pod already
 * treats wordCount 0 across every node as "this document is untouched".
 */
export function isStationDrafted(node: Pick<TelemetryNode, "status" | "wordCount">): boolean {
    if (node.status === "approved") return true;
    return (node.wordCount ?? 0) > 0;
}

/**
 * A station's share of the document, as a fraction of the whole.
 *
 * Guarded because it becomes a divisor: targetPercentage is nullable, and a
 * stored 0 would otherwise divide by zero and score the station Infinity.
 */
function shareOf(node: TelemetryNode): number {
    const share = node.targetPercentage ?? 0;
    return share > 0 ? share : DEFAULT_STATION_SHARE;
}

/**
 * How full a station reads, 0-100.
 *
 * Rendered as a red / amber / green bar, so an empty station must not read as
 * healthy — it used to score a flat 20 and come out green, which made an
 * untouched document look like a finished one. Emptiness now scores 0, the
 * scale runs with the draft, and only real trouble reaches red: a station well
 * past its allocation, or one in continuity conflict.
 */
export function stationScore(node: TelemetryNode, targetWordCount: number): number {
    const allocation = Math.max(1, targetWordCount * shareOf(node));
    const fullness = Math.min(1, (node.wordCount ?? 0) / allocation);

    // A conflict is a floor, not an addend. Added to the length score it was
    // dilutable: a half-drafted station in conflict landed exactly on the
    // amber/red boundary, and an empty one came out amber, so the state the
    // band exists to show could fail to reach red.
    if (node.status === "continuity_conflict") return 90;

    // 0 empty, 60 at its allocation. Past that it is over-long, not better.
    const lengthScore = Math.round(fullness * 60);
    const overrun = (node.wordCount ?? 0) > allocation * 1.2 ? 25 : 0;

    return Math.min(100, lengthScore + overrun);
}

/** The footer's numbers, from the document as it currently stands. */
export function computeTelemetry(
    nodes: TelemetryNode[],
    documentTargetWordCount?: number | null,
): DocumentTelemetry {
    const targetWordCount = documentTargetWordCount || DEFAULT_TARGET_WORD_COUNT;
    const totalWordCount = nodes.reduce((sum, n) => sum + (n.wordCount || 0), 0);

    return {
        totalWordCount,
        targetWordCount,
        completionPercentage: Math.min(100, Math.round((totalWordCount / targetWordCount) * 100)),
        stationsComplete: nodes.filter(isStationDrafted).length,
        totalStations: nodes.length,
        // Not measured. Kept because the shape is on the wire; the footer does
        // not render it, and it should not start doing so on a constant.
        readabilityGrade: 10,
        ekgPoints: nodes.map((n) => ({
            stationKey: n.stationKey,
            score: stationScore(n, targetWordCount),
            label: n.title,
        })),
    };
}
