/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * Phase 3 against a real database: takes asked for, simulated without a key, approved
 * or rejected in the Decision Inbox, sent to the video model with the compiled prompt
 * and keyframes, followed to the end, stored, re-shot, and counted against the budget.
 * fal.ai is replaced by a provider that answers at once.
 */

configureTestEnvironment();
const storageRoot = path.join(os.tmpdir(), `media-takes-test-${process.pid}-${Date.now()}`);
process.env.ODDJOB_STORAGE_ROOT = storageRoot;

const { db } = await import("@server/database_service.js");
const { orgs, users, userOrgs } = await import("@shared/schema/auth.js");
const { approvalRequests } = await import("@shared/schema/index.js");
const { mediaTakes } = await import("@shared/schema/media-studio.js");
const { mediaStudio } = await import("../../core/media-studio.service.js");
const { VideoProviderError } = await import("../../core/video-provider.js");

let reachable = false;
try {
    await db.execute("SELECT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(`[media-takes] SKIPPED — no test database reachable (${e?.message ?? e}).`);
}

const stamp = Date.now();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const I2V = "bytedance/seedance-2.0/image-to-video";
const T2V = "bytedance/seedance-2.0/text-to-video";

const images = { configured: true, model: "fake-image", estimatedCostCents: 4, async generate() { return { mimeType: "image/png", content: png, model: "fake-image" }; } } as any;

function fakeProvider(overrides: Record<string, unknown> = {}) {
    const calls = { upload: [] as Array<{ bytes: number; mimeType: string }>, submit: [] as any[], status: 0 };
    const state: { status: any; video: Buffer } = { status: { state: "queued" }, video: Buffer.from("mp4-bytes") };
    const provider = {
        name: "fal", configured: true, resolution: "720p", centsPerSecond: 30.34,
        estimateCents: (seconds: number) => Math.ceil(seconds * 30.34),
        endpointFor: ({ imageUrl }: { imageUrl: string | null }) => (imageUrl ? I2V : T2V),
        async uploadImage(content: Buffer, mimeType: string) {
            calls.upload.push({ bytes: content.length, mimeType });
            return `https://v3.fal.media/files/frame-${calls.upload.length}.png`;
        },
        async submit(input: any) {
            calls.submit.push(input);
            return { endpoint: input.imageUrl ? I2V : T2V, requestId: `req-${calls.submit.length}` };
        },
        async status() { calls.status += 1; return state.status; },
        async result() { return { videoUrl: "https://v3.fal.media/files/take.mp4", mimeType: "video/mp4" }; },
        async download() { return state.video; },
        ...overrides,
    } as any;
    return { provider, calls, state };
}

describe.skipIf(!reachable)("Media Studio takes", () => {
    let orgId: number, otherOrgId: number;
    let ownerId: string, strangerId: string;
    const ownerEmail = `takes_owner_${stamp}@example.test`;
    const ctx = (userId: string, organizationId = orgId) =>
        ({ organizationId, userId, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false }) as any;

    beforeAll(async () => {
        const [a, b] = await db.insert(orgs).values([
            { name: `Takes ${stamp}`, slug: `takes-${stamp}` },
            { name: `Takes other ${stamp}`, slug: `takes-other-${stamp}` },
        ] as any).returning();
        orgId = a.id;
        otherOrgId = b.id;
        const [owner, stranger] = await db.insert(users).values([
            { username: `takes_owner_${stamp}`, password: "not-a-real-password", email: ownerEmail },
            { username: `takes_stranger_${stamp}`, password: "not-a-real-password", email: `takes_stranger_${stamp}@example.test` },
        ] as any).returning();
        ownerId = owner.id;
        strangerId = stranger.id;
        await db.insert(userOrgs).values([{ userId: ownerId, orgId }, { userId: strangerId, orgId: otherOrgId }] as any);
    });

    afterAll(async () => {
        if (!orgId) return;
        await db.delete(approvalRequests).where(inArray(approvalRequests.organizationId, [orgId, otherOrgId])).catch(() => {});
        await db.execute(sql`delete from agent_long_term_memories where user_id in (${ownerId}, ${strangerId})`).catch(() => undefined);
        await db.execute(sql`delete from knowledge_topics where organization_id = ${orgId}`).catch(() => undefined);
        await db.delete(orgs).where(inArray(orgs.id, [orgId, otherOrgId])).catch(() => {});
        await db.delete(users).where(inArray(users.id, [ownerId, strangerId].filter(Boolean))).catch(() => {});
        fs.rmSync(storageRoot, { recursive: true, force: true });
    });

    /** A scene with two plot points, each with an approved keyframe, and a shot made from the first. */
    async function shootable(budgetLimitCents = 10000) {
        let p = await mediaStudio.createProduction(ctx(ownerId), { title: "Rooftop chase", aspectRatio: "2.39:1", budgetLimitCents });
        p = await mediaStudio.addScene(ctx(ownerId), p.id, { title: "Arrival" });
        const sceneId = p.scenes[0].id;
        p = await mediaStudio.updateScene(ctx(ownerId), sceneId, { location: "Archive rooftop", timeOfDay: "night" });
        p = await mediaStudio.addPlotPoint(ctx(ownerId), sceneId, { title: "She sees the drone", beat: "The drone crests the parapet." });
        p = await mediaStudio.addPlotPoint(ctx(ownerId), sceneId, { title: "She runs" });
        for (const plotPoint of p.scenes[0].plotPoints) {
            p = await mediaStudio.requestKeyframe(ctx(ownerId), plotPoint.id, {}, { generator: images, wait: true });
            const keyframe = p.scenes[0].plotPoints.find((pp) => pp.id === plotPoint.id)!.keyframes[0];
            p = await mediaStudio.approveKeyframe(ctx(ownerId), keyframe.id);
        }
        p = await mediaStudio.makeShotFromPlotPoint(ctx(ownerId), p.scenes[0].plotPoints[0].id);
        const shotId = p.scenes[0].shots[0].id;
        p = await mediaStudio.updateShot(ctx(ownerId), shotId, { dialogue: [{ speaker: "Elena", line: "Not tonight." }], durationSeconds: 5 });
        return { production: p, shotId };
    }
    const takesOf = (p: any, shotId: number) => p.scenes.flatMap((s: any) => s.shots).find((s: any) => s.id === shotId).takes;
    const approvalFor = async (takeId: number) =>
        (await db.select().from(approvalRequests).where(and(eq(approvalRequests.organizationId, orgId), sql`${approvalRequests.modifiedOutput}->>'takeId' = ${String(takeId)}`)))[0];

    it("records a take as a simulation without fal.ai: what would be sent, no video, no charge, no approval", async () => {
        const { shotId } = await shootable();
        const { provider } = fakeProvider({ configured: false });
        const p = await mediaStudio.requestTake(ctx(ownerId), shotId, { note: "Keep her coat dark" }, { provider });
        const [take] = takesOf(p, shotId);
        expect(take).toMatchObject({ takeNumber: 1, status: "simulated", mode: "simulation", costCents: 0, videoUrl: null, provider: "fal" });
        expect(take.request).toMatchObject({ endpoint: I2V, durationSeconds: 5, aspectRatio: "21:9", resolution: "720p", generateAudio: true, note: "Keep her coat dark" });
        expect(take.prompt).toContain("Setting: Archive rooftop, night.");
        expect(take.prompt).toContain('Elena: "Not tonight."');
        expect(take.prompt.endsWith("Director's note: Keep her coat dark")).toBe(true);
        expect(await approvalFor(take.id)).toBeUndefined();
        expect(p.spendCents).toBe(8); // the two keyframes only
    });

    it("asks for approval for a live take with its cost and the budget left, and refuses one past the budget", async () => {
        const { shotId } = await shootable(330);
        const { provider } = fakeProvider();
        const p = await mediaStudio.requestTake(ctx(ownerId), shotId, {}, { provider });
        const [take] = takesOf(p, shotId);
        expect(take).toMatchObject({ status: "pending_approval", mode: "live", costCents: 152 });

        const approval = await approvalFor(take.id);
        expect(approval).toMatchObject({ status: "pending", approverId: ownerId, approverEmail: ownerEmail, organizationId: orgId });
        expect(approval.executionId).toMatch(new RegExp(`^media_take_render:${take.id}:t\\d+$`));
        expect(approval.modifiedOutput).toMatchObject({
            kind: "media_take_render", takeId: take.id, estimatedCostCents: 152, budgetRemainingCents: 322, startsFromKeyframe: true, endsOnKeyframe: false,
            description: `Render take 1 of SCENE-01 shot 1 in "Rooftop chase" with Seedance: 5 seconds at 720p, about $1.52.`,
        });

        // $0.08 of keyframes spent plus $1.52 waiting leaves room for one more take, not two.
        await mediaStudio.requestTake(ctx(ownerId), shotId, {}, { provider });
        await expect(mediaStudio.requestTake(ctx(ownerId), shotId, {}, { provider }))
            .rejects.toThrow("This take would take Rooftop chase past its budget: $3.12 of $3.30 is spent or waiting for approval, and a 5-second take costs about $1.52 at 720p.");
        await expect(mediaStudio.requestTake(ctx(strangerId, otherOrgId), shotId, {}, { provider })).rejects.toThrow("Shot not found.");
    });

    it("refuses a take of the wrong length, with nothing described, or ending on a keyframe that is not there", async () => {
        const { production, shotId } = await shootable();
        const { provider } = fakeProvider();
        await mediaStudio.updateShot(ctx(ownerId), shotId, { durationSeconds: 20 });
        await expect(mediaStudio.requestTake(ctx(ownerId), shotId, {}, { provider })).rejects.toThrow("Seedance renders 4 to 15 seconds; this shot is 20. Change its length first.");
        await mediaStudio.updateShot(ctx(ownerId), shotId, { durationSeconds: 5 });

        // The second plot point's shot has nothing after it to end on.
        let p = await mediaStudio.makeShotFromPlotPoint(ctx(ownerId), production.scenes[0].plotPoints[1].id);
        const lastShotId = p.scenes[0].shots[1].id;
        await expect(mediaStudio.requestTake(ctx(ownerId), lastShotId, { endOnNextKeyframe: true }, { provider }))
            .rejects.toThrow("This shot's plot point is the last in its scene, so there is no next keyframe to end on.");

        p = await mediaStudio.addShot(ctx(ownerId), p.scenes[0].id, {});
        await expect(mediaStudio.requestTake(ctx(ownerId), p.scenes[0].shots[2].id, {}, { provider })).rejects.toThrow("Describe what the shot shows before asking for a take.");
    });

    it("on approval sends the stored prompt with uploaded keyframes, follows the render, and stores the finished video", async () => {
        const { shotId } = await shootable();
        const { provider, calls, state } = fakeProvider();
        let p = await mediaStudio.requestTake(ctx(ownerId), shotId, { endOnNextKeyframe: true }, { provider });
        const [take] = takesOf(p, shotId);
        const approval = await approvalFor(take.id);

        const outcome = await mediaStudio.onTakeDecision(approval, "approved", { userId: ownerId, email: ownerEmail }, { provider, follow: false });
        expect(outcome).toEqual({ handled: true, success: true, status: "queued" });
        expect(calls.upload).toEqual([{ bytes: png.length, mimeType: "image/png" }, { bytes: png.length, mimeType: "image/png" }]);
        // Exact, not toMatchObject: what is sent to a provider is what gets
        // charged for, so an extra field arriving unnoticed is the thing this
        // assertion exists to catch. The last three are ComfyUI's, and a fal
        // render must carry none of them — sending a workflow to fal.ai would be
        // a bug, not a harmless extra.
        expect(calls.submit).toEqual([{
            prompt: take.prompt, imageUrl: "https://v3.fal.media/files/frame-1.png", endImageUrl: "https://v3.fal.media/files/frame-2.png",
            durationSeconds: 5, aspectRatio: "21:9", generateAudio: true,
            workflow: null, seed: null, negativePrompt: null,
        }]);

        p = await mediaStudio.refreshTakeStatus(ctx(ownerId), take.id, { provider });
        expect(takesOf(p, shotId)[0]).toMatchObject({ status: "queued", decidedBy: ownerId });
        expect(p.spendCents).toBe(8 + 152);

        state.status = { state: "running" };
        p = await mediaStudio.refreshTakeStatus(ctx(ownerId), take.id, { provider });
        expect(takesOf(p, shotId)[0].status).toBe("rendering");

        state.status = { state: "completed" };
        p = await mediaStudio.refreshTakeStatus(ctx(ownerId), take.id, { provider });
        const finished = takesOf(p, shotId)[0];
        expect(finished).toMatchObject({ status: "ready_for_review", error: null });
        expect(finished.videoUrl).toMatch(/^\/api\/media-studio\/assets\/\d+$/);
        const stored = await mediaStudio.readAsset(ctx(ownerId), Number(finished.videoUrl.split("/").pop()));
        expect(stored.content.toString()).toBe("mp4-bytes");
        expect(stored.asset).toMatchObject({ kind: "video", mimeType: "video/mp4", source: `fal:${I2V}`, durationSeconds: 5 });

        p = await mediaStudio.approveTake(ctx(ownerId), take.id);
        expect(takesOf(p, shotId)[0].status).toBe("approved");

        // A second decision on the same request changes nothing.
        expect(await mediaStudio.onTakeDecision(approval, "rejected", { userId: ownerId, email: ownerEmail }, { provider, follow: false }))
            .toMatchObject({ handled: true, success: false, status: "approved" });
    });

    it("charges nothing for a render that was not approved, that fal.ai refused, or that failed", async () => {
        const { shotId } = await shootable();
        const { provider, calls, state } = fakeProvider();

        let p = await mediaStudio.requestTake(ctx(ownerId), shotId, {}, { provider });
        const rejected = takesOf(p, shotId)[0];
        expect(await mediaStudio.onTakeDecision(await approvalFor(rejected.id), "rejected", { userId: ownerId, email: ownerEmail }, { provider, follow: false }))
            .toEqual({ handled: true, success: true, status: "rejected" });

        const refusing = fakeProvider({ async submit() { throw new VideoProviderError("fal.ai did not accept the render: fal.ai returned 422: prompt too long", false); } });
        p = await mediaStudio.requestTake(ctx(ownerId), shotId, {}, { provider: refusing.provider });
        const refused = takesOf(p, shotId)[1];
        expect(await mediaStudio.onTakeDecision(await approvalFor(refused.id), "approved", { userId: ownerId, email: ownerEmail }, { provider: refusing.provider, follow: false }))
            .toMatchObject({ handled: true, success: false, status: "failed", error: "fal.ai did not accept the render: fal.ai returned 422: prompt too long" });

        p = await mediaStudio.requestTake(ctx(ownerId), shotId, {}, { provider });
        const failing = takesOf(p, shotId)[2];
        await mediaStudio.onTakeDecision(await approvalFor(failing.id), "approved", { userId: ownerId, email: ownerEmail }, { provider, follow: false });
        state.status = { state: "failed", error: "Content policy violation" };
        p = await mediaStudio.refreshTakeStatus(ctx(ownerId), failing.id, { provider });

        expect(takesOf(p, shotId).map((t: any) => [t.takeNumber, t.status, t.costCents])).toEqual([[1, "rejected", 0], [2, "failed", 0], [3, "failed", 0]]);
        expect(takesOf(p, shotId)[2].error).toBe("fal.ai could not render the take: Content policy violation");
        expect(p.spendCents).toBe(8);
        expect(calls.submit).toHaveLength(1);
    });

    it("re-shoots a take with what was wrong as a director's note", async () => {
        const { shotId } = await shootable();
        const { provider, state } = fakeProvider();
        let p = await mediaStudio.requestTake(ctx(ownerId), shotId, {}, { provider });
        const first = takesOf(p, shotId)[0];
        await mediaStudio.onTakeDecision(await approvalFor(first.id), "approved", { userId: ownerId, email: ownerEmail }, { provider, follow: false });
        state.status = { state: "completed" };
        await mediaStudio.refreshTakeStatus(ctx(ownerId), first.id, { provider });

        p = await mediaStudio.reshootTake(ctx(ownerId), first.id, { defectClass: "character_drift", notes: "Keep her coat dark" }, { provider });
        const [old, next] = takesOf(p, shotId);
        expect(old).toMatchObject({ status: "rejected", defectClass: "character_drift", notes: "Keep her coat dark" });
        expect(next).toMatchObject({ takeNumber: 2, status: "pending_approval" });
        expect(next.prompt.endsWith("Director's note: Take 1 had character drift; avoid it. Keep her coat dark")).toBe(true);
    });

    it("hands a Decision Inbox rejection to the take", async () => {
        const { shotId } = await shootable();
        const { provider } = fakeProvider();
        const p = await mediaStudio.requestTake(ctx(ownerId), shotId, {}, { provider });
        const take = takesOf(p, shotId)[0];
        const approval = await approvalFor(take.id);

        const { approvalService } = await import("@domain/integrations/core/approval.service.js");
        const decided: any = await approvalService.processDecision(approval.id, { decision: "rejected", comments: "Not this week" } as any, ownerId, ownerEmail, { isOrgAdmin: true, organizationId: orgId } as any);
        expect(decided.mediaTakeRender).toEqual({ handled: true, success: true, status: "rejected" });
        const [row] = await db.select().from(mediaTakes).where(eq(mediaTakes.id, take.id));
        expect(row).toMatchObject({ status: "rejected", costCents: 0, decidedBy: ownerId });
    });
});
