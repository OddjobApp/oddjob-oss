import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Drafting a production's story, and writing it in.
 *
 * The service is mocked because what is worth pinning here is not that Drizzle
 * inserts a row: it is the order the calls go out in, and the guard that refuses
 * a card drafted against a production that has since moved on. A story is
 * written to FOLLOW what was already there, so appending it to something else
 * produces a film that does not join up — and unlike a scene edit, there is no
 * digest at the scene's altitude to catch it.
 */

const addScene = vi.fn();
const updateScene = vi.fn();
const addPlotPoint = vi.fn();
const addShot = vi.fn();
const getProduction = vi.fn();

// recordMediaDecision is exported from the same module, so the mock has to
// carry it or applying throws "not a function" — the factory must stay in
// step with what the module exports.
const recordMediaDecision = vi.fn();

vi.mock("@domain/media-studio/core/media-studio.service.js", () => ({
    get recordMediaDecision() { return recordMediaDecision; },
    mediaStudio: {
        get addScene() { return addScene; },
        get updateScene() { return updateScene; },
        get addPlotPoint() { return addPlotPoint; },
        get addShot() { return addShot; },
        get getProduction() { return getProduction; },
    },
}));

const { applyMediaStory, draftMediaStory, readSceneDrafts } = await import("@domain/media-studio/core/media-story.js");

const ctx = { userId: "u1", organizationId: 1, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false } as any;

const scene = (id: number, sceneKey: string, title: string) => ({
    id, sceneKey, title, position: id, synopsis: "", scribeNodeId: null, station: null,
    location: "", timeOfDay: "", mood: "", plotPoints: [], shots: [], assembly: null,
});

const production = (scenes: ReturnType<typeof scene>[]) => ({
    id: 8, title: "Rooftop chase", aspectRatio: "2.39:1" as const, projectId: 2, crewSessionId: 410, updatedAt: "",
    scribeDocumentId: null, scribeDocumentTitle: null, characters: [], style: "", references: [],
    video: {} as any, budgetLimitCents: 10000, spendCents: 0, createdAt: "", scenes, projectStyleBible: null,
});

beforeEach(() => {
    vi.clearAllMocks();
});

describe("reading a model's reply as scenes", () => {
    it("keeps the scenes that parse and says what was wrong with the rest", () => {
        const reply = JSON.stringify({
            scenes: [
                { title: "Arrival", synopsis: "She reaches the roof.", plotPoints: [{ title: "She climbs" }] },
                { synopsis: "No title, so not a scene." },
                { title: "Escape", shots: [{ action: "Wide on the stairwell", durationSeconds: 6 }] },
            ],
        });
        const { scenes, problems } = readSceneDrafts(reply);
        expect(scenes.map((s) => s.title)).toEqual(["Arrival", "Escape"]);
        expect(problems).toContain("scenes.1");
    });

    it("reads a bare array and a fenced block, and reports a reply it cannot use", () => {
        expect(readSceneDrafts('```json\n[{"title":"Arrival"}]\n```').scenes.map((s) => s.title)).toEqual(["Arrival"]);
        expect(readSceneDrafts("not json").problems).toContain("not JSON");
        expect(readSceneDrafts('{"oops":1}').problems).toContain('no "scenes" list');
        expect(readSceneDrafts("").problems).toBe("The reply was empty.");
    });
});

