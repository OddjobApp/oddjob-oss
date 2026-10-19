/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * Undoing review decisions and reviewing several takes at once, against a real
 * database: taking back an approval, reopening a take a re-shoot rejected, withdrawing
 * the take it asked for (closing its approval), and approving or re-shooting a scene's
 * takes in one request with a result for each.
 */

configureTestEnvironment();
const storageRoot = path.join(os.tmpdir(), `media-review-test-${process.pid}-${Date.now()}`);
process.env.ODDJOB_STORAGE_ROOT = storageRoot;

const { db } = await import("@server/database_service.js");
const { orgs, users, userOrgs } = await import("@shared/schema/auth.js");
const { approvalRequests } = await import("@shared/schema/hil.js");
const { mediaTakes } = await import("@shared/schema/media-studio.js");
const { mediaStudio } = await import("../../core/media-studio.service.js");

let reachable = false;
try {
    await db.execute("SELECT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(`[media-review] SKIPPED — no test database reachable (${e?.message ?? e}).`);
}

const stamp = Date.now();
const simulation = { name: "fal", configured: false, resolution: "720p", centsPerSecond: 30.34, estimateCents: (s: number) => Math.ceil(s * 30.34), endpointFor: () => "t2v" } as any;
const live = { ...simulation, configured: true } as any;

describe.skipIf(!reachable)("Media Studio review decisions", () => {
    let orgId: number, otherOrgId: number;
    let ownerId: string, strangerId: string;
    const ctx = (userId: string, organizationId = orgId) =>
        ({ organizationId, userId, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false }) as any;

    beforeAll(async () => {
        const [a, b] = await db.insert(orgs).values([
            { name: `Review ${stamp}`, slug: `review-${stamp}` },
            { name: `Review other ${stamp}`, slug: `review-other-${stamp}` },
        ] as any).returning();
        orgId = a.id;
        otherOrgId = b.id;
        const [owner, stranger] = await db.insert(users).values([
            { username: `review_owner_${stamp}`, password: "not-a-real-password", email: `review_owner_${stamp}@example.test` },
            { username: `review_stranger_${stamp}`, password: "not-a-real-password", email: `review_stranger_${stamp}@example.test` },
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

    /** A scene with two shots, and a second scene for a take that is somewhere else. */
    async function scenes() {
        let p = await mediaStudio.createProduction(ctx(ownerId), { title: "Rooftop chase", aspectRatio: "16:9" });
        p = await mediaStudio.addScene(ctx(ownerId), p.id, { title: "Arrival" });
        p = await mediaStudio.addScene(ctx(ownerId), p.id, { title: "The chase" });
        const [first, second] = p.scenes;
        p = await mediaStudio.addShot(ctx(ownerId), first.id, { action: "Elena crouches behind the parapet", durationSeconds: 5 });
        p = await mediaStudio.addShot(ctx(ownerId), first.id, { action: "Wide on the stairwell", durationSeconds: 5 });
        p = await mediaStudio.addShot(ctx(ownerId), second.id, { action: "She runs", durationSeconds: 5 });
        const video = await mediaStudio.saveAsset(ctx(ownerId), p.id, { kind: "video", mimeType: "video/mp4", content: Buffer.from("mp4"), source: "test" });
        return { production: p, sceneId: first.id, shots: p.scenes[0].shots.map((s) => s.id), elsewhere: p.scenes[1].shots[0].id, videoAssetId: video.id };
    }

    async function takeOf(shotId: number, takeNumber: number, fields: Record<string, unknown>) {
        const [row] = await db.insert(mediaTakes).values({
            shotId, organizationId: orgId, takeNumber, prompt: "test", durationSeconds: 5, mode: "live", costCents: 0, ...fields,
        } as any).returning();
        return row;
    }
    const status = async (takeId: number) => (await db.select().from(mediaTakes).where(eq(mediaTakes.id, takeId)))[0];

    it("takes back an approval, and brings back the take approved before it", async () => {
        const { shots, videoAssetId } = await scenes();
        const a = await takeOf(shots[0], 1, { status: "ready_for_review", videoAssetId });
        const b = await takeOf(shots[0], 2, { status: "ready_for_review", videoAssetId });

        await mediaStudio.approveTake(ctx(ownerId), a.id);
        await mediaStudio.approveTake(ctx(ownerId), b.id);
        expect([(await status(a.id)).status, (await status(b.id)).status]).toEqual(["ready_for_review", "approved"]);

        // Undoing B's approval, which replaced A's, approves A again.
        await mediaStudio.approveTake(ctx(ownerId), a.id);
        expect([(await status(a.id)).status, (await status(b.id)).status]).toEqual(["approved", "ready_for_review"]);

        await mediaStudio.unapproveTake(ctx(ownerId), a.id);
        expect((await status(a.id)).status).toBe("ready_for_review");
        await expect(mediaStudio.unapproveTake(ctx(ownerId), a.id))
            .rejects.toThrow("Take 1 is not approved, so there is no approval to take back; it is ready for review.");
        await expect(mediaStudio.unapproveTake(ctx(strangerId, otherOrgId), a.id)).rejects.toThrow("Take not found.");
    });

    it("undoes a re-shoot: withdraws the take it asked for, closing its approval, and reopens the take it rejected", async () => {
        const { shots, videoAssetId } = await scenes();
        const reviewed = await takeOf(shots[0], 1, { status: "ready_for_review", videoAssetId });

        let p = await mediaStudio.reshootTake(ctx(ownerId), reviewed.id, { defectClass: "wrong_framing", notes: "tighter" }, { provider: live });
        const asked = p.scenes[0].shots[0].takes.find((t) => t.takeNumber === 2)!;
        expect(asked.status).toBe("pending_approval");
        const [approval] = await db.select().from(approvalRequests)
            .where(and(eq(approvalRequests.organizationId, orgId), sql`${approvalRequests.modifiedOutput}->>'takeId' = ${String(asked.id)}`));
        expect(approval.status).toBe("pending");

        p = await mediaStudio.withdrawTake(ctx(ownerId), asked.id);
        expect(await status(asked.id)).toMatchObject({ status: "rejected", costCents: 0, notes: "Withdrawn before it rendered." });
        expect((await db.select().from(approvalRequests).where(eq(approvalRequests.id, approval.id)))[0])
            .toMatchObject({ status: "rejected", comments: "Withdrawn in Media Studio before it was decided." });
        await expect(mediaStudio.withdrawTake(ctx(ownerId), asked.id))
            .rejects.toThrow("Only a take waiting for approval, or a simulation, can be withdrawn. Take 2 is rejected.");

        await mediaStudio.reopenTake(ctx(ownerId), reviewed.id);
        expect(await status(reviewed.id)).toMatchObject({ status: "ready_for_review", defectClass: null, notes: null });

        const sent = await takeOf(shots[1], 1, { status: "queued", submittedAt: new Date(), costCents: 152 });
        await expect(mediaStudio.withdrawTake(ctx(ownerId), sent.id))
            .rejects.toThrow("Take 1 was already approved and sent to fal.ai, so it can't be withdrawn and its cost stands. Reject it once it is ready for review.");
        const neverRendered = await takeOf(shots[1], 2, { status: "rejected" });
        await expect(mediaStudio.reopenTake(ctx(ownerId), neverRendered.id))
            .rejects.toThrow("Take 2 was turned down before it rendered, so it has no video to review. Ask for a new take instead.");
    });

    it("approves and re-shoots several takes of a scene at once, with a result for each", async () => {
        const { sceneId, shots, elsewhere, videoAssetId } = await scenes();
        const c = await takeOf(shots[0], 1, { status: "ready_for_review", videoAssetId });
        const d = await takeOf(shots[0], 2, { status: "ready_for_review", videoAssetId });
        const e = await takeOf(shots[1], 1, { status: "ready_for_review", videoAssetId });
        const f = await takeOf(elsewhere, 1, { status: "ready_for_review", videoAssetId });

        const approved = await mediaStudio.approveTakes(ctx(ownerId), sceneId, { takeIds: [c.id, d.id, e.id, f.id, 999999999] });
        expect(approved.results).toEqual([
            { takeId: c.id, ok: true },
            { takeId: d.id, ok: false, error: "Take 2 is a second take of the same shot. A shot keeps one approved take, so only the first was approved." },
            { takeId: e.id, ok: true },
            { takeId: f.id, ok: false, error: "That take is in another scene, not SCENE-01." },
            { takeId: 999999999, ok: false, error: "Take not found." },
        ]);
        expect(approved.production.scenes[0].shots.map((s) => s.takes.filter((t) => t.status === "approved").map((t) => t.id))).toEqual([[c.id], [e.id]]);

        const reshot = await mediaStudio.reshootTakes(ctx(ownerId), sceneId, {
            items: [{ takeId: c.id, defectClass: "character_drift" }, { takeId: d.id }, { takeId: e.id, notes: "slower" }],
        }, { provider: simulation });
        expect(reshot.results.map((r) => [r.takeId, r.ok, r.error ?? null])).toEqual([
            [c.id, true, null],
            [d.id, false, "Take 2's shot is already being re-shot in this batch, so it was left out."],
            [e.id, true, null],
        ]);
        const shotTakes = reshot.production.scenes[0].shots.map((s) => s.takes.map((t) => [t.id, t.status]));
        expect(shotTakes[0]).toContainEqual([reshot.results[0].newTakeId, "simulated"]);
        expect(shotTakes[1]).toContainEqual([reshot.results[2].newTakeId, "simulated"]);
        expect((await status(c.id)).status).toBe("rejected");

        await expect(mediaStudio.approveTakes(ctx(strangerId, otherOrgId), sceneId, { takeIds: [c.id] })).rejects.toThrow("Scene not found.");
    });

    it("duplicates a shot right after it, with its direction and dialogue but none of its takes", async () => {
        const { sceneId, shots, videoAssetId } = await scenes();
        await mediaStudio.updateShot(ctx(ownerId), shots[0], { framing: "close-up", lens: "35mm", dialogue: [{ speaker: "Elena", line: "Not yet." }] });
        await takeOf(shots[0], 1, { status: "ready_for_review", videoAssetId });

        const p = await mediaStudio.duplicateShot(ctx(ownerId), shots[0]);
        const scene = p.scenes.find((s) => s.id === sceneId)!;
        expect(scene.shots.map((s) => s.action)).toEqual(["Elena crouches behind the parapet", "Elena crouches behind the parapet", "Wide on the stairwell"]);
        const [original, copy, after] = scene.shots;
        expect(copy.id).not.toBe(original.id);
        expect(after.id).toBe(shots[1]);
        expect(copy).toMatchObject({ framing: "close-up", lens: "35mm", durationSeconds: 5, dialogue: [{ speaker: "Elena", line: "Not yet." }], takes: [] });
        expect(original.takes).toHaveLength(1);

        await expect(mediaStudio.duplicateShot(ctx(strangerId, otherOrgId), shots[0])).rejects.toThrow("not found");
    });
});
