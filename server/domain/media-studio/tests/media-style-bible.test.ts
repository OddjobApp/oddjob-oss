import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Drafting and saving a production's Style Bible.
 *
 * The bible is compiled into every keyframe and video prompt after it is saved,
 * so the two things worth pinning are that a draft can never hold a shape the
 * Project Space would later refuse — it is parsed with the same schema on the
 * way in — and that saving writes to BOTH places: the Project Space, so every
 * production in it is shot the same way, and the production's own `style`, which
 * is what the render path reads.
 */

const getProduction = vi.fn();
const updateProduction = vi.fn();
const updateProjectStyleBible = vi.fn();

// recordMediaDecision is exported from the same module, so the mock has to
// carry it or applying throws "not a function" — the factory must stay in
// step with what the module exports.
const recordMediaDecision = vi.fn();

vi.mock("@domain/media-studio/core/media-studio.service.js", () => ({
    get recordMediaDecision() { return recordMediaDecision; },
    mediaStudio: {
        get getProduction() { return getProduction; },
        get updateProduction() { return updateProduction; },
        get updateProjectStyleBible() { return updateProjectStyleBible; },
    },
}));

const { applyStyleBible, draftStyleBible, readStyleBible } = await import("@domain/media-studio/core/media-style-bible.js");

const ctx = { userId: "u1", organizationId: 1, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false } as any;

const production = (over: Record<string, unknown> = {}) => ({
    id: 8, title: "Rooftop chase", aspectRatio: "2.39:1" as const, projectId: 2, crewSessionId: 410, updatedAt: "",
    scribeDocumentId: null, scribeDocumentTitle: null, characters: [], style: "", references: [],
    video: {} as any, budgetLimitCents: 10000, spendCents: 0, createdAt: "", scenes: [], projectStyleBible: null,
    ...over,
});

const LOOK = "Anamorphic 2.39:1, sodium streetlight, heavy grain";

beforeEach(() => {
    vi.clearAllMocks();
});

describe("reading a model's reply as a Style Bible", () => {
    it("parses it with the schema the Project Space stores, so a draft can never be unsaveable", () => {
        const { bible, problems } = readStyleBible(JSON.stringify({
            look: LOOK,
            period: "1978",
            canonicalCharacters: [{ name: "Elena", kind: "character", description: "Cropped dark hair" }],
        }));
        expect(problems).toBeNull();
        expect(bible).toMatchObject({ look: LOOK, period: "1978", defaultAspectRatio: "16:9" });
        expect(bible?.canonicalCharacters?.[0]).toMatchObject({ name: "Elena", kind: "character", aliases: [] });
    });

    it("reports a reply it cannot use rather than saving half of one", () => {
        expect(readStyleBible("not json").problems).toContain("not JSON");
        expect(readStyleBible(JSON.stringify({ look: LOOK, defaultAspectRatio: "70mm" })).problems).toContain("defaultAspectRatio");
        expect(readStyleBible("").problems).toBe("The reply was empty.");
    });
});

describe("drafting a Style Bible", () => {
    it("drafts against the bible in force and says what changes", async () => {
        getProduction.mockResolvedValue(production({ projectStyleBible: { look: "handheld 16mm", period: "1978" } }));
        const model = vi.fn().mockResolvedValue(JSON.stringify({ look: LOOK, period: "1978" }));

        const drafted = await draftStyleBible(ctx, 8, "make it feel like a 70s thriller", { model });
        if ("refused" in drafted) throw new Error(`refused: ${drafted.refused}`);

        expect(drafted).toMatchObject({ productionId: 8, productionTitle: "Rooftop chase", projectId: 2 });
        expect(drafted.proposalId).toMatch(/^mediabible_[0-9a-f]{32}$/);
        // Only what actually changes: the period was already 1978.
        expect(drafted.changes).toEqual([`Look: "handheld 16mm" → "${LOOK}"`]);
        expect(model.mock.calls[0][0]).toContain("current-bible");
    });

    it("refuses a draft that would change nothing, rather than posting an empty card", async () => {
        getProduction.mockResolvedValue(production({ projectStyleBible: { look: LOOK } }));
        const model = vi.fn().mockResolvedValue(JSON.stringify({ look: LOOK }));

        expect(await draftStyleBible(ctx, 8, "keep it as it is", { model }))
            .toEqual({ refused: expect.stringContaining("would not change the Style Bible") });
    });
});

describe("saving a drafted Style Bible", () => {
    const proposal = {
        proposalId: "mediabible_12345678", productionId: 8, productionTitle: "Rooftop chase", projectId: 2,
        instruction: "70s thriller", bible: { look: LOOK, period: "1978" }, changes: [],
    };

    it("saves it to the Project Space and to the production's own look", async () => {
        // Two reads, in order: the production as it stands, then the re-read that
        // carries the decision just recorded. The returned view is the SECOND one —
        // mocking only updateProduction's result would assert a value applying no
        // longer returns.
        getProduction
            .mockResolvedValueOnce(production())
            .mockResolvedValueOnce(production({ style: LOOK }));
        updateProduction.mockResolvedValue(production({ style: LOOK }));

        const { production: saved, savedToProject } = await applyStyleBible(ctx, proposal as any);

        expect(updateProjectStyleBible).toHaveBeenCalledWith(ctx, 2, expect.objectContaining({ look: LOOK, period: "1978" }));
        expect(updateProduction).toHaveBeenCalledWith(ctx, 8, { style: LOOK });
        expect(savedToProject).toBe(true);
        expect(saved.style).toBe(LOOK);
    });

    it("saves only the production's look when it belongs to no Project Space", async () => {
        getProduction.mockResolvedValue(production({ projectId: null }));
        updateProduction.mockResolvedValue(production({ projectId: null, style: LOOK }));

        const { savedToProject } = await applyStyleBible(ctx, { ...proposal, projectId: null } as any);

        expect(updateProjectStyleBible).not.toHaveBeenCalled();
        expect(updateProduction).toHaveBeenCalledWith(ctx, 8, { style: LOOK });
        expect(savedToProject).toBe(false);
    });

    it("refuses a card drafted for a different Project Space", async () => {
        getProduction.mockResolvedValue(production({ projectId: 3 }));

        await expect(applyStyleBible(ctx, proposal as any)).rejects.toThrow(/moved to a different Project Space/);
        expect(updateProjectStyleBible).not.toHaveBeenCalled();
        expect(updateProduction).not.toHaveBeenCalled();
    });
});
