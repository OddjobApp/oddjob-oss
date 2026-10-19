/**
 * Crystallize has one promise: press it and the skeleton is there.
 *
 * It used to seed a station only when a word from that station's title or
 * description literally appeared in the author's paragraph, plus whichever
 * station was first. On a twelve-station framework a short paragraph matches
 * almost nothing, so the button filled one section and left eleven blank.
 *
 * So the test that matters most is the boring one: no station is empty
 * afterwards, including when the model is unavailable.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const generateText = vi.fn();
const updates: Array<{ id: number; content: string; wordCount: number }> = [];

vi.mock("@domain/ai/index.js", () => ({ systemAiService: { generateText } }));
vi.mock("@domain/crew/core/crew-stream.service.js", () => ({
    crewStreamService: { publish: vi.fn() },
}));
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const STATIONS = [
    { id: 1, stationKey: "ordinary_world", title: "1. The Ordinary World", content: "", sortOrder: 1 },
    { id: 2, stationKey: "call_to_adventure", title: "2. Call to Adventure", content: "", sortOrder: 2 },
    { id: 3, stationKey: "refusal_of_call", title: "3. Refusal of the Call", content: "", sortOrder: 3 },
    { id: 4, stationKey: "meeting_mentor", title: "4. Meeting the Mentor", content: "", sortOrder: 4 },
];

let stations = STATIONS.map((s) => ({ ...s }));

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => ({
            from: () => ({
                where: () => ({
                    limit: async () => [{ id: 5, sessionId: 42, archetypeMode: "heros_journey", organizationId: 7, activeBranchId: 1, title: "Saga", targetWordCount: 1000 }],
                    orderBy: async () => stations,
                }),
            }),
        }),
        update: () => ({
            set: (vals: any) => ({
                where: async () => {
                    updates.push({ id: -1, content: vals.content, wordCount: vals.wordCount });
                },
            }),
        }),
    },
}));

const { scribeService } = await import("../core/scribe.service.js");

// getDocument at the end re-reads; stub it so these tests are about seeding.
vi.spyOn(scribeService, "getDocument").mockImplementation(async () => ({ nodes: stations }) as any);

const CONTEXT = "A memoir about leaving a career in law to farm olives in Puglia.";

describe("crystallize seeds every station", () => {
    beforeEach(() => {
        generateText.mockReset();
        updates.length = 0;
        stations = STATIONS.map((s) => ({ ...s }));
    });

    it("fills all four stations when the model drafts them", async () => {
        generateText.mockResolvedValue(JSON.stringify({
            ordinary_world: "The office was quiet at 6am.",
            call_to_adventure: "The letter from Puglia arrived on a Tuesday.",
            refusal_of_call: "She filed it under things to ignore.",
            meeting_mentor: "The olive farmer had three words of advice.",
        }));

        await scribeService.crystallizeFromContext(5, 7, CONTEXT);

        expect(updates).toHaveLength(4);
        for (const u of updates) {
            expect(u.content.trim().length).toBeGreaterThan(0);
            expect(u.wordCount).toBeGreaterThan(0);
        }
    });

    it("still fills every station when the model returns nothing at all", async () => {
        generateText.mockResolvedValue("");

        await scribeService.crystallizeFromContext(5, 7, CONTEXT);

        // The promise of the button does not depend on a model being reachable.
        expect(updates).toHaveLength(4);
        for (const u of updates) {
            expect(u.content.trim().length).toBeGreaterThan(0);
        }
    });

    it("still fills every station when the model throws", async () => {
        generateText.mockRejectedValue(new Error("provider over quota"));

        await scribeService.crystallizeFromContext(5, 7, CONTEXT);

        expect(updates).toHaveLength(4);
        expect(updates.every((u) => u.content.trim().length > 0)).toBe(true);
    });

    it("fills the gaps when the model drafts only some stations", async () => {
        // The old failure mode, now covered: a partial answer must not leave
        // the remaining stations blank.
        generateText.mockResolvedValue(JSON.stringify({ ordinary_world: "The office was quiet." }));

        await scribeService.crystallizeFromContext(5, 7, CONTEXT);

        expect(updates).toHaveLength(4);
        expect(updates.every((u) => u.content.trim().length > 0)).toBe(true);
    });

    it("survives a model that answers in prose", async () => {
        generateText.mockResolvedValue("Sure! Here are some ideas for your memoir.");

        await scribeService.crystallizeFromContext(5, 7, CONTEXT);

        expect(updates.every((u) => u.content.trim().length > 0)).toBe(true);
    });

    it("asks the model once, not once per station", async () => {
        generateText.mockResolvedValue("{}");

        await scribeService.crystallizeFromContext(5, 7, CONTEXT);

        // Four stations here, twelve on a full hero's journey.
        expect(generateText).toHaveBeenCalledTimes(1);
    });

    it("does not overwrite a station the author already wrote", async () => {
        stations[1].content = "I had already written this opening myself.";
        generateText.mockResolvedValue(JSON.stringify({
            call_to_adventure: "A model draft that must not replace it.",
        }));

        await scribeService.crystallizeFromContext(5, 7, CONTEXT);

        const kept = updates.find((u) => u.content.includes("already written this opening"));
        expect(kept, "the author's own text was overwritten").toBeDefined();
    });

    it("substitutes entities into drafted text, not just template scaffolds", async () => {
        generateText.mockResolvedValue(JSON.stringify({
            ordinary_world: "This memoir is for {{client_name}}.",
        }));

        await scribeService.crystallizeFromContext(5, 7, CONTEXT, { client_name: "Ada Rossi" });

        const seeded = updates.find((u) => u.content.includes("Ada Rossi"));
        expect(seeded, "entity was not substituted into generated text").toBeDefined();
        expect(updates.some((u) => u.content.includes("{{client_name}}"))).toBe(false);
    });
});
