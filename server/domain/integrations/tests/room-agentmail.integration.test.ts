import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@server/database_service.js";
import { agentmailConnections, agentmailRoomInboxes, crewSessions, orgs } from "@shared/schema/index.js";
import { inArray } from "drizzle-orm";
let orgA: number, orgB: number, roomA: number, roomB: number;
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
beforeAll(async () => {
    const organizations = await db.insert(orgs).values([{ name: `Mail A ${stamp}` }, { name: `Mail B ${stamp}` }]).returning();
    [orgA, orgB] = organizations.map(o => o.id);
    const rooms = await db.insert(crewSessions).values([{ organizationId: orgA, sessionKey: `mail-a-${stamp}` }, { organizationId: orgB, sessionKey: `mail-b-${stamp}` }]).returning();
    [roomA, roomB] = rooms.map(r => r.id);

});
afterAll(async () => {
    if (roomA && roomB) await db.delete(crewSessions).where(inArray(crewSessions.id, [roomA, roomB]));
    if (orgA && orgB) await db.delete(orgs).where(inArray(orgs.id, [orgA, orgB]));

});
describe("database mailbox ownership", () => {
    it("rejects a mapping with a room from another organization", async () => {
        await expect(db.insert(agentmailRoomInboxes).values({ sessionId: roomA, organizationId: orgB, inboxId: `foreign-${stamp}@agentmail.to` })).rejects.toThrow();
    });
    it("rejects assigning an organization default to a room", async () => {
        const inboxId = `default-${stamp}@agentmail.to`;
        await db.insert(agentmailConnections).values({ organizationId: orgA, inboxId });
        await expect(db.insert(agentmailRoomInboxes).values({ sessionId: roomA, organizationId: orgA, inboxId })).rejects.toThrow();
    });
    it("rejects the reverse overlap and sharing one inbox across rooms", async () => {
        const inboxId = `room-${stamp}@agentmail.to`;
        await db.insert(agentmailRoomInboxes).values({ sessionId: roomA, organizationId: orgA, inboxId });
        await expect(db.insert(agentmailConnections).values({ organizationId: orgB, inboxId })).rejects.toThrow();
        await expect(db.insert(agentmailRoomInboxes).values({ sessionId: roomB, organizationId: orgB, inboxId })).rejects.toThrow();
    });
    it("serializes concurrent default and room claims for the same inbox", async () => {
        const inboxId = `race-${stamp}@agentmail.to`;
        const results = await Promise.allSettled([
            db.insert(agentmailConnections).values({ organizationId: orgB, inboxId }),
            db.insert(agentmailRoomInboxes).values({ sessionId: roomB, organizationId: orgB, inboxId }),
        ]);
        expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
        expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    });
});
