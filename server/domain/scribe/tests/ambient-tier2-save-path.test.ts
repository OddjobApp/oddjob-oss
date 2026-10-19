/**
 * Tier 2 on the real save path.
 *
 * The guards are unit-tested elsewhere; what this holds is that they are
 * actually consulted before a model call is made, and that a save never waits
 * on — or fails because of — the review.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const generateText = vi.fn();
const published: any[] = [];

vi.mock("@domain/ai/index.js", () => ({
    systemAiService: { generateText },
}));

vi.mock("@domain/crew/core/crew-stream.service.js", () => ({
    crewStreamService: { publish: vi.fn(async (e: any) => { published.push(e); }) },
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const doc = { id: 5, sessionId: 42, archetypeMode: "saas_msa", organizationId: 7 };

/**
 * The org filter lives inside an opaque drizzle condition, so the mock cannot
 * evaluate it. What it can model is the outcome that matters: an org-scoped
 * lookup that matches nothing returns an empty row set.
 */
const dbRows = { empty: false };

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => ({
            from: () => ({
                where: () => ({
                    limit: async () => (dbRows.empty ? [] : [{ ...doc, sessionKey: "crew-room-42" }]),
                }),
            }),
        }),
    },
}));

const { scribeService } = await import("../core/scribe.service.js");
const { resetReviewState, MIN_REVIEW_CHARS } = await import("../core/ambient-tier2.service.js");

const review = (scribeService as any).reviewStationAmbient.bind(scribeService);

const station = (content: string, id = 11) => ({
    id,
    documentId: 5,
    title: "Liability",
    content,
    stationKey: "liability",
    branchId: 1,
    sortOrder: 1,
}) as any;

const substantial = "The vendor accepts unlimited liability for all losses. " + "x".repeat(MIN_REVIEW_CHARS);

const oneFinding = JSON.stringify([
    { lens: "legal", severity: "critical_conflict", title: "Uncapped liability", detail: "No ceiling is defined.", excerpt: "unlimited liability" },
]);

describe("Tier 2 on the save boundary", () => {
    beforeEach(() => {
        generateText.mockReset();
        published.length = 0;
        dbRows.empty = false;
        resetReviewState();
    });

    it("reviews a substantial station and publishes what it found", async () => {
        generateText.mockResolvedValue(oneFinding);

        await review(station(substantial), 7);

        expect(generateText).toHaveBeenCalledTimes(1);
        expect(published).toHaveLength(1);
        expect(published[0].type).toBe("scribe-insight");
        expect(published[0].payload.tier).toBe(2);
        expect(published[0].payload.insights[0].title).toBe("Uncapped liability");
    });

    it("spends nothing on a station too short to judge", async () => {
        await review(station("Just an opening line."), 7);

        // The guard runs before the model, which is the whole point.
        expect(generateText).not.toHaveBeenCalled();
        expect(published).toHaveLength(0);
    });

    it("spends nothing on a second save inside the cooldown", async () => {
        generateText.mockResolvedValue(oneFinding);

        await review(station(substantial), 7);
        await review(station(substantial + " and more text added here"), 7);

        // A burst of saves on one paragraph costs one call, not one per save.
        expect(generateText).toHaveBeenCalledTimes(1);
    });

    it("holds the cooldown even when the model call throws", async () => {
        generateText.mockRejectedValue(new Error("provider down"));

        await expect(review(station(substantial), 7)).rejects.toThrow("provider down");
        generateText.mockResolvedValue(oneFinding);
        await review(station(substantial + " changed substantially now"), 7);

        // State is recorded before the call, so a hung or failed provider
        // cannot leave the cooldown unset and let the next save start another.
        expect(generateText).toHaveBeenCalledTimes(1);
    });

    it("says nothing to the room when the model finds nothing", async () => {
        generateText.mockResolvedValue("[]");

        await review(station(substantial), 7);

        expect(generateText).toHaveBeenCalledTimes(1);
        // Silence is a valid review; it must not become an empty marker.
        expect(published).toHaveLength(0);
    });

    it("survives a model that answers in prose", async () => {
        generateText.mockResolvedValue("Looks good to me overall.");

        await expect(review(station(substantial), 7)).resolves.toBeUndefined();
        expect(published).toHaveLength(0);
    });

    it("stops before publishing when the org-scoped lookup finds no document", async () => {
        generateText.mockResolvedValue(oneFinding);
        // What a foreign organizationId produces: the where clause matches
        // nothing. The review must not fall through to the room.
        dbRows.empty = true;

        await review(station(substantial), 9999);

        expect(published).toHaveLength(0);
    });

    it("tracks cooldown per station, so a different one still reviews", async () => {
        generateText.mockResolvedValue(oneFinding);

        await review(station(substantial, 11), 7);
        await review(station(substantial, 22), 7);

        expect(generateText).toHaveBeenCalledTimes(2);
    });
});
