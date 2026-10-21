import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { orgs, users, saasConnectors, outboundEmailPreferences } from "@shared/schema/index.js";
import { outboundEmailAccounts } from "../core/outbound-email-accounts.service.js";
let orgA: number, orgB: number, userA: string, userB: string, connector: number;
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
beforeAll(async () => {
    const organizations = await db.insert(orgs).values([{ name: `Sender A ${stamp}` }, { name: `Sender B ${stamp}` }]).returning();
    [orgA, orgB] = organizations.map(o => o.id);
    const people = await db.insert(users).values([{ username: `sender-a-${stamp}`, password: "test-only-not-a-login" }, { username: `sender-b-${stamp}`, password: "test-only-not-a-login" }]).returning();
    [userA, userB] = people.map(u => u.id);
    const [connection] = await db.insert(saasConnectors).values({ orgId: orgA, platform: "google", status: "connected" }).returning();
    connector = connection.id;
});
afterAll(async () => {
    if (userA && userB) await db.delete(users).where(inArray(users.id, [userA, userB]));
    if (orgA && orgB) await db.delete(orgs).where(inArray(orgs.id, [orgA, orgB]));
});
describe("outbound sender preference persistence", () => {
    it("keeps preferences separate for each user and organization", async () => {
        await db.insert(outboundEmailPreferences).values([
            { organizationId: orgA, userId: userA, connectorId: connector, email: "one@example.com", provider: "google" },
            { organizationId: orgA, userId: userB, connectorId: connector, email: "two@example.com", provider: "google" },
            { organizationId: orgB, userId: userA, connectorId: null, email: "three@example.com", provider: "microsoft" },
        ]);
        await outboundEmailAccounts.clearPreference(orgA, userA);
        const rows = await db.select().from(outboundEmailPreferences).where(inArray(outboundEmailPreferences.organizationId, [orgA, orgB]));
        expect(rows.map(r => [r.organizationId, r.userId, r.email])).toEqual(expect.arrayContaining([[orgA, userB, "two@example.com"], [orgB, userA, "three@example.com"]]));
        expect(rows).toHaveLength(2);
    });
    it("invalidates a removed connection without substituting a different one", async () => {
        await db.delete(saasConnectors).where(and(eq(saasConnectors.id, connector), eq(saasConnectors.orgId, orgA)));
        const [preference] = await db.select().from(outboundEmailPreferences).where(and(eq(outboundEmailPreferences.organizationId, orgA), eq(outboundEmailPreferences.userId, userB)));
        expect(preference.connectorId).toBeNull();
        expect(await outboundEmailAccounts.options(orgA, userB)).toMatchObject({ accounts: [], preferredConnectorId: null });
    });
});
