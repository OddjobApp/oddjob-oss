/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { configureTestEnvironment } from "../../../../tests/configure-test-environment.js";

/**
 * Sharing a Granola meeting into a room: only into a room the person can open,
 * once per meeting, as a turn from them that carries the snapshot agents read.
 */

configureTestEnvironment();

const getMeetings = vi.hoisted(() => vi.fn());
vi.mock("./service.js", () => ({ getGranolaForContext: async () => ({ client: { getMeetings } }) }));

const { db } = await import("@server/database_service.js");
const { orgs, users } = await import("@shared/schema/auth.js");
const { crewSessions, crewTurns } = await import("@shared/schema/crew.js");
const { projects } = await import("@shared/schema/projects.js");
const { eq, inArray } = await import("drizzle-orm");
const { shareMeetingIntoRoom, sharedMeetings, GRANOLA_SHARE_TOOL } = await import("./rooms.js");

let reachable = false;
try {
    await db.execute("SELECT 1 FROM crew_sessions LIMIT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(`[granola-rooms] SKIPPED — no migrated test database reachable (${e?.message ?? e}).`);
}

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe.skipIf(!reachable)("sharing Granola meetings into rooms", () => {
    let orgId = 0, openRoom = 0, privateRoom = 0;
    const user: Record<string, string> = {};

    beforeAll(async () => {
        const [o] = await db.insert(orgs).values({ name: `Granola Rooms ${stamp}`, slug: `granola-rooms-${stamp}` } as any).returning();
        orgId = o.id;
        for (const who of ["owner", "outsider"]) {
            const [u] = await db.insert(users).values({ username: `granola_${who}_${stamp}`, password: "x", email: `granola_${who}_${stamp}@example.test` } as any).returning();
            user[who] = String(u.id);
        }
        const [p] = await db.insert(projects).values({ organizationId: orgId, key: `secret-${stamp}`, name: "Secret", visibility: "private", ownerUserId: user.owner, createdBy: user.owner } as any).returning();
        const [a] = await db.insert(crewSessions).values({ organizationId: orgId, sessionKey: `open-${stamp}`, title: "Open" } as any).returning();
        const [b] = await db.insert(crewSessions).values({ organizationId: orgId, sessionKey: `private-${stamp}`, title: "Private", projectId: p.id } as any).returning();
        openRoom = a.id; privateRoom = b.id;
        getMeetings.mockResolvedValue({ meetings: [{ id: "m1", title: "Roadmap review", date: "2026-10-10T16:00:00Z", notes: "Ship the staged rollout." }] });
    });

    afterAll(async () => {
        if (!reachable) return;
        await db.delete(crewSessions).where(eq(crewSessions.organizationId, orgId));
        await db.delete(projects).where(eq(projects.organizationId, orgId));
        await db.delete(users).where(inArray(users.id, Object.values(user) as any));
        await db.delete(orgs).where(eq(orgs.id, orgId));
    });

    it("posts the meeting as a turn from the person, which is what the room's agents read", async () => {
        const result = await shareMeetingIntoRoom({ organizationId: orgId, userId: user.owner }, `open-${stamp}`, "m1");
        expect(result.shared).toBe(true);
        const [turn] = await db.select().from(crewTurns).where(eq(crewTurns.sessionId, openRoom));
        expect(turn).toMatchObject({ speakerType: "user", userId: user.owner });
        expect(turn.content).toContain("Roadmap review");
        expect((turn.artifacts as any[])[0].tool).toBe(GRANOLA_SHARE_TOOL);

        const shared = await sharedMeetings(openRoom, ["m1"]);
        expect(shared).toHaveLength(1);
        expect(shared[0]).toMatchObject({ meetingId: "m1", sharedBy: user.owner, turnId: turn.id });
        expect(String(shared[0].item.body)).toContain("staged rollout");
    });

    it("shares a meeting once per room", async () => {
        const again = await shareMeetingIntoRoom({ organizationId: orgId, userId: user.owner }, `open-${stamp}`, "m1");
        expect(again).toMatchObject({ shared: true, alreadyShared: true });
        expect(await db.select().from(crewTurns).where(eq(crewTurns.sessionId, openRoom))).toHaveLength(1);
    });

    it("refuses a room in a private project the person is not in", async () => {
        await expect(shareMeetingIntoRoom({ organizationId: orgId, userId: user.outsider }, `private-${stamp}`, "m1")).rejects.toThrow(/cannot open this room/);
        expect(await db.select().from(crewTurns).where(eq(crewTurns.sessionId, privateRoom))).toHaveLength(0);
    });

    it("refuses a meeting the person's account does not have", async () => {
        getMeetings.mockResolvedValueOnce({ meetings: [] });
        await expect(shareMeetingIntoRoom({ organizationId: orgId, userId: user.owner }, `open-${stamp}`, "m404")).rejects.toThrow(/not found in your Granola account/);
    });

    it("sees only meetings shared into that room", async () => {
        expect(await sharedMeetings(privateRoom)).toEqual([]);
    });
});