describe("drafting a story", () => {
    it("drafts against the production as it is, and anchors the card to its scenes", async () => {
        getProduction.mockResolvedValue(production([scene(21, "SCENE-01", "Arrival")]));
        const model = vi.fn().mockResolvedValue(JSON.stringify({ scenes: [{ title: "The rooftop", synopsis: "She reaches it." }] }));

        const drafted = await draftMediaStory(ctx, 8, "a courier who steals a file", { model });
        if ("refused" in drafted) throw new Error(`refused: ${drafted.refused}`);

        expect(drafted).toMatchObject({
            productionId: 8,
            productionTitle: "Rooftop chase",
            premise: "a courier who steals a file",
            baseSceneKeys: ["SCENE-01"],
        });
        expect(drafted.proposalId).toMatch(/^mediastory_[0-9a-f]{32}$/);
        expect(drafted.summary).toEqual(['Scene 2 "The rooftop": She reaches it.']);

        // The prompt carries the scenes already written, so the draft continues
        // the film rather than restarting it.
        const prompt = model.mock.calls[0][0] as string;
        expect(prompt).toContain("scenes-already-written");
        expect(prompt).toContain("a courier who steals a file");
    });

    it("asks the model again when its first reply cannot be used", async () => {
        getProduction.mockResolvedValue(production([]));
        const model = vi.fn()
            .mockResolvedValueOnce("sorry, here is some prose")
            .mockResolvedValueOnce(JSON.stringify({ scenes: [{ title: "Arrival" }] }));

        const drafted = await draftMediaStory(ctx, 8, "a heist", { model });
        expect("refused" in drafted).toBe(false);
        expect(model).toHaveBeenCalledTimes(2);
        expect(model.mock.calls[1][0]).toContain("could not be used");
    });

    it("refuses rather than drafting into a production that is already full", async () => {
        const full = Array.from({ length: 12 }, (_, i) => scene(i + 1, `SCENE-${String(i + 1).padStart(2, "0")}`, `S${i}`));
        getProduction.mockResolvedValue(production(full));
        const model = vi.fn();

        const drafted = await draftMediaStory(ctx, 8, "more", { model });
        expect(drafted).toEqual({ refused: expect.stringContaining("already holds 12 scenes") });
        // Refused before the model is paid for, not after.
        expect(model).not.toHaveBeenCalled();
    });
});

describe("writing a drafted story in", () => {
    const proposal = {
        proposalId: "mediastory_12345678", productionId: 8, productionTitle: "Rooftop chase", premise: "a heist",
        baseSceneKeys: ["SCENE-01"], summary: [], skipped: [],
        scenes: [{
            title: "The rooftop", synopsis: "She reaches it.", location: "Archive rooftop", timeOfDay: "night", mood: "tense",
            plotPoints: [{ title: "She climbs" }, { title: "The drone finds her" }],
            shots: [{ action: "Wide on the parapet", durationSeconds: 6 }],
        }],
    };

    it("creates the scene, then its direction, then its beats and shots, in order", async () => {
        const before = production([scene(21, "SCENE-01", "Arrival")]);
        getProduction.mockResolvedValue(before);
        const after = production([scene(21, "SCENE-01", "Arrival"), scene(22, "SCENE-02", "The rooftop")]);
        addScene.mockResolvedValue(after);
        updateScene.mockResolvedValue(after);
        addPlotPoint.mockResolvedValue(after);
        addShot.mockResolvedValue(after);

        await applyMediaStory(ctx, proposal as any);

        expect(addScene).toHaveBeenCalledWith(ctx, 8, { title: "The rooftop", synopsis: "She reaches it." });
        // addScene takes only a title and a synopsis; the rest of a scene's
        // direction is a patch against the scene it just created.
        expect(updateScene).toHaveBeenCalledWith(ctx, 22, { location: "Archive rooftop", timeOfDay: "night", mood: "tense" });
        expect(addPlotPoint.mock.calls.map((c) => [c[1], c[2]])).toEqual([
            [22, { title: "She climbs", beat: "" }],
            [22, { title: "The drone finds her", beat: "" }],
        ]);
        expect(addShot).toHaveBeenCalledWith(ctx, 22, { action: "Wide on the parapet", durationSeconds: 6 });
    });

    it("refuses a card drafted against a production whose scenes have changed", async () => {
        getProduction.mockResolvedValue(production([scene(21, "SCENE-01", "Arrival"), scene(22, "SCENE-02", "Added since")]));

        await expect(applyMediaStory(ctx, proposal as any)).rejects.toThrow(/has changed since this was drafted/);
        expect(addScene).not.toHaveBeenCalled();
    });

    it("says how many scenes were written when one fails part-way", async () => {
        getProduction.mockResolvedValue(production([scene(21, "SCENE-01", "Arrival")]));
        addScene.mockRejectedValue(new Error("db is down"));

        await expect(applyMediaStory(ctx, { ...proposal, baseSceneKeys: ["SCENE-01"] } as any))
            .rejects.toThrow(/0 of 1 scenes were written, then one failed: db is down/);
    });
});
