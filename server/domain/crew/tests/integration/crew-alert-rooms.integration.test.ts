/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * New alerts land in one standing CREW room per (org, category). Alerts are
 * read from the table, since its writers insert directly and publish no event.
 * Only an org's own open alerts of warning severity or worse are posted, each
 * exactly once; the org's admins, and an alert's owner when they belong to the
 * org, are made participants so the room is in their room list.
 */

configureTestEnvironment();

const { db } = await import("@server/database_service.js");
const { orgs, users, adminRoles, userOrgs } = await import("@shared/schema/auth.js");
const { alerts } = await import("@shared/schema/alerts.js");
const { pushDeliveries } = await import("@shared/schema/push.js");
const { crewSessions, crewTurns, crewParticipants } = await import("@shared/schema/crew.js");
const { and, eq, inArray } = await import("drizzle-orm");
const { sweepAlertRooms, alertRoomSessionKey, ALERT_ROOM_SOURCE } = await import("../../core/crew-alert-rooms.js");

let reachable = false;
try {
    await db.execute("SELECT 1 FROM crew_sessions LIMIT 1" as any);
    await db.execute("SELECT 1 FROM push_deliveries LIMIT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(`[crew-alert-rooms] SKIPPED — no migrated test database reachable (${e?.message ?? e}).`);
}

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe.skipIf(!reachable)("alerts posted to CREW rooms", () => {
    let orgA = 0, orgB = 0;
    const user: Record<string, string> = {};
    const userIds: string[] = [];
    const alertIds: number[] = [];

    const raise = async (values: Record<string, unknown>) => {
        const [row] = await db.insert(alerts).values({
            severity: "error",
            category: "job_failure",
            message: `Job failed ${stamp}`,
            organizationId: orgA,
            ...values,
        } as any).returning();
        alertIds.push(row.id);
        return row;
    };
    const roomFor = async (orgId: number, category: string) => (await db.select().from(crewSessions).where(and(
        eq(crewSessions.organizationId, orgId),
        eq(crewSessions.sessionKey, alertRoomSessionKey(category)),
    )))[0];
    const turnsIn = async (sessionId: number) => db.select().from(crewTurns).where(eq(crewTurns.sessionId, sessionId));
    const participantsOf = async (sessionId: number) =>
        (await db.select({ userId: crewParticipants.userId }).from(crewParticipants).where(eq(crewParticipants.sessionId, sessionId)))
            .map((p) => p.userId).sort();

    beforeAll(async () => {
        const [a] = await db.insert(orgs).values({ name: `Alert Rooms A ${stamp}`, slug: `alert-rooms-a-${stamp}` } as any).returning();
        const [b] = await db.insert(orgs).values({ name: `Alert Rooms B ${stamp}`, slug: `alert-rooms-b-${stamp}` } as any).returning();
        orgA = a.id; orgB = b.id;
        for (const who of ["adminA", "owner", "outsider", "adminB"]) {
            const [u] = await db.insert(users).values({ username: `alertroom_${who}_${stamp}`, password: "x", email: `alertroom_${who}_${stamp}@example.test` } as any).returning();
            user[who] = String(u.id); userIds.push(String(u.id));
        }
        await db.insert(adminRoles).values([
            { userId: user.adminA, role: "org_admin", organizationId: orgA },
            { userId: user.adminB, role: "org_admin", organizationId: orgB },
        ] as any);
        await db.insert(userOrgs).values([{ userId: user.owner, orgId: orgA }, { userId: user.outsider, orgId: orgB }] as any);
    });

    afterAll(async () => {
        if (!reachable) return;
        if (alertIds.length) {
            await db.delete(pushDeliveries).where(and(
                eq(pushDeliveries.source, ALERT_ROOM_SOURCE),
                inArray(pushDeliveries.sourceId, alertIds.map(String)),
            ));
            await db.delete(alerts).where(inArray(alerts.id, alertIds));
        }
        await db.delete(crewSessions).where(inArray(crewSessions.organizationId, [orgA, orgB]));
        await db.delete(adminRoles).where(inArray(adminRoles.organizationId, [orgA, orgB]));
        await db.delete(users).where(inArray(users.id, userIds as any));
        await db.delete(orgs).where(inArray(orgs.id, [orgA, orgB]));
    });

    it("posts alerts that arrive together for a room as one turn, in a room per category", async () => {
        const first = await raise({ message: `Nightly import failed ${stamp}` });
        const second = await raise({ severity: "critical", message: `Billing sync failed ${stamp}` });
        await raise({ category: "governance", severity: "warning", message: `Regulatory source changed ${stamp}` });

        await sweepAlertRooms();

        const room = await roomFor(orgA, "job_failure");
        expect(room).toMatchObject({ title: "Alerts · Job failure", projectId: null, mode: "decide" });
        const turns = await turnsIn(room.id);
        expect(turns).toHaveLength(1);
        expect(turns[0].speakerName).toBe("Alerts");
        expect(turns[0].content).toContain(`alert #${first.id}`);
        expect(turns[0].content).toContain(`alert #${second.id}`);
        // Worst first.
        expect(turns[0].content.indexOf("Billing sync")).toBeLessThan(turns[0].content.indexOf("Nightly import"));

        const governance = await roomFor(orgA, "governance");
        expect(governance.title).toBe("Alerts · Governance");
        expect(await turnsIn(governance.id)).toHaveLength(1);
    });

    it("posts each alert once, however many sweeps run", async () => {
        await sweepAlertRooms();
        await sweepAlertRooms();
        expect(await turnsIn((await roomFor(orgA, "job_failure")).id)).toHaveLength(1);
    });

    it("leaves alone an alert another process already claimed", async () => {
        const claimed = await raise({ category: "claimed_elsewhere" });
        await db.insert(pushDeliveries).values({ source: ALERT_ROOM_SOURCE, sourceId: String(claimed.id), userId: "crew-room" });
        await sweepAlertRooms();
        expect(await roomFor(orgA, "claimed_elsewhere")).toBeUndefined();
    });

    it("does not post info, acknowledged, resolved, suppressed, stale or platform-wide alerts", async () => {
        const category = `quiet_${stamp}`.slice(0, 50);
        await raise({ category, severity: "info" });
        await raise({ category, acknowledgedAt: new Date() });
        await raise({ category, resolvedAt: new Date() });
        await raise({ category, suppressed: true });
        await raise({ category, createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) });
        await raise({ category, organizationId: null });
        await sweepAlertRooms();
        expect(await db.select().from(crewSessions).where(eq(crewSessions.sessionKey, alertRoomSessionKey(category)))).toHaveLength(0);
    });

    it("seats the org's admins and an owner who belongs to the org", async () => {
        await raise({ category: "security", ownerUserId: user.owner });
        await sweepAlertRooms();
        const room = await roomFor(orgA, "security");
        expect(await participantsOf(room.id)).toEqual([user.adminA, user.owner].sort());
    });

    it("never seats an owner from another org, or posts into another org's room", async () => {
        await raise({ category: "security", organizationId: orgB, ownerUserId: user.outsider, message: `B only ${stamp}` });
        await raise({ category: "data_quality", ownerUserId: user.outsider });
        await sweepAlertRooms();

        const roomB = await roomFor(orgB, "security");
        expect(await participantsOf(roomB.id)).toEqual([user.adminB, user.outsider].sort());
        // Org A's security room did not get org B's alert.
        const roomA = await roomFor(orgA, "security");
        expect((await turnsIn(roomA.id)).some((t) => t.content.includes("B only"))).toBe(false);
        // An org A alert naming a user who is not in org A does not seat them.
        const dq = await roomFor(orgA, "data_quality");
        expect(await participantsOf(dq.id)).toEqual([user.adminA]);
    });
});
