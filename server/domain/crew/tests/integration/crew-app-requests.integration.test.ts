/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * An app's request for a person lands in one standing CREW room per app, as a
 * form card that answers the same request the app polls. The deployment named
 * by the request must belong to the request's own org: a request cannot pull a
 * room into existence for another tenant's app. The people who answer for the
 * app are made participants, so the room is in their room list, and the request
 * can only be answered once however many places offer it.
 */

configureTestEnvironment();

const { db } = await import("@server/database_service.js");
const { orgs, users, adminRoles } = await import("@shared/schema/auth.js");
const { apps, appDeployments } = await import("@shared/schema/apps.js");
const { crewSessions, crewTurns, crewParticipants } = await import("@shared/schema/crew.js");
const { hilForms } = await import("@shared/schema/hil.js");
const { projects, projectMembers } = await import("@shared/schema/projects.js");
const { and, eq, inArray } = await import("drizzle-orm");
const { postAppRequestToCrew, appRequestsSessionKey, appRequestsRoomPath } = await import("../../core/crew-app-requests.service.js");
const { hilService } = await import("@domain/pipeline/core/hil.service.js");

let reachable = false;
try {
    await db.execute("SELECT 1 FROM crew_sessions LIMIT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(`[crew-app-requests] SKIPPED — no migrated test database reachable (${e?.message ?? e}).`);
}

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe.skipIf(!reachable)("app requests posted to CREW", () => {
    let orgA = 0, orgB = 0, appId = 0, deploymentA = 0, deploymentB = 0, projectA = 0;
    const formIds: number[] = [];
    const user: Record<string, string> = {};
    const userIds: string[] = [];

    const request = async (orgId: number, deploymentId: number, source = "app") => {
        const [form] = await db.insert(hilForms).values({
            kind: "request",
            requestSource: source,
            status: "pending",
            name: `App HIL: Vendor Portal ${stamp}`,
            description: "Approve the new vendor?",
            organizationId: orgId,
            schema: {
                fields: [{ key: "response", type: "text", label: "Response", required: true }],
                sourceType: "app",
                sourceId: String(deploymentId),
            },
        } as any).returning();
        formIds.push(form.id);
        return form;
    };

    beforeAll(async () => {
        const [a] = await db.insert(orgs).values({ name: `App Requests A ${stamp}`, slug: `app-req-a-${stamp}` } as any).returning();
        const [b] = await db.insert(orgs).values({ name: `App Requests B ${stamp}`, slug: `app-req-b-${stamp}` } as any).returning();
        orgA = a.id; orgB = b.id;
        for (const who of ["owner", "member", "adminB"]) {
            const [u] = await db.insert(users).values({ username: `appreq_${who}_${stamp}`, password: "x", email: `appreq_${who}_${stamp}@example.test` } as any).returning();
            user[who] = String(u.id); userIds.push(String(u.id));
        }
        await db.insert(adminRoles).values({ userId: user.adminB, role: "org_admin", organizationId: orgB } as any);

        const [project] = await db.insert(projects).values({ organizationId: orgA, key: `vendors-${stamp}`, name: "Vendors", visibility: "private", ownerUserId: user.owner, createdBy: user.owner } as any).returning();
        projectA = project.id;
        await db.insert(projectMembers).values({ projectId: projectA, principalType: "user", principalId: user.member, role: "viewer", addedBy: user.owner } as any);
        const [app] = await db.insert(apps).values({ name: `Vendor Portal ${stamp}`, slug: `vendor-portal-${stamp}` }).returning();
        appId = app.id;
        const [depA] = await db.insert(appDeployments).values({ appId, organizationId: orgA, projectId: projectA } as any).returning();
        const [depB] = await db.insert(appDeployments).values({ appId, organizationId: orgB } as any).returning();
        deploymentA = depA.id; deploymentB = depB.id;
    });

    afterAll(async () => {
        if (!reachable) return;
        await db.delete(crewSessions).where(inArray(crewSessions.organizationId, [orgA, orgB]));
        if (formIds.length) await db.delete(hilForms).where(inArray(hilForms.id, formIds));
        await db.delete(appDeployments).where(eq(appDeployments.appId, appId));
        await db.delete(apps).where(eq(apps.id, appId));
        await db.delete(projects).where(inArray(projects.organizationId, [orgA, orgB]));
        await db.delete(users).where(inArray(users.id, userIds as any));
        await db.delete(orgs).where(inArray(orgs.id, [orgA, orgB]));
    });

    const roomFor = async (orgId: number) => db.select().from(crewSessions).where(and(
        eq(crewSessions.organizationId, orgId),
        eq(crewSessions.sessionKey, appRequestsSessionKey(appId)),
    ));
    const participantsOf = async (sessionId: number) =>
        (await db.select({ userId: crewParticipants.userId }).from(crewParticipants).where(eq(crewParticipants.sessionId, sessionId)))
            .map((p) => p.userId).sort();

    it("opens one requests room per app and posts each request into it as a form card", async () => {
        const first = await request(orgA, deploymentA);
        const second = await request(orgA, deploymentA);

        const posted = await postAppRequestToCrew(first);
        expect(posted).toMatchObject({ sessionKey: appRequestsSessionKey(appId), path: appRequestsRoomPath(orgA, appId) });
        expect((await postAppRequestToCrew(second))?.sessionKey).toBe(appRequestsSessionKey(appId));

        const rooms = await roomFor(orgA);
        expect(rooms).toHaveLength(1);
        expect(rooms[0].title).toBe(`Vendor Portal ${stamp} · Requests`);
        // The room sits where the deployment does, so project visibility carries over.
        expect(rooms[0].projectId).toBe(projectA);

        const turns = await db.select().from(crewTurns).where(eq(crewTurns.sessionId, rooms[0].id));
        expect(turns).toHaveLength(2);
        expect((turns[0].artifacts as any[])[0].payload).toMatchObject({
            type: "input_request",
            requestId: first.id,
            description: "Approve the new vendor?",
            schema: { fields: [{ key: "response", label: "Response" }] },
        });
    });

    it("puts the project's owner and members in the room, so it is in their room list", async () => {
        const [room] = await roomFor(orgA);
        expect(await participantsOf(room.id)).toEqual([user.member, user.owner].sort());
    });

    it("puts the org admins in the room when the app has no project", async () => {
        const posted = await postAppRequestToCrew(await request(orgB, deploymentB));
        expect(posted?.recipients).toBe(1);
        const [room] = await roomFor(orgB);
        expect(room.projectId).toBeNull();
        expect(await participantsOf(room.id)).toEqual([user.adminB]);
    });

    it("falls back to the org admins when the app's project has nobody in it", async () => {
        const [empty] = await db.insert(projects).values({ organizationId: orgB, key: `empty-${stamp}`, name: "Empty", createdBy: "system" } as any).returning();
        const [other] = await db.insert(apps).values({ name: `Kiosk ${stamp}`, slug: `kiosk-${stamp}` }).returning();
        try {
            const [dep] = await db.insert(appDeployments).values({ appId: other.id, organizationId: orgB, projectId: empty.id } as any).returning();
            const posted = await postAppRequestToCrew(await request(orgB, dep.id));
            expect(posted?.recipients).toBe(1);
            const [room] = await db.select().from(crewSessions).where(and(
                eq(crewSessions.organizationId, orgB), eq(crewSessions.sessionKey, appRequestsSessionKey(other.id))));
            expect(await participantsOf(room.id)).toEqual([user.adminB]);
        } finally {
            await db.delete(crewSessions).where(and(eq(crewSessions.organizationId, orgB), eq(crewSessions.sessionKey, appRequestsSessionKey(other.id))));
            await db.delete(appDeployments).where(eq(appDeployments.appId, other.id));
            await db.delete(apps).where(eq(apps.id, other.id));
        }
    });

    it("refuses a request that names another org's deployment", async () => {
        const forged = await request(orgA, deploymentB);
        expect(await postAppRequestToCrew(forged)).toBeNull();
    });

    it("ignores requests that did not come from an app", async () => {
        const fromStep = await request(orgA, deploymentA, "step");
        expect(await postAppRequestToCrew(fromStep)).toBeNull();
    });

    it("accepts exactly one of two simultaneous answers", async () => {
        const form = await request(orgA, deploymentA);
        const outcomes = await Promise.allSettled([
            hilService.submitForm(form.id, undefined, { response: "Approve" }),
            hilService.submitForm(form.id, undefined, { response: "Reject" }),
        ]);
        expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
        const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
        expect(String(rejected.reason?.message)).toMatch(/already submitted/);
    });
});
