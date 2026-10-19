import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@server/database_service.js";
import { crewSessions, orgs, crewMembers, agentCards } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { crewOrchestratorService } from "../core/crew-orchestrator.service.js";
import { ensureSession } from "../core/crew-session.service.js";

/**
 * A DIVERSE agent-fleet intake asks for art direction. It may recruit the org's
 * own art director; it must not mint one. The handler this replaces created a
 * "Pixel Maestro" card with no tools whenever the org lacked one, and answered
 * the intake with a templated turn claiming work nobody had done.
 */
const INTAKE =
  "[DIVERSE PRIMITIVE INTAKE: CONFIGURE AGENT FLEET]\n" +
  "• Direction (D): Roster: Pixel Maestro\n" +
  "• Evaluation & Governance (E): High Governance (Mandatory Human-in-the-Loop Signoff)";

let testOrgId = 0;
const sessionKeys: string[] = [];

beforeAll(async () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [createdOrg] = await db.insert(orgs).values({ name: `Art Direction Recruitment Test Org ${stamp}` }).returning();
  testOrgId = createdOrg.id;
});

afterAll(async () => {
  for (const key of sessionKeys) {
    const [session] = await db.select().from(crewSessions).where(eq(crewSessions.sessionKey, key)).limit(1);
    if (session) {
      await db.delete(crewMembers).where(eq(crewMembers.sessionId, session.id));
      await db.delete(crewSessions).where(eq(crewSessions.id, session.id));
    }
  }
  if (testOrgId) {
    await db.delete(agentCards).where(eq(agentCards.organizationId, testOrgId));
    await db.delete(orgs).where(eq(orgs.id, testOrgId));
  }
});

async function newRoom() {
  const key = `crew-art-direction-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  sessionKeys.push(key);
  return ensureSession(testOrgId, key);
}

function recruit(sessionId: number, message: string) {
  return (crewOrchestratorService as any).recruitSpecialists({
    orgId: testOrgId,
    sessionId,
    members: [],
    topic: "General",
    intent: "Chat",
    message,
  }) as Promise<Array<{ id: number; name: string; personaType: string | null }>>;
}

const isArtDirector = (card: { name: string; personaType: string | null }) =>
  /pixel\s*maestro|art\s*director/i.test(card.name) || card.personaType === "art-director";

describe("art-direction recruitment", () => {
  it("does not create an agent card when the org has no art director", async () => {
    const room = await newRoom();

    const recruited = await recruit(room.id, INTAKE);

    expect(recruited.some(isArtDirector)).toBe(false);
    const cards = await db.select().from(agentCards).where(eq(agentCards.organizationId, testOrgId));
    expect(cards.some(isArtDirector)).toBe(false);
  });

  it("recruits the org's existing art director", async () => {
    const [card] = await db
      .insert(agentCards)
      .values({
        organizationId: testOrgId,
        name: "Pixel Maestro",
        description: "Visual style and art direction.",
        personaType: "art-director",
        capabilities: [],
        tools: [],
        topicAffinities: ["General"],
        intentAffinities: ["Chat"],
        isDefault: false,
        enabled: true,
      })
      .returning();
    const room = await newRoom();

    const recruited = await recruit(room.id, INTAKE);

    expect(recruited.map((c) => c.id)).toEqual([card.id]);
    const members = await db.select().from(crewMembers).where(eq(crewMembers.sessionId, room.id));
    expect(members.map((m) => m.agentCardId)).toContain(card.id);
  });
});
