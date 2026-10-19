/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * Media Studio's productions against a real database: organization and Project
 * Space scoping, ordering, one approved take per shot, spend, and stored files.
 */

configureTestEnvironment();
// Local storage reads its root when first imported; keep test files out of the repo.
const storageRoot = path.join(os.tmpdir(), `media-studio-test-${process.pid}-${Date.now()}`);
process.env.ODDJOB_STORAGE_ROOT = storageRoot;

const { db } = await import("@server/database_service.js");
const { orgs, users, userOrgs } = await import("@shared/schema/auth.js");
const { projects } = await import("@shared/schema/projects.js");
const { crewSessions } = await import("@shared/schema/crew.js");
const { mediaKeyframes, mediaTakes } = await import("@shared/schema/media-studio.js");
const { projectService } = await import("@domain/projects/core/project.service.js");
const { mediaStudio } = await import("../../core/media-studio.service.js");

let reachable = false;
try {
    await db.execute("SELECT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(`[media-studio] SKIPPED — no test database reachable (${e?.message ?? e}). Set TEST_DATABASE_URL and run npm run test:db:setup.`);
}

const stamp = Date.now();

describe.skipIf(!reachable)("Media Studio productions", () => {
    let orgA: number, orgB: number;
    let ownerId: string, memberId: string, outsiderId: string, strangerId: string;
    let privateProject: any;
    let roomKey: string;
    let roomId: number;

    const ctx = (userId: string, organizationId = orgA) =>
        ({ organizationId, userId, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false }) as any;

    beforeAll(async () => {
        const [a, b] = await db.insert(orgs).values([
            { name: `Media A ${stamp}`, slug: `media-a-${stamp}` },
            { name: `Media B ${stamp}`, slug: `media-b-${stamp}` },
        ] as any).returning();
        orgA = a.id;
        orgB = b.id;
        const people = await db.insert(users).values(["owner", "member", "outsider", "stranger"].map((role) => ({
            username: `media_${role}_${stamp}`, password: "not-a-real-password", email: `media_${role}_${stamp}@example.test`,
        })) as any).returning();
        [ownerId, memberId, outsiderId, strangerId] = people.map((person: any) => person.id);
        await db.insert(userOrgs).values([
            ...people.slice(0, 3).map((person: any) => ({ userId: person.id, orgId: orgA })),
            { userId: strangerId, orgId: orgB },
        ] as any);

        const projectCtx = { organizationId: orgA, userId: ownerId };
        privateProject = await projectService.createProject(projectCtx, { name: `Film ${stamp}`, visibility: "private" } as any);
        await projectService.addMember(projectCtx, privateProject.key, { principalType: "user", principalId: memberId, role: "viewer" });

        roomKey = `media-room-${stamp}`;
        const [room] = await db.insert(crewSessions).values({ organizationId: orgA, sessionKey: roomKey, projectId: privateProject.id, createdBy: ownerId } as any).returning();
        roomId = room.id;
    });

    afterAll(async () => {
        if (!orgA) return;
        await db.delete(crewSessions).where(inArray(crewSessions.organizationId, [orgA, orgB]));
        await db.delete(projects).where(inArray(projects.organizationId, [orgA, orgB])).catch(() => {});
        await db.delete(orgs).where(inArray(orgs.id, [orgA, orgB])).catch(() => {});
        await db.delete(users).where(inArray(users.id, [ownerId, memberId, outsiderId, strangerId].filter(Boolean))).catch(() => {});
        fs.rmSync(storageRoot, { recursive: true, force: true });
    });

    async function production(title = "Rooftop chase") {
        return mediaStudio.createProduction(ctx(ownerId), { title, crewSessionKey: roomKey, aspectRatio: "2.39:1" });
    }

    it("makes a room's production in the room's Project Space, and lists it for the room", async () => {
        const made = await production();
        expect(made).toMatchObject({
            title: "Rooftop chase", aspectRatio: "2.39:1", budgetLimitCents: 10000, spendCents: 0,
            projectId: privateProject.id, crewSessionId: roomId, scenes: [],
        });

        expect((await mediaStudio.listProductions(ctx(memberId), { crewSessionKey: roomKey })).map((p) => p.id)).toContain(made.id);
        expect((await mediaStudio.listProductions(ctx(outsiderId))).map((p) => p.id)).not.toContain(made.id);
        expect(await mediaStudio.listProductions(ctx(ownerId), { crewSessionKey: "no-such-room" })).toEqual([]);

        await expect(mediaStudio.createProduction(ctx(ownerId), { title: "Lost", crewSessionKey: "no-such-room" })).rejects.toThrow("Room not found.");
        await expect(mediaStudio.createProduction(ctx(outsiderId), { title: "Sneaky", crewSessionKey: roomKey })).rejects.toThrow("Room not found.");
        await expect(mediaStudio.createProduction(ctx(ownerId), { title: " ", aspectRatio: "21:9" })).rejects.toThrow(/Invalid production/);
    });

    it("keeps a private project's production from people outside it and from other organizations", async () => {
        const made = await production("Private cut");
        await expect(mediaStudio.getProduction(ctx(outsiderId), made.id)).rejects.toThrow("Production not found.");
        await expect(mediaStudio.addScene(ctx(outsiderId), made.id, { title: "Nope" })).rejects.toThrow("Production not found.");
        await expect(mediaStudio.getProduction(ctx(strangerId, orgB), made.id)).rejects.toThrow("Production not found.");
        expect((await mediaStudio.getProduction(ctx(memberId), made.id)).title).toBe("Private cut");

        const withScene = await mediaStudio.addScene(ctx(ownerId), made.id, { title: "Arrival" });
        const sceneId = withScene.scenes[0].id;
        await expect(mediaStudio.addShot(ctx(outsiderId), sceneId, {})).rejects.toThrow("Scene not found.");
        await expect(mediaStudio.addShot(ctx(strangerId, orgB), sceneId, {})).rejects.toThrow("Scene not found.");
    });

    it("numbers scenes, keeps their order, and never reuses a scene's key", async () => {
        const made = await production("Ordering");
        let p = await mediaStudio.addScene(ctx(ownerId), made.id, { title: "Arrival", synopsis: "Elena reaches the roof." });
        p = await mediaStudio.addScene(ctx(ownerId), made.id, { title: "Chase" });
        expect(p.scenes.map((s) => [s.sceneKey, s.title, s.position])).toEqual([["SCENE-01", "Arrival", 0], ["SCENE-02", "Chase", 1]]);

        const [first, second] = p.scenes;
        p = await mediaStudio.reorderScenes(ctx(ownerId), made.id, [second.id, first.id]);
        expect(p.scenes.map((s) => s.title)).toEqual(["Chase", "Arrival"]);
        await expect(mediaStudio.reorderScenes(ctx(ownerId), made.id, [first.id])).rejects.toThrow("The order must list each item exactly once.");
        await expect(mediaStudio.reorderScenes(ctx(ownerId), made.id, [first.id, first.id])).rejects.toThrow("The order must list each item exactly once.");

        p = await mediaStudio.deleteScene(ctx(ownerId), second.id);
        p = await mediaStudio.addScene(ctx(ownerId), made.id, { title: "Escape" });
        expect(p.scenes.map((s) => s.sceneKey)).toEqual(["SCENE-01", "SCENE-03"]);
    });

    it("links a shot only to a plot point in its own scene", async () => {
        const made = await production("Linking");
        let p = await mediaStudio.addScene(ctx(ownerId), made.id, { title: "Arrival" });
        p = await mediaStudio.addScene(ctx(ownerId), made.id, { title: "Chase" });
        const [arrival, chase] = p.scenes;
        p = await mediaStudio.addPlotPoint(ctx(ownerId), arrival.id, { title: "She sees the drone", beat: "The drone crests the parapet." });
        const beat = p.scenes[0].plotPoints[0];

        await expect(mediaStudio.addShot(ctx(ownerId), chase.id, { plotPointId: beat.id })).rejects.toThrow("That plot point is not in this scene.");
        await expect(mediaStudio.addShot(ctx(ownerId), arrival.id, { durationSeconds: 0 })).rejects.toThrow(/Invalid shot/);

        p = await mediaStudio.addShot(ctx(ownerId), arrival.id, { plotPointId: beat.id, prompt: "Low angle on the parapet", durationSeconds: 4, transition: "crossfade" });
        expect(p.scenes[0].shots[0]).toMatchObject({ plotPointId: beat.id, prompt: "Low angle on the parapet", durationSeconds: 4, transition: "crossfade", takes: [] });

        const shotId = p.scenes[0].shots[0].id;
        p = await mediaStudio.addShot(ctx(ownerId), arrival.id, { prompt: "Close on Elena" });
        p = await mediaStudio.reorderShots(ctx(ownerId), arrival.id, [p.scenes[0].shots[1].id, shotId]);
        expect(p.scenes[0].shots.map((s) => s.prompt)).toEqual(["Close on Elena", "Low angle on the parapet"]);
        await expect(mediaStudio.updateShot(ctx(ownerId), shotId, { plotPointId: 999999999 })).rejects.toThrow("That plot point is not in this scene.");
    });

    it("approves one take per shot, reviews only takes that can be reviewed, and counts only live renders that were sent", async () => {
        const made = await production("Dailies");
        let p = await mediaStudio.addScene(ctx(ownerId), made.id, { title: "Arrival" });
        p = await mediaStudio.addPlotPoint(ctx(ownerId), p.scenes[0].id, { title: "Beat" });
        p = await mediaStudio.addShot(ctx(ownerId), p.scenes[0].id, { prompt: "Close on the cylinder" });
        const shotId = p.scenes[0].shots[0].id;
        const plotPointId = p.scenes[0].plotPoints[0].id;

        const insertTake = async (takeNumber: number, fields: Record<string, unknown>) =>
            (await db.insert(mediaTakes).values({ shotId, organizationId: orgA, takeNumber, prompt: "Close on the cylinder", durationSeconds: 5, ...fields } as any).returning())[0];
        const first = await insertTake(1, { status: "ready_for_review", mode: "live", costCents: 20, submittedAt: new Date() });
        const second = await insertTake(2, { status: "ready_for_review", mode: "live", costCents: 20, submittedAt: new Date() });
        const simulated = await insertTake(3, { status: "simulated", mode: "simulation", costCents: 0 });
        await insertTake(4, { status: "rejected", mode: "live", costCents: 20 }); // refused before it was sent
        await db.insert(mediaKeyframes).values([
            { plotPointId, organizationId: orgA, prompt: "Parapet at dusk", status: "ready", mode: "live", costCents: 5, submittedAt: new Date() },
            { plotPointId, organizationId: orgA, prompt: "Parapet at dawn", status: "pending_approval", mode: "live", costCents: 7 },
        ] as any);

        const statuses = (view: Awaited<ReturnType<typeof mediaStudio.getProduction>>) =>
            view.scenes[0].shots[0].takes.map((t) => [t.takeNumber, t.status]);

        p = await mediaStudio.approveTake(ctx(ownerId), first.id);
        expect(statuses(p)).toEqual([[1, "approved"], [2, "ready_for_review"], [3, "simulated"], [4, "rejected"]]);
        expect(p.spendCents).toBe(45);

        p = await mediaStudio.approveTake(ctx(ownerId), second.id);
        expect(statuses(p).slice(0, 2)).toEqual([[1, "ready_for_review"], [2, "approved"]]);
        expect(p.scenes[0].shots[0].takes[1].decidedBy).toBe(ownerId);

        await expect(mediaStudio.approveTake(ctx(ownerId), simulated.id)).rejects.toThrow("Only a take ready for review can be approved. Take 3 is simulated.");
        await expect(mediaStudio.approveTake(ctx(outsiderId), first.id)).rejects.toThrow("Take not found.");

        p = await mediaStudio.rejectTake(ctx(ownerId), second.id, { defectClass: "wrong_framing", notes: "Too loose" });
        expect(p.scenes[0].shots[0].takes[1]).toMatchObject({ status: "rejected", defectClass: "wrong_framing", notes: "Too loose" });
        await expect(mediaStudio.rejectTake(ctx(ownerId), simulated.id, {})).rejects.toThrow(/Only a take under review or approved can be rejected/);

        // The database holds the rule too.
        await mediaStudio.approveTake(ctx(ownerId), first.id);
        await expect(db.update(mediaTakes).set({ status: "approved" }).where(eq(mediaTakes.id, second.id))).rejects.toThrow();
    });

    it("stores a render's file, serves it only inside the production's reach, and refuses types it would not serve", async () => {
        const made = await production("Files");
        const bytes = Buffer.from("not really an mp4, but bytes all the same");
        const asset = await mediaStudio.saveAsset(ctx(ownerId), made.id, { kind: "video", mimeType: "video/mp4", content: bytes, source: "seedance", durationSeconds: 5 });
        expect(asset).toMatchObject({ kind: "video", mimeType: "video/mp4", byteSize: bytes.length, url: `/api/media-studio/assets/${asset.id}` });

        const read = await mediaStudio.readAsset(ctx(memberId), asset.id);
        expect(read.content.equals(bytes)).toBe(true);
        expect(read.asset.storagePath).toMatch(new RegExp(`^media-studio/${made.id}/videos/[0-9a-f-]+\\.mp4$`));
        expect(fs.existsSync(path.join(storageRoot, String(orgA), read.asset.storagePath))).toBe(true);

        await expect(mediaStudio.readAsset(ctx(outsiderId), asset.id)).rejects.toThrow("Asset not found.");
        await expect(mediaStudio.readAsset(ctx(strangerId, orgB), asset.id)).rejects.toThrow("Asset not found.");
        await expect(mediaStudio.saveAsset(ctx(ownerId), made.id, { kind: "video", mimeType: "text/html", content: Buffer.from("<script>"), source: "x" })).rejects.toThrow("A video cannot be stored as text/html.");
        await expect(mediaStudio.saveAsset(ctx(ownerId), made.id, { kind: "image", mimeType: "image/png", content: Buffer.alloc(0), source: "x" })).rejects.toThrow("The file is empty.");
    });

    /**
     * The case above passes through a PRIVATE project, which is the one shape the
     * asset fallback actually guards. A production with no project, or one in a
     * project the whole org can read, took a different route: the fallback re-reads
     * the asset with no organization filter and then carries out every later check as
     * the asset's own organization, so both agree with whoever asked. Asset ids are
     * sequential, so the id was the only thing needed. Neither shape was covered.
     */
    it("refuses an outside organization an asset whose production is not in a private project", async () => {
        const openProject = await projectService.createProject({ organizationId: orgA, userId: ownerId } as any,
            { name: `Open ${stamp}`, visibility: "org" } as any);
        const [openRoom] = await db.insert(crewSessions).values({
            organizationId: orgA, sessionKey: `media-open-${stamp}`, projectId: openProject.id, createdBy: ownerId,
        } as any).returning();

        for (const [what, made] of [
            ["an org-visible project", await mediaStudio.createProduction(ctx(ownerId), { title: "Open", crewSessionKey: `media-open-${stamp}` })],
            ["no project at all", await mediaStudio.createProduction(ctx(ownerId), { title: "Loose" })],
        ] as const) {
            const bytes = Buffer.from(`bytes for ${what}`);
            const asset = await mediaStudio.saveAsset(ctx(ownerId), made.id, { kind: "video", mimeType: "video/mp4", content: bytes, source: "seedance", durationSeconds: 5 });

            // The owner's own organization still reads it.
            expect((await mediaStudio.readAsset(ctx(ownerId), asset.id)).content.equals(bytes)).toBe(true);
            // Someone in another organization does not, whatever the id.
            await expect(mediaStudio.readAsset(ctx(strangerId, orgB), asset.id)).rejects.toThrow("Asset not found.");
        }

        expect(openRoom.id).toBeGreaterThan(0);
    });
});
