/**
 * An unwired layer must stay unwired.
 *
 * The rail derives its pieces from the room's turns, so on its own it shows whatever
 * the last mount_builder_pod artifact contained. A layer removed from the draft would
 * reappear the moment an agent re-emitted that artifact — the removal looked durable
 * for a session and then silently undid itself. The draft outlives the conversation and
 * is what a deploy actually reads, so it decides what is still wired.
 *
 * This pins the decision rule itself, which is the part that has to be exactly right:
 * hide only a draft-backed layer the draft demonstrably no longer holds, and never hide
 * on unknown state.
 */
import { describe, it, expect } from "vitest";

const DRAFT_BACKED_LAYERS: Record<string, "components" | "pipelineSteps" | "dataset"> = {
    'piece-ui': 'components',
    'piece-pipeline': 'pipelineSteps',
    'piece-dataset': 'dataset',
};

/** Mirrors the filter in ModularAssemblyPuzzleRail. */
function isVisible(
    pieceId: string,
    unwiredPieceIds: string[],
    draftLayers: Record<string, boolean> | null,
): boolean {
    if (unwiredPieceIds.includes(pieceId)) return false;
    const layer = DRAFT_BACKED_LAYERS[pieceId];
    if (!layer || !draftLayers) return true;
    return draftLayers[layer] !== false;
}

const ALL_PRESENT = { components: true, pipelineSteps: true, dataset: true };

describe("assembly stack visibility", () => {
    it("hides a layer the draft no longer holds, even though a turn still describes it", () => {
        const draft = { ...ALL_PRESENT, pipelineSteps: false };
        expect(isVisible("piece-pipeline", [], draft)).toBe(false);
    });

    it("keeps layers the draft still holds", () => {
        expect(isVisible("piece-ui", [], ALL_PRESENT)).toBe(true);
        expect(isVisible("piece-dataset", [], ALL_PRESENT)).toBe(true);
    });

    it("hides immediately on removal, before the draft is re-read", () => {
        expect(isVisible("piece-ui", ["piece-ui"], ALL_PRESENT)).toBe(false);
    });

    it("never hides when the draft state is unknown", () => {
        // No draft, or an admin-gated / expired fetch that failed. Neither is evidence
        // that a layer was removed, and hiding would make a failed read look like data loss.
        expect(isVisible("piece-pipeline", [], null)).toBe(true);
        expect(isVisible("piece-ui", [], null)).toBe(true);
    });

    it("leaves pieces that are not draft-backed alone", () => {
        // Project scope, reports, ontology, adapters and attachments have nothing behind
        // them in the draft, so an empty draft must not erase them.
        const emptyDraft = { components: false, pipelineSteps: false, dataset: false };
        for (const id of ["piece-project", "report-format-pdf", "attachment-7", "adapter-slack"]) {
            expect(isVisible(id, [], emptyDraft)).toBe(true);
        }
    });

    it("treats a missing key as present rather than removed", () => {
        // A draft shape that predates a layer should not blank that layer out.
        expect(isVisible("piece-dataset", [], { components: true } as any)).toBe(true);
    });
});
