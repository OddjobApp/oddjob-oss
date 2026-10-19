/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * Opening Media Studio from a CREW room against a real database: the room's
 * production, one started from the Make a Film card, one named by title or id, and a
 * Project Space's Media tab, which only people who can read the project see.
 */

configureTestEnvironment();

const { db } = await import("@server/database_service.js");
const { orgs, users, userOrgs } = await import("@shared/schema/auth.js");
const { projects } = await import("@shared/schema/projects.js");
const { crewSessions } = await import("@shared/schema/crew.js");
const { projectService } = await import("@domain/projects/core/project.service.js");
const { mediaStudio } = await import("../../core/media-studio.service.js");
const { VIDEO_ASSEMBLY_TOOLS } = await import("@domain/tools/v1/capabilities/video-assembly.js");
const { detectArtifact } = await import("@domain/crew/core/crew-tools.service.js");

let reachable = false;
try {
    await db.execute("SELECT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(`[media-open] SKIPPED — no test database reachable (${e?.message ?? e}).`);
}

const stamp = Date.now();

describe.skipIf(!reachable)("Opening Media Studio from a room", () => {
    let orgId: number, otherOrgId: number;
    let ownerId: string, outsiderId: string, strangerId: string;
    let project: any;
    let roomKey: string;
    let roomId: number;
    const ctx = (userId: string, organizationId = orgId) =>
        ({ organizationId, userId, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false }) as any;
    const tool = (userId: string, organizationId = orgId) => ({ organizationId, userId, sessionId: roomId, sessionKey: roomKey }) as any;
    const mount = (params: Record<string, unknown>, context = tool(ownerId)) => VIDEO_ASSEMBLY_TOOLS.mount_media_studio.execute(params, context) as Promise<string>;
    const pod = (output: string) => detectArtifact("mount_media_studio", output)?.payload as Record<string, unknown> | undefined;

    beforeAll(async () => {
        const [a, b] = await db.insert(orgs).values([
            { name: `Open ${stamp}`, slug: `open-${stamp}` },
            { name: `Open other ${stamp}`, slug: `open-other-${stamp}` },
        ] as any).returning();
        orgId = a.id;
        otherOrgId = b.id;
        const people = await db.insert(users).values(["owner", "outsider", "stranger"].map((role) => ({
            username: `open_${role}_${stamp}`, password: "not-a-real-password", email: `open_${role}_${stamp}@example.test`,
        })) as any).returning();
        [ownerId, outsiderId, strangerId] = people.map((person: any) => person.id);
        await db.insert(userOrgs).values([
            { userId: ownerId, orgId }, { userId: outsiderId, orgId }, { userId: strangerId, orgId: otherOrgId },
        ] as any);

        project = await projectService.createProject({ organizationId: orgId, userId: ownerId }, { name: `Films ${stamp}`, visibility: "private" } as any);
        roomKey = `open-room-${stamp}`;
        const [room] = await db.insert(crewSessions).values({ organizationId: orgId, sessionKey: roomKey, projectId: project.id, createdBy: ownerId } as any).returning();
        roomId = room.id;
    });

    afterAll(async () => {
        if (!orgId) return;
        await db.delete(crewSessions).where(inArray(crewSessions.organizationId, [orgId, otherOrgId]));
        await db.delete(projects).where(inArray(projects.organizationId, [orgId, otherOrgId])).catch(() => {});
        await db.delete(orgs).where(inArray(orgs.id, [orgId, otherOrgId])).catch(() => {});
        await db.delete(users).where(inArray(users.id, [ownerId, outsiderId, strangerId].filter(Boolean))).catch(() => {});
    });

    it("opens the start form in a room with no production, starts one from the film card once, and then opens it", async () => {
        const empty = pod(await mount({}));
        expect(empty).toMatchObject({ type: "media_studio_pod", module: "MediaStudioPod", created: false });
        expect(empty).not.toHaveProperty("productionId");
        expect(await mediaStudio.listProductions(ctx(ownerId), { crewSessionId: roomId })).toEqual([]);

        const started = pod(await mount({ productionTitle: "Rooftop chase", create: true, aspectRatio: "2.39:1" }));
        expect(started).toMatchObject({ created: true, productionTitle: "Rooftop chase", title: "Rooftop chase", aspectRatio: "2.39:1", sceneId: "SCENE-01" });

        // Asking again, as a retried card would, opens it rather than starting a second one.
        expect(pod(await mount({ productionTitle: "Rooftop chase", create: true }))).toMatchObject({ created: false, productionId: started!.productionId });
        expect(pod(await mount({}))).toMatchObject({ created: false, productionId: started!.productionId });

        const listed = await mediaStudio.listProductions(ctx(ownerId), { crewSessionId: roomId });
        expect(listed).toEqual([expect.objectContaining({ id: started!.productionId, projectId: project.id, crewSessionId: roomId })]);
    });

    it("opens a production by title or id, names the productions when nothing matches, and keeps other organizations out", async () => {
        const [production] = await mediaStudio.listProductions(ctx(ownerId), { crewSessionId: roomId });
        let p = await mediaStudio.addScene(ctx(ownerId), production.id, { title: "Arrival" });
        p = await mediaStudio.addScene(ctx(ownerId), production.id, { title: "The chase" });

        expect(pod(await mount({ productionTitle: "open the rooftop chase storyboard", sceneId: "scene-02" })))
            .toMatchObject({ productionId: production.id, sceneId: "SCENE-02", sceneTitle: "The chase" });
        expect(await mount({ productionTitle: "Harbor heist" })).toBe(
            'No production matches "Harbor heist". This organization\'s productions: Rooftop chase. Say which one to open, or ask to start "Harbor heist" as a new production.',
        );
        expect(await mount({ productionId: production.id }, tool(strangerId, otherOrgId))).toBe("Media Studio did not open: Production not found.");
        expect(p.scenes).toHaveLength(2);
    });

    it("lists a project's productions for its Media tab, only to people who can read the project", async () => {
        const [production] = await mediaStudio.listProductions(ctx(ownerId), { crewSessionId: roomId });
        const sceneId = (await mediaStudio.getProduction(ctx(ownerId), production.id)).scenes[0].id;
        await mediaStudio.addShot(ctx(ownerId), sceneId, { action: "Elena crouches behind the parapet" });

        expect(await mediaStudio.projectProductions(ctx(ownerId), project.id)).toEqual([{
            id: production.id, title: "Rooftop chase", aspectRatio: "2.39:1", updatedAt: expect.any(String),
            scenes: 2, shots: 1, approvedTakes: 0, reels: 0, spendCents: 0, budgetLimitCents: 10000,
            room: { sessionKey: roomKey, title: null },
        }]);
        expect(await mediaStudio.projectProductions(ctx(outsiderId), project.id)).toEqual([]);
        expect(await mediaStudio.projectProductions(ctx(strangerId, otherOrgId), project.id)).toEqual([]);
    });
});
