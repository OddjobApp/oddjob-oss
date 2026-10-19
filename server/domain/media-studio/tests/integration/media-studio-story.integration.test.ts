/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * Story, direction and dialogue against a real database: a production linked to a
 * Scribe manuscript, scenes made from its stations, its characters, scene direction,
 * and shot dialogue.
 */

configureTestEnvironment();

const { db } = await import("@server/database_service.js");
const { orgs, users, userOrgs } = await import("@shared/schema/auth.js");
const { crewSessions } = await import("@shared/schema/crew.js");
const { scribeAnnotations, scribeBranches, scribeDocuments, scribeEntityLedger, scribeNodes } = await import("@shared/schema/scribe.js");
const { mediaStudio } = await import("../../core/media-studio.service.js");
const { compileShot } = await import("@shared/media-prompt.js");

let reachable = false;
try {
    await db.execute("SELECT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(`[media-story] SKIPPED — no test database reachable (${e?.message ?? e}).`);
}

const stamp = Date.now();

describe.skipIf(!reachable)("Media Studio story, direction and dialogue", () => {
    let orgId: number, otherOrgId: number;
    let ownerId: string, strangerId: string;
    let roomId: number, otherRoomId: number;
    let documentId: number, otherDocumentId: number;
    let stationIds: number[] = [];
    const ctx = (userId: string, organizationId = orgId) =>
        ({ organizationId, userId, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false }) as any;

    async function manuscript(organizationId: number, sessionId: number, title: string, stations: Array<[string, string]>) {
        const [document] = await db.insert(scribeDocuments).values({ organizationId, sessionId, title } as any).returning();
        const [branch] = await db.insert(scribeBranches).values({ documentId: document.id, branchKey: "main", name: "Main" } as any).returning();
        await db.update(scribeDocuments).set({ activeBranchId: branch.id }).where(eq(scribeDocuments.id, document.id));
        const nodes = await db.insert(scribeNodes).values(stations.map(([stationTitle, content], index) => ({
            documentId: document.id, branchId: branch.id, stationKey: `station_${index + 1}`, title: stationTitle, sortOrder: index, content,
        })) as any).returning();
        return { document, nodes };
    }

    beforeAll(async () => {
        const [a, b] = await db.insert(orgs).values([
            { name: `Story ${stamp}`, slug: `story-${stamp}` },
            { name: `Story other ${stamp}`, slug: `story-other-${stamp}` },
        ] as any).returning();
        orgId = a.id;
        otherOrgId = b.id;
        const [owner, stranger] = await db.insert(users).values(["owner", "stranger"].map((role) => ({
            username: `story_${role}_${stamp}`, password: "not-a-real-password", email: `story_${role}_${stamp}@example.test`,
        })) as any).returning();
        ownerId = owner.id;
        strangerId = stranger.id;
        await db.insert(userOrgs).values([{ userId: ownerId, orgId }, { userId: strangerId, orgId: otherOrgId }] as any);

        const [room, otherRoom] = await db.insert(crewSessions).values([
            { organizationId: orgId, sessionKey: `story-room-${stamp}`, createdBy: ownerId },
            { organizationId: otherOrgId, sessionKey: `story-other-room-${stamp}`, createdBy: strangerId },
        ] as any).returning();
        roomId = room.id;
        otherRoomId = otherRoom.id;

        const story = await manuscript(orgId, roomId, "The Archive", [
            ["Ordinary World", "Elena couriers sealed cylinders across a drowned city.   She never opens them."],
            ["The Call", "A cylinder hums in her hands. Someone wants it badly."],
        ]);
        documentId = story.document.id;
        stationIds = story.nodes.map((node: any) => node.id);
        await db.insert(scribeEntityLedger).values([
            { documentId, entityType: "character", termName: "Elena", definitionText: "a courier in a rain-soaked trench coat", aliases: ["El"] },
            { documentId, entityType: "location", termName: "The Archive Roof", definitionText: "a flat concrete roof with a parapet" },
            { documentId, entityType: "defined_term", termName: "Cylinder", definitionText: "sealed cargo" },
        ] as any);
        otherDocumentId = (await manuscript(otherOrgId, otherRoomId, "Elsewhere", [["Only", "Not yours."]])).document.id;
    });

    afterAll(async () => {
        if (!orgId) return;
        await db.delete(crewSessions).where(inArray(crewSessions.id, [roomId, otherRoomId].filter(Boolean)));
        await db.delete(orgs).where(inArray(orgs.id, [orgId, otherOrgId])).catch(() => {});
        await db.delete(users).where(inArray(users.id, [ownerId, strangerId].filter(Boolean))).catch(() => {});
    });

    const roomProduction = (title: string) => mediaStudio.createProduction(ctx(ownerId), { title, crewSessionId: roomId });

    it("lists the room's manuscripts, links one, and brings in its characters and locations", async () => {
        const production = await roomProduction("Archive film");
        expect(production.crewSessionId).toBe(roomId);
        expect((await mediaStudio.scribeDocumentsFor(ctx(ownerId), production.id)).map((d) => d.title)).toEqual(["The Archive"]);
        expect(await mediaStudio.scribeStationsFor(ctx(ownerId), production.id)).toEqual([]);

        const linked = await mediaStudio.linkScribeDocument(ctx(ownerId), production.id, { documentId });
        expect(linked).toMatchObject({ scribeDocumentId: documentId, scribeDocumentTitle: "The Archive" });
        expect(linked.characters.map((c) => [c.kind, c.name, c.aliases])).toEqual([["character", "Elena", ["El"]], ["location", "The Archive Roof", []]]);
        expect((await mediaStudio.scribeStationsFor(ctx(ownerId), production.id)).map((s) => s.title)).toEqual(["Ordinary World", "The Call"]);

        await expect(mediaStudio.linkScribeDocument(ctx(ownerId), production.id, { documentId: otherDocumentId })).rejects.toThrow("Manuscript not found.");
        await expect(mediaStudio.linkScribeDocument(ctx(ownerId), production.id, { documentId: "7" })).rejects.toThrow(/Invalid manuscript link/);
    });

    it("makes a scene for each station once, in manuscript order, and shows each station's text", async () => {
        let p = await roomProduction("From the manuscript");
        await expect(mediaStudio.importScenesFromScribe(ctx(ownerId), p.id)).rejects.toThrow("Link the production to a Scribe manuscript first.");
        p = await mediaStudio.linkScribeDocument(ctx(ownerId), p.id, { documentId });
        p = await mediaStudio.addScene(ctx(ownerId), p.id, { title: "Cold open" });

        p = await mediaStudio.importScenesFromScribe(ctx(ownerId), p.id);
        expect(p.scenes.map((s) => [s.sceneKey, s.title, s.scribeNodeId])).toEqual([
            ["SCENE-01", "Cold open", null], ["SCENE-02", "Ordinary World", stationIds[0]], ["SCENE-03", "The Call", stationIds[1]],
        ]);
        expect(p.scenes[1].station).toEqual({ title: "Ordinary World", excerpt: "Elena couriers sealed cylinders across a drowned city. She never opens them.", changed: false });
        expect(p.scenes[1].synopsis).toBe("Elena couriers sealed cylinders across a drowned city. She never opens them.");

        p = await mediaStudio.importScenesFromScribe(ctx(ownerId), p.id);
        expect(p.scenes).toHaveLength(3);

        p = await mediaStudio.linkSceneToStation(ctx(ownerId), p.scenes[0].id, { scribeNodeId: stationIds[1] });
        expect(p.scenes[0]).toMatchObject({ scribeNodeId: stationIds[1], station: { title: "The Call" } });
        const [foreignNode] = await db.select({ id: scribeNodes.id }).from(scribeNodes).where(eq(scribeNodes.documentId, otherDocumentId));
        await expect(mediaStudio.linkSceneToStation(ctx(ownerId), p.scenes[0].id, { scribeNodeId: foreignNode.id })).rejects.toThrow("That station is not in the production's manuscript.");

        // Unlinking the manuscript leaves the scenes but not their station links.
        p = await mediaStudio.linkScribeDocument(ctx(ownerId), p.id, { documentId: null });
        expect(p).toMatchObject({ scribeDocumentId: null, scribeDocumentTitle: null, characters: [] });
        expect(p.scenes.map((s) => [s.scribeNodeId, s.station])).toEqual([[null, null], [null, null], [null, null]]);
    });

    it("keeps scene direction and shot dialogue, and compiles them into what the video model is sent", async () => {
        let p = await roomProduction("Directed");
        p = await mediaStudio.linkScribeDocument(ctx(ownerId), p.id, { documentId });
        p = await mediaStudio.addScene(ctx(ownerId), p.id, { title: "Rooftop" });
        const sceneId = p.scenes[0].id;
        p = await mediaStudio.updateScene(ctx(ownerId), sceneId, { location: " Archive rooftop ", timeOfDay: "night", mood: "tense, cold cyan light" });
        expect(p.scenes[0]).toMatchObject({ location: "Archive rooftop", timeOfDay: "night", mood: "tense, cold cyan light" });

        p = await mediaStudio.addShot(ctx(ownerId), sceneId, {
            prompt: "Elena crouches behind the parapet", framing: "medium close-up", lens: "35mm", cameraMotion: "slow push-in",
            action: "She presses the cylinder to her chest", dialogue: [{ speaker: "Elena", line: "Not tonight.", delivery: "whispering" }],
        });
        const shot = p.scenes[0].shots[0];
        expect(shot).toMatchObject({ framing: "medium close-up", lens: "35mm", action: "She presses the cylinder to her chest", dialogue: [{ speaker: "Elena", line: "Not tonight.", delivery: "whispering" }] });

        await expect(mediaStudio.updateShot(ctx(ownerId), shot.id, { dialogue: [{ speaker: "", line: "x" }] })).rejects.toThrow(/Invalid shot/);
        await expect(mediaStudio.updateShot(ctx(ownerId), shot.id, { dialogue: Array.from({ length: 31 }, () => ({ speaker: "Elena", line: "x" })) })).rejects.toThrow(/Invalid shot/);

        const compiled = compileShot({ aspectRatio: p.aspectRatio, scene: p.scenes[0], shot, characters: p.characters });
        expect(compiled.prompt).toContain("Characters: Elena, a courier in a rain-soaked trench coat.");
        expect(compiled.prompt).toContain('Elena (whispering): "Not tonight."');
        expect(compiled.warnings).toEqual([]);

        p = await mediaStudio.updateShot(ctx(ownerId), shot.id, { dialogue: [] });
        expect(p.scenes[0].shots[0].dialogue).toEqual([]);
        await expect(mediaStudio.getProduction(ctx(strangerId, otherOrgId), p.id)).rejects.toThrow("Production not found.");
    });

    /**
     * The story and the scenes derived from it, once the manuscript moves.
     *
     * A scene's synopsis is a snapshot taken when it was derived; the station is read
     * live. Before this, re-importing skipped every station it had already seen, so
     * an edit to the manuscript could never reach the scene and the two simply
     * disagreed on screen for ever, with nothing to say which was newer.
     */

    it("says a scene's station has changed, brings it back into step, and leaves a note on the story", async () => {
        let p = await roomProduction("Kept in step");
        p = await mediaStudio.linkScribeDocument(ctx(ownerId), p.id, { documentId });
        p = await mediaStudio.importScenesFromScribe(ctx(ownerId), p.id);
        const scene = p.scenes.find((s) => s.scribeNodeId === stationIds[0])!;
        expect(scene.station).toMatchObject({ changed: false });

        // The writer rewrites the station, adding a slugline and a spelled-out shot.
        await db.update(scribeNodes).set({
            content: 'INT. ARCHIVE ROOFTOP - NIGHT\n\nElena reaches the parapet.\n\n[SHOT 1]\nFraming: Medium close-up\nCamera: slow push-in\nSubject: Elena at the parapet\nDuration: 6s\nELENA: "Not tonight."\n',
        }).where(eq(scribeNodes.id, stationIds[0]));

        p = await mediaStudio.getProduction(ctx(ownerId), p.id);
        const drifted = p.scenes.find((s) => s.id === scene.id)!;
        expect(drifted.station).toMatchObject({ changed: true });
        // The scene itself has not moved: the synopsis is still the old snapshot.
        expect(drifted.synopsis).toBe(scene.synopsis);

        // Re-importing still will not touch it — that is what resync is for.
        p = await mediaStudio.importScenesFromScribe(ctx(ownerId), p.id);
        expect(p.scenes.find((s) => s.id === scene.id)!.synopsis).toBe(scene.synopsis);

        p = await mediaStudio.resyncSceneFromStation(ctx(ownerId), scene.id);
        const synced = p.scenes.find((s) => s.id === scene.id)!;
        expect(synced.station).toMatchObject({ changed: false });
        expect(synced.synopsis).toContain("Elena reaches the parapet.");
        // The slugline becomes the scene's direction, and the spelled-out shot
        // arrives with its framing, camera, length and dialogue.
        expect(synced).toMatchObject({ location: "ARCHIVE ROOFTOP", timeOfDay: "NIGHT" });
        expect(synced.shots).toHaveLength(1);
        expect(synced.shots[0]).toMatchObject({
            framing: "Medium close-up", cameraMotion: "slow push-in", durationSeconds: 6,
            dialogue: [{ speaker: "ELENA", line: "Not tonight." }],
        });

        // Re-syncing again adds nothing: the station's shots are already here.
        p = await mediaStudio.resyncSceneFromStation(ctx(ownerId), scene.id);
        expect(p.scenes.find((s) => s.id === scene.id)!.shots).toHaveLength(1);
    });

    it("writes a note back as an open todo on the station, and changes not one word of it", async () => {
        let p = await roomProduction("Notes back");
        p = await mediaStudio.linkScribeDocument(ctx(ownerId), p.id, { documentId });
        p = await mediaStudio.importScenesFromScribe(ctx(ownerId), p.id);
        const scene = p.scenes.find((s) => s.scribeNodeId === stationIds[1])!;

        const [before] = await db.select({ content: scribeNodes.content }).from(scribeNodes).where(eq(scribeNodes.id, stationIds[1]));
        const note = await mediaStudio.noteSceneToStation(ctx(ownerId), scene.id, {
            title: "The roof reads too dark",
            body: "The takes need a practical on the parapet to see her face.",
        });

        const [row] = await db.select().from(scribeAnnotations).where(eq(scribeAnnotations.id, note.id));
        expect(row).toMatchObject({ nodeId: stationIds[1], documentId, lensType: "todo", status: "open", title: "The roof reads too dark" });
        expect(row.critiqueBody).toContain("practical on the parapet");
        // It says where it came from, because a writer has no other way to know.
        expect(row.critiqueBody).toContain(scene.sceneKey);

        // The manuscript itself is untouched. This is the whole point.
        const [after] = await db.select({ content: scribeNodes.content }).from(scribeNodes).where(eq(scribeNodes.id, stationIds[1]));
        expect(after.content).toBe(before.content);
    });

    it("refuses a scene with no station, in either direction", async () => {
        let p = await roomProduction("No station");
        p = await mediaStudio.addScene(ctx(ownerId), p.id, { title: "Written here, not in the manuscript" });
        const scene = p.scenes[0];
        await expect(mediaStudio.resyncSceneFromStation(ctx(ownerId), scene.id)).rejects.toThrow("not told by a station");
        await expect(mediaStudio.noteSceneToStation(ctx(ownerId), scene.id, { title: "x", body: "y" })).rejects.toThrow("nowhere to leave a note");
    });
});
