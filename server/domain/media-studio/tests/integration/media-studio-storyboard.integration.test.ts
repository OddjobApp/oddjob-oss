/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { inArray } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * Phase 2 against a real database: keyframes for plot points (rendered, failed,
 * budgeted, reviewed), a shot made from a plot point, and the storyboard deck.
 * Gemini is replaced by a generator that answers at once.
 */

configureTestEnvironment();
const storageRoot = path.join(os.tmpdir(), `media-storyboard-test-${process.pid}-${Date.now()}`);
process.env.ODDJOB_STORAGE_ROOT = storageRoot;

const { db } = await import("@server/database_service.js");
const { orgs, users, userOrgs } = await import("@shared/schema/auth.js");
const { mediaKeyframes } = await import("@shared/schema/media-studio.js");
const { mediaStudio } = await import("../../core/media-studio.service.js");
const { ImageGenerationError } = await import("../../core/gemini-image.js");

let reachable = false;
try {
    await db.execute("SELECT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(`[media-storyboard] SKIPPED — no test database reachable (${e?.message ?? e}).`);
}

const stamp = Date.now();
// A 1×1 PNG.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

function fakeGenerator(overrides: Partial<{ configured: boolean; estimatedCostCents: number; generate: (prompt: string, aspect: string) => Promise<any> }> = {}) {
    const calls: Array<{ prompt: string; aspectRatio: string; references: Array<{ mimeType: string; content: Buffer }> }> = [];
    return {
        calls,
        configured: true,
        model: "fake-image",
        estimatedCostCents: 4,
        async generate(prompt: string, aspectRatio: string, references: Array<{ mimeType: string; content: Buffer }> = []) {
            calls.push({ prompt, aspectRatio, references });
            return { mimeType: "image/png", content: png, model: "fake-image" };
        },
        ...overrides,
    } as any;
}

describe.skipIf(!reachable)("Media Studio storyboard", () => {
    let orgId: number, otherOrgId: number;
    let ownerId: string, strangerId: string;
    const ctx = (userId: string, organizationId = orgId) =>
        ({ organizationId, userId, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false }) as any;

    beforeAll(async () => {
        const [a, b] = await db.insert(orgs).values([
            { name: `Storyboard ${stamp}`, slug: `storyboard-${stamp}` },
            { name: `Storyboard other ${stamp}`, slug: `storyboard-other-${stamp}` },
        ] as any).returning();
        orgId = a.id;
        otherOrgId = b.id;
        const [owner, stranger] = await db.insert(users).values(["owner", "stranger"].map((role) => ({
            username: `storyboard_${role}_${stamp}`, password: "not-a-real-password", email: `storyboard_${role}_${stamp}@example.test`,
        })) as any).returning();
        ownerId = owner.id;
        strangerId = stranger.id;
        await db.insert(userOrgs).values([{ userId: ownerId, orgId }, { userId: strangerId, orgId: otherOrgId }] as any);
    });

    afterAll(async () => {
        if (!orgId) return;
        await db.delete(orgs).where(inArray(orgs.id, [orgId, otherOrgId])).catch(() => {});
        await db.delete(users).where(inArray(users.id, [ownerId, strangerId].filter(Boolean))).catch(() => {});
        fs.rmSync(storageRoot, { recursive: true, force: true });
    });

    /** A production with one scene and one plot point. */
    async function storyboard(options: { budgetLimitCents?: number; title?: string } = {}) {
        let p = await mediaStudio.createProduction(ctx(ownerId), { title: options.title ?? "Rooftop chase", aspectRatio: "2.39:1", budgetLimitCents: options.budgetLimitCents ?? 2500 });
        p = await mediaStudio.addScene(ctx(ownerId), p.id, { title: "Arrival", synopsis: "Elena reaches the roof." });
        p = await mediaStudio.addPlotPoint(ctx(ownerId), p.scenes[0].id, { title: "She sees the drone", beat: "The drone crests the parapet behind her." });
        return { production: p, plotPointId: p.scenes[0].plotPoints[0].id };
    }
    const keyframesOf = (p: any) => p.scenes[0].plotPoints[0].keyframes;

    it("renders a keyframe for a plot point, stores the image, counts its cost, and shows the first one", async () => {
        const { production, plotPointId } = await storyboard();
        const generator = fakeGenerator();

        let p = await mediaStudio.requestKeyframe(ctx(ownerId), plotPointId, {}, { generator, wait: true });
        const [first] = keyframesOf(p);
        expect(first).toMatchObject({ status: "ready", mode: "live", costCents: 4, isSelected: true, error: null });
        expect(first.imageUrl).toMatch(/^\/api\/media-studio\/assets\/\d+$/);
        expect(first.prompt).toContain("She sees the drone");
        expect(first.prompt).toContain("The drone crests the parapet behind her.");
        expect(generator.calls[0].aspectRatio).toBe("2.39:1");
        expect(p.spendCents).toBe(4);

        const assetId = Number(first.imageUrl.split("/").pop());
        expect((await mediaStudio.readAsset(ctx(ownerId), assetId)).content.equals(png)).toBe(true);

        p = await mediaStudio.requestKeyframe(ctx(ownerId), plotPointId, { prompt: "Wide on the parapet, drone backlit" }, { generator, wait: true });
        expect(keyframesOf(p).map((k: any) => [k.prompt, k.isSelected])).toEqual([[first.prompt, true], ["Wide on the parapet, drone backlit", false]]);
        expect(p.spendCents).toBe(8);
        await expect(mediaStudio.getProduction(ctx(strangerId, otherOrgId), production.id)).rejects.toThrow("Production not found.");
    });

    it("answers while the image renders, and records why a render failed", async () => {
        const { plotPointId } = await storyboard();
        let release!: () => void;
        const slow = fakeGenerator({ generate: () => new Promise((resolve) => { release = () => resolve({ mimeType: "image/png", content: png, model: "fake-image" }); }) });
        const answered = await mediaStudio.requestKeyframe(ctx(ownerId), plotPointId, {}, { generator: slow });
        expect(keyframesOf(answered)[0]).toMatchObject({ status: "rendering", imageUrl: null });
        release();

        const refused = fakeGenerator({ generate: async () => { throw new ImageGenerationError("Gemini returned 429: quota exhausted", false); } });
        let p = await mediaStudio.requestKeyframe(ctx(ownerId), plotPointId, {}, { generator: refused, wait: true });
        const failed = keyframesOf(p).at(-1);
        expect(failed).toMatchObject({ status: "failed", error: "Gemini returned 429: quota exhausted", costCents: 0, isSelected: false });

        const blocked = fakeGenerator({ generate: async () => { throw new ImageGenerationError("Gemini returned no image (IMAGE_SAFETY).", true); } });
        p = await mediaStudio.requestKeyframe(ctx(ownerId), plotPointId, {}, { generator: blocked, wait: true });
        expect(keyframesOf(p).at(-1)).toMatchObject({ status: "failed", costCents: 4 });
    });

    it("refuses a render past the budget, or when Gemini is not configured, before anything is sent", async () => {
        const { plotPointId } = await storyboard({ budgetLimitCents: 5, title: "Tight budget" });
        const generator = fakeGenerator();
        await mediaStudio.requestKeyframe(ctx(ownerId), plotPointId, {}, { generator, wait: true });

        await expect(mediaStudio.requestKeyframe(ctx(ownerId), plotPointId, {}, { generator, wait: true }))
            .rejects.toThrow("This keyframe would take Tight budget past its budget: $0.04 of $0.05 is spent, and a keyframe costs about $0.04.");
        await expect(mediaStudio.requestKeyframe(ctx(ownerId), plotPointId, {}, { generator: fakeGenerator({ configured: false }), wait: true }))
            .rejects.toThrow("Keyframes cannot be rendered: Gemini is not configured for this organization. Connect your organization's Gemini API key in Organization Settings.");
        expect(generator.calls).toHaveLength(1);
    });

    it("shows, approves and rejects only rendered keyframes, one approved per plot point", async () => {
        const { plotPointId } = await storyboard();
        const generator = fakeGenerator();
        await mediaStudio.requestKeyframe(ctx(ownerId), plotPointId, {}, { generator, wait: true });
        await mediaStudio.requestKeyframe(ctx(ownerId), plotPointId, { prompt: "Second" }, { generator, wait: true });
        let p = await mediaStudio.requestKeyframe(ctx(ownerId), plotPointId, {}, {
            generator: fakeGenerator({ generate: async () => { throw new ImageGenerationError("Gemini returned 500", false); } }), wait: true,
        });
        const [first, second, failed] = keyframesOf(p);

        await expect(mediaStudio.selectKeyframe(ctx(ownerId), failed.id)).rejects.toThrow("Only a rendered keyframe can be shown; this one is failed.");
        await expect(mediaStudio.approveKeyframe(ctx(ownerId), failed.id)).rejects.toThrow("Only a rendered keyframe can be approved; this one is failed.");

        p = await mediaStudio.selectKeyframe(ctx(ownerId), second.id);
        expect(keyframesOf(p).map((k: any) => k.isSelected)).toEqual([false, true, false]);

        p = await mediaStudio.approveKeyframe(ctx(ownerId), first.id);
        expect(keyframesOf(p).map((k: any) => [k.status, k.isSelected])).toEqual([["approved", true], ["ready", false], ["failed", false]]);
        p = await mediaStudio.approveKeyframe(ctx(ownerId), second.id);
        expect(keyframesOf(p).map((k: any) => [k.status, k.isSelected])).toEqual([["ready", false], ["approved", true], ["failed", false]]);

        p = await mediaStudio.rejectKeyframe(ctx(ownerId), second.id);
        expect(keyframesOf(p)[1]).toMatchObject({ status: "rejected", isSelected: false });
        await expect(mediaStudio.approveKeyframe(ctx(strangerId, otherOrgId), first.id)).rejects.toThrow("Keyframe not found.");
    });

    it("makes one shot from a plot point, framed by its approved keyframe", async () => {
        const { production, plotPointId } = await storyboard();
        const generator = fakeGenerator();
        let p = await mediaStudio.requestKeyframe(ctx(ownerId), plotPointId, { prompt: "Drone over the parapet, low angle" }, { generator, wait: true });
        p = await mediaStudio.approveKeyframe(ctx(ownerId), keyframesOf(p)[0].id);
        const approvedId = keyframesOf(p)[0].id;

        p = await mediaStudio.makeShotFromPlotPoint(ctx(ownerId), plotPointId);
        expect(p.scenes[0].shots).toEqual([expect.objectContaining({ plotPointId, prompt: "Drone over the parapet, low angle", referenceKeyframeId: approvedId, durationSeconds: 5, takes: [] })]);
        await expect(mediaStudio.makeShotFromPlotPoint(ctx(ownerId), plotPointId)).rejects.toThrow('A shot in SCENE-01 already comes from "She sees the drone".');

        p = await mediaStudio.addPlotPoint(ctx(ownerId), p.scenes[0].id, { title: "She runs", beat: "Elena sprints for the stairwell." });
        p = await mediaStudio.makeShotFromPlotPoint(ctx(ownerId), p.scenes[0].plotPoints[1].id);
        expect(p.scenes[0].shots[1]).toMatchObject({ prompt: "Elena sprints for the stairwell.", referenceKeyframeId: null });
        expect(p.id).toBe(production.id);
    });

    it("gives up on a render that never reported back", async () => {
        const { plotPointId } = await storyboard();
        const longAgo = new Date(Date.now() - 10 * 60 * 1000);
        await db.insert(mediaKeyframes).values({
            plotPointId, organizationId: orgId, prompt: "Lost", status: "rendering", provider: "gemini", mode: "live", costCents: 4, submittedAt: longAgo, createdAt: longAgo, updatedAt: longAgo,
        } as any);
        const { production } = { production: await mediaStudio.createProduction(ctx(ownerId), { title: "Unrelated" }) };
        expect(production.scenes).toEqual([]);

        const [row] = await db.select().from(mediaKeyframes).where(inArray(mediaKeyframes.plotPointId, [plotPointId]));
        const owning = await mediaStudio.updatePlotPoint(ctx(ownerId), plotPointId, {});
        const lost = owning.scenes[0].plotPoints[0].keyframes.find((k) => k.id === row.id)!;
        expect(lost).toMatchObject({ status: "failed", error: "The render did not finish; the server may have restarted. Render it again.", costCents: 4 });
    });

    it("exports the storyboard as a deck: a cover, a slide per scene, and a slide per plot point with its keyframe", async () => {
        const { production, plotPointId } = await storyboard({ title: "Rooftop Chase: Final!" });
        let p = await mediaStudio.requestKeyframe(ctx(ownerId), plotPointId, {}, { generator: fakeGenerator(), wait: true });
        p = await mediaStudio.approveKeyframe(ctx(ownerId), keyframesOf(p)[0].id);
        p = await mediaStudio.addPlotPoint(ctx(ownerId), p.scenes[0].id, { title: "She runs" });

        const deck = await mediaStudio.exportStoryboard(ctx(ownerId), production.id);
        expect(deck.filename).toBe("rooftop-chase-final-storyboard.pptx");
        expect(deck.content.subarray(0, 2).toString()).toBe("PK");

        const entries = new AdmZip(deck.content).getEntries().map((entry) => entry.entryName);
        expect(entries.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))).toHaveLength(4);
        expect(entries.some((name) => name.startsWith("ppt/media/"))).toBe(true);
        const slide4 = new AdmZip(deck.content).readAsText("ppt/slides/slide4.xml");
        expect(slide4).toContain("She runs");
        expect(slide4).toContain("No keyframe yet");

        await expect(mediaStudio.exportStoryboard(ctx(strangerId, otherOrgId), production.id)).rejects.toThrow("Production not found.");
    });

    it("renders references of characters and places, and sends the approved ones with the keyframes that show them", async () => {
        const { production, plotPointId } = await storyboard({ title: "Consistent chase" });
        const generator = fakeGenerator();
        let p = await mediaStudio.updateProduction(ctx(ownerId), production.id, { style: "35mm film grain, teal and amber" });
        p = await mediaStudio.updateScene(ctx(ownerId), p.scenes[0].id, { location: "Archive rooftop", timeOfDay: "night" });
        expect(p.style).toBe("35mm film grain, teal and amber");

        p = await mediaStudio.requestReference(ctx(ownerId), p.id, { kind: "character", name: "Elena", description: "a courier in a rain-soaked trench coat" }, { generator, wait: true });
        p = await mediaStudio.requestReference(ctx(ownerId), p.id, { kind: "location", name: "archive rooftop" }, { generator, wait: true });
        expect(p.references.map((r) => [r.kind, r.name, r.status])).toEqual([["character", "Elena", "ready"], ["location", "archive rooftop", "ready"]]);
        expect(generator.calls[0].prompt).toContain("A character reference sheet for Elena, a courier in a rain-soaked trench coat.");
        expect(generator.calls[0].prompt).toContain("Look: 35mm film grain, teal and amber.");
        expect(generator.calls[0].aspectRatio).toBe("16:9");
        expect(p.spendCents).toBe(8);

        // A reference is not sent until it is approved.
        p = await mediaStudio.requestKeyframe(ctx(ownerId), plotPointId, {}, { generator, wait: true });
        expect(generator.calls.at(-1)!.references).toHaveLength(0);
        expect(keyframesOf(p)[0].references).toEqual([]);
        expect(keyframesOf(p)[0].prompt).toContain("Setting: Archive rooftop, night.");

        const [elena, roof] = p.references;
        p = await mediaStudio.approveReference(ctx(ownerId), elena.id);
        p = await mediaStudio.approveReference(ctx(ownerId), roof.id);
        p = await mediaStudio.approveKeyframe(ctx(ownerId), keyframesOf(p)[0].id);
        const firstFrameAsset = Number(keyframesOf(p)[0].imageUrl.split("/").pop());

        p = await mediaStudio.addPlotPoint(ctx(ownerId), p.scenes[0].id, { title: "Elena runs", beat: "She sprints for the stairwell." });
        p = await mediaStudio.requestKeyframe(ctx(ownerId), p.scenes[0].plotPoints[1].id, {}, { generator, wait: true });
        const second = p.scenes[0].plotPoints[1].keyframes[0];
        expect(second.status).toBe("ready");
        expect(second.references.map((r) => [r.kind, r.label])).toEqual([
            ["character", "Elena"], ["previous_keyframe", "SCENE-01 plot point 1: She sees the drone"], ["location", "archive rooftop"],
        ]);
        expect(second.references[1].assetId).toBe(firstFrameAsset);
        const sent = generator.calls.at(-1)!;
        expect(sent.references.map((image: { mimeType: string }) => image.mimeType)).toEqual(["image/png", "image/png", "image/png"]);
        expect(sent.prompt).toContain("Look: 35mm film grain, teal and amber.");
        expect(sent.prompt).toContain("Reference images, in order: image 1 is Elena's appearance; image 2 is the previous frame; image 3 is the setting, archive rooftop.");

        // One approved reference per character: approving another of the same name replaces it.
        p = await mediaStudio.requestReference(ctx(ownerId), p.id, { kind: "character", name: "ELENA" }, { generator, wait: true });
        const again = p.references.at(-1)!;
        p = await mediaStudio.approveReference(ctx(ownerId), again.id);
        expect(p.references.filter((r) => r.kind === "character").map((r) => r.status)).toEqual(["ready", "approved"]);
        p = await mediaStudio.rejectReference(ctx(ownerId), again.id);
        expect(p.references.at(-1)!.status).toBe("rejected");
        await expect(mediaStudio.approveReference(ctx(ownerId), again.id)).rejects.toThrow("Only a rendered reference can be approved; this one is rejected.");
        await expect(mediaStudio.approveReference(ctx(strangerId, otherOrgId), elena.id)).rejects.toThrow("Reference not found.");
        expect(p.spendCents).toBe(20);
    });
});
