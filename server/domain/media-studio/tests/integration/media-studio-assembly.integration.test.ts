/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { eq, inArray, sql } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * Phase 4 against a real database and the real ffmpeg binary: a scene's approved
 * takes cut into a reel with its transitions, refused while a shot has no approved
 * take with video, one at a time per organization, and failures recorded.
 */

configureTestEnvironment();
const storageRoot = path.join(os.tmpdir(), `media-assembly-test-${process.pid}-${Date.now()}`);
process.env.ODDJOB_STORAGE_ROOT = storageRoot;

const { db } = await import("@server/database_service.js");
const { orgs, users, userOrgs } = await import("@shared/schema/auth.js");
const { mediaAssemblies, mediaTakes } = await import("@shared/schema/media-studio.js");
const { mediaStudio } = await import("../../core/media-studio.service.js");
const { createFfmpegRunner, ffmpegBinary } = await import("../../core/ffmpeg.js");

let reachable = false;
try {
    await db.execute("SELECT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(`[media-assembly] SKIPPED — no test database reachable (${e?.message ?? e}).`);
}
const binary = ffmpegBinary();
if (!binary) console.warn("[media-assembly] SKIPPED — no ffmpeg binary (ffmpeg-static not installed with its install script).");

const stamp = Date.now();
const work = path.join(os.tmpdir(), `media-assembly-clips-${process.pid}-${stamp}`);

/** A test-pattern clip, with a tone when it has sound. */
function makeClip(name: string, size: string, seconds: number, withAudio: boolean): Buffer {
    const file = path.join(work, name);
    const args = ["-hide_banner", "-nostdin", "-y", "-f", "lavfi", "-i", `testsrc=size=${size}:rate=30:duration=${seconds}`];
    if (withAudio) args.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`);
    args.push("-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p");
    if (withAudio) args.push("-c:a", "aac", "-shortest");
    args.push(file);
    const result = spawnSync(binary!, args, { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`Could not make ${name}: ${String(result.stderr).slice(-500)}`);
    return fs.readFileSync(file);
}

describe.skipIf(!reachable || !binary)("Media Studio scene assembly", () => {
    let orgId: number, otherOrgId: number;
    let ownerId: string, strangerId: string;
    const ctx = (userId: string, organizationId = orgId) =>
        ({ organizationId, userId, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false }) as any;

    beforeAll(async () => {
        fs.mkdirSync(work, { recursive: true });
        const [a, b] = await db.insert(orgs).values([
            { name: `Assembly ${stamp}`, slug: `assembly-${stamp}` },
            { name: `Assembly other ${stamp}`, slug: `assembly-other-${stamp}` },
        ] as any).returning();
        orgId = a.id;
        otherOrgId = b.id;
        const [owner, stranger] = await db.insert(users).values([
            { username: `assembly_owner_${stamp}`, password: "not-a-real-password", email: `assembly_owner_${stamp}@example.test` },
            { username: `assembly_stranger_${stamp}`, password: "not-a-real-password", email: `assembly_stranger_${stamp}@example.test` },
        ] as any).returning();
        ownerId = owner.id;
        strangerId = stranger.id;
        await db.insert(userOrgs).values([{ userId: ownerId, orgId }, { userId: strangerId, orgId: otherOrgId }] as any);
    });

    afterAll(async () => {
        if (orgId) {
            await db.execute(sql`delete from agent_long_term_memories where user_id in (${ownerId}, ${strangerId})`).catch(() => undefined);
            await db.execute(sql`delete from knowledge_topics where organization_id = ${orgId}`).catch(() => undefined);
            await db.delete(orgs).where(inArray(orgs.id, [orgId, otherOrgId])).catch(() => {});
            await db.delete(users).where(inArray(users.id, [ownerId, strangerId].filter(Boolean))).catch(() => {});
        }
        fs.rmSync(storageRoot, { recursive: true, force: true });
        fs.rmSync(work, { recursive: true, force: true });
    });

    async function sceneWithShots(count: number) {
        let p = await mediaStudio.createProduction(ctx(ownerId), { title: "Rooftop chase", aspectRatio: "16:9" });
        p = await mediaStudio.addScene(ctx(ownerId), p.id, { title: "Arrival" });
        for (let i = 0; i < count; i++) p = await mediaStudio.addShot(ctx(ownerId), p.scenes[0].id, {});
        return p;
    }

    /** An approved take of a shot, with the clip as its video, or none. */
    async function approve(productionId: number, shotId: number, clip: Buffer | null) {
        const asset = clip ? await mediaStudio.saveAsset(ctx(ownerId), productionId, { kind: "video", mimeType: "video/mp4", content: clip, source: "test" }) : null;
        const [take] = await db.insert(mediaTakes).values({
            shotId, organizationId: orgId, takeNumber: 1, prompt: "test pattern", durationSeconds: 4,
            status: "approved", mode: "live", videoAssetId: asset?.id ?? null, costCents: 0,
        } as any).returning();
        return take;
    }

    it("cuts the approved takes into one reel in the production's frame, with each shot's transition", async () => {
        let p = await sceneWithShots(3);
        const sceneId = p.scenes[0].id;
        const [s1, s2, s3] = p.scenes[0].shots;

        await expect(mediaStudio.assembleScene(ctx(ownerId), sceneId, { wait: true }))
            .rejects.toThrow("Shots 1, 2 and 3 have no approved take. Approve a take of every shot before assembling SCENE-01.");
        await approve(p.id, s1.id, makeClip("wide.mp4", "640x360", 4, true));
        await approve(p.id, s2.id, makeClip("square.mp4", "480x480", 5, false));
        const third = await approve(p.id, s3.id, null);
        await expect(mediaStudio.assembleScene(ctx(ownerId), sceneId, { wait: true }))
            .rejects.toThrow("Shot 3 has an approved take with no video. Approve a rendered take instead.");

        const hd = await mediaStudio.saveAsset(ctx(ownerId), p.id, { kind: "video", mimeType: "video/mp4", content: makeClip("hd.mp4", "1280x720", 4, true), source: "test" });
        await db.update(mediaTakes).set({ videoAssetId: hd.id }).where(eq(mediaTakes.id, third.id));
        await mediaStudio.updateShot(ctx(ownerId), s1.id, { transition: "crossfade" });
        await mediaStudio.updateShot(ctx(ownerId), s2.id, { transition: "dip_to_black" });

        p = await mediaStudio.assembleScene(ctx(ownerId), sceneId, { wait: true });
        const reel = p.scenes[0].assembly!;
        expect(reel).toMatchObject({ status: "ready", error: null, current: true });
        // 4 + 5 + 4 seconds, less a 0.75-second crossfade and a 1-second dip to black.
        expect(reel.durationSeconds).toBeGreaterThan(11.1);
        expect(reel.durationSeconds).toBeLessThan(11.4);

        const { asset, content } = await mediaStudio.readAsset(ctx(ownerId), Number(reel.reelUrl!.split("/").pop()));
        expect(asset).toMatchObject({ kind: "reel", mimeType: "video/mp4", width: 1280, height: 720, source: "ffmpeg" });
        const out = path.join(work, "reel-out.mp4");
        fs.writeFileSync(out, content);
        const probe = await createFfmpegRunner(binary!).probe(out);
        expect(probe).toMatchObject({ hasVideo: true, hasAudio: true, width: 1280, height: 720 });
        expect(Math.abs(probe.durationSeconds! - 11.25)).toBeLessThan(0.15);

        const [row] = await db.select().from(mediaAssemblies).where(eq(mediaAssemblies.id, reel.id));
        expect(row.manifest).toMatchObject({
            width: 1280, height: 720, resolution: "720p",
            clips: [{ shotNumber: 1, transition: "crossfade" }, { shotNumber: 2, transition: "dip_to_black" }, { shotNumber: 3, takeId: third.id, assetId: hd.id }],
        });

        // A changed transition leaves the reel out of date, not wrong.
        p = await mediaStudio.updateShot(ctx(ownerId), s2.id, { transition: "cut" });
        expect(p.scenes[0].assembly).toMatchObject({ status: "ready", current: false });
    }, 120_000);

    it("assembles one scene at a time per organization, and frees the slot a restart left behind", async () => {
        const p = await sceneWithShots(1);
        const sceneId = p.scenes[0].id;
        await approve(p.id, p.scenes[0].shots[0].id, makeClip("wide-2.mp4", "640x360", 4, true));

        const [running] = await db.insert(mediaAssemblies).values({ sceneId, organizationId: orgId, status: "assembling" } as any).returning();
        await expect(mediaStudio.assembleScene(ctx(ownerId), sceneId, { wait: true }))
            .rejects.toThrow("Another scene in this organization is being assembled. One scene assembles at a time; try again when it finishes.");

        await db.update(mediaAssemblies).set({ updatedAt: new Date(Date.now() - 20 * 60 * 1000) }).where(eq(mediaAssemblies.id, running.id));
        const after = await mediaStudio.assembleScene(ctx(ownerId), sceneId, { wait: true });
        expect(after.scenes[0].assembly).toMatchObject({ status: "ready", current: true });
        const [lost] = await db.select().from(mediaAssemblies).where(eq(mediaAssemblies.id, running.id));
        expect(lost).toMatchObject({ status: "failed", error: "The assembly did not finish; the server may have restarted. Assemble the scene again." });
    }, 120_000);

    it("records ffmpeg's reason when a reel cannot be cut, and says when there is no ffmpeg or no such scene", async () => {
        const p = await sceneWithShots(1);
        const sceneId = p.scenes[0].id;
        await approve(p.id, p.scenes[0].shots[0].id, makeClip("wide-3.mp4", "640x360", 4, true));

        const real = createFfmpegRunner(binary!);
        const broken = { probe: real.probe, run: async () => { throw new Error("ffmpeg failed (exit 1): Invalid argument"); } };
        const failed = await mediaStudio.assembleScene(ctx(ownerId), sceneId, { wait: true, ffmpeg: broken });
        expect(failed.scenes[0].assembly).toMatchObject({ status: "failed", reelUrl: null, error: "ffmpeg failed (exit 1): Invalid argument" });

        await expect(mediaStudio.assembleScene(ctx(ownerId), sceneId, { ffmpeg: null }))
            .rejects.toThrow("Scene assembly is not available on this server: no ffmpeg binary was found.");
        await expect(mediaStudio.assembleScene(ctx(strangerId, otherOrgId), sceneId, { wait: true })).rejects.toThrow("Scene not found.");
    }, 120_000);
});
