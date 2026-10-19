import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "@server/database_service.js";
import { agentCards, crewMembers, crewSessions, orgs, organizationStudioEntitlements } from "@shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";
import { seedProvisioningService } from "@domain/agent-cards/core/seed-provisioning.service.js";
import { ensureSession } from "../crew-session.service.js";
import { CREW_STUDIO_SQUADS } from "@shared/constants/crew-studios.js";

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let orgId = 0;

beforeAll(async () => {
    const [org] = await db.insert(orgs).values({ name: `Crew Studio Seeding ${stamp}` }).returning();
    orgId = org.id;
    await seedProvisioningService.seedForOrganization(orgId);
});

afterEach(async () => {
    if (!orgId) return;
    await db.delete(organizationStudioEntitlements).where(eq(organizationStudioEntitlements.organizationId, orgId));
});

afterAll(async () => {
    if (!orgId) return;
    const sessions = await db
        .select({ id: crewSessions.id })
        .from(crewSessions)
        .where(eq(crewSessions.organizationId, orgId));
    const sessionIds = sessions.map((s) => s.id);
    if (sessionIds.length) {
        await db.delete(crewMembers).where(inArray(crewMembers.sessionId, sessionIds));
        await db.delete(crewSessions).where(inArray(crewSessions.id, sessionIds));
    }
    await db.delete(agentCards).where(eq(agentCards.organizationId, orgId));
    await db.delete(orgs).where(eq(orgs.id, orgId));
});

describe("ensureSession — studio squad seeding", () => {
    it("seeds only the platform Copilot when no studio is given", async () => {
        const session = await ensureSession(orgId, `crew-default-${stamp}`, undefined);
        const members = await db.select({ agentCardId: crewMembers.agentCardId }).from(crewMembers).where(eq(crewMembers.sessionId, session.id));
        const cards = await db
            .select({ name: agentCards.name, personaType: agentCards.personaType })
            .from(agentCards)
            .where(inArray(agentCards.id, members.map((m) => m.agentCardId)));

        expect(cards.map((c) => c.name)).toEqual(["Copilot"]);
    });

    it("seeds the forge studio squad alongside the Copilot", async () => {
        const session = await ensureSession(orgId, `crew-forge-${stamp}`, undefined, "forge");
        const members = await db.select({ agentCardId: crewMembers.agentCardId }).from(crewMembers).where(eq(crewMembers.sessionId, session.id));
        const cards = await db
            .select({ name: agentCards.name, personaType: agentCards.personaType })
            .from(agentCards)
            .where(inArray(agentCards.id, members.map((m) => m.agentCardId)));

        const names = cards.map((c) => c.name).sort();
        const expectedPersonas = new Set(CREW_STUDIO_SQUADS.forge);
        const seededPersonas = new Set(cards.map((c) => c.personaType));

        expect(names).toContain("Copilot");
        for (const persona of expectedPersonas) {
            expect(seededPersonas).toContain(persona);
        }
    });

    it("seeds the media studio squad alongside the Copilot when the org has entitled it", async () => {
        await db.insert(organizationStudioEntitlements).values({
            organizationId: orgId,
            studioKind: "media",
            installedByUserId: "test-user",
        }).onConflictDoNothing();
        const session = await ensureSession(orgId, `crew-media-${stamp}`, undefined, "media");
        const members = await db.select({ agentCardId: crewMembers.agentCardId }).from(crewMembers).where(eq(crewMembers.sessionId, session.id));
        const cards = await db
            .select({ name: agentCards.name, personaType: agentCards.personaType })
            .from(agentCards)
            .where(inArray(agentCards.id, members.map((m) => m.agentCardId)));

        expect(cards.map((c) => c.name)).toContain("Copilot");
        expect(cards.map((c) => c.personaType)).toContain("media-creator");
    });

    it("does not seed the media studio squad when the org has not entitled it", async () => {
        const session = await ensureSession(orgId, `crew-media-disabled-${stamp}`, undefined, "media");
        const members = await db.select({ agentCardId: crewMembers.agentCardId }).from(crewMembers).where(eq(crewMembers.sessionId, session.id));
        const cards = await db
            .select({ name: agentCards.name, personaType: agentCards.personaType })
            .from(agentCards)
            .where(inArray(agentCards.id, members.map((m) => m.agentCardId)));

        expect(cards.map((c) => c.name)).toEqual(["Copilot"]);
        expect(cards.map((c) => c.personaType)).not.toContain("media-creator");
    });
});
